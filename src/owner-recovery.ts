import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

type Snapshot = { observedAt: number; processes: Array<{ pid: number; startedAt: number }> };
const execute = promisify(execFile);
const PANEL = /^panel-(\d{13})-\d{1,10}$/;

export async function windowsAEProcesses(): Promise<Snapshot> {
  if (process.platform !== "win32") throw new Error("Process verification requires Windows.");
  // Fixed read-only query, no directory or user text interpolated into PowerShell.
  const command = "$ErrorActionPreference='Stop'; $items=@(Get-CimInstance Win32_Process -Filter \"Name = 'AfterFX.exe'\" | ForEach-Object { if ($null -eq $_.CreationDate) { throw 'Missing process creation time' }; @{pid=[int]$_.ProcessId; startedAt=([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds()} }); @{observedAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); processes=$items} | ConvertTo-Json -Compress -Depth 4";
  const { stdout } = await execute(
    path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
    { windowsHide: true, timeout: 5000, maxBuffer: 65536 }
  );
  return JSON.parse(stdout.replace(/^\uFEFF/, ""));
}

function read(file: string): string | undefined {
  try {
    if (fs.statSync(file).size > 4096) return undefined;
    return fs.readFileSync(file, "utf8");
  } catch { return undefined; }
}

// A stale heartbeat alone never proves that a panel has stopped executing.
// Every surviving AE process must have started AFTER the old panel last ran.
export function oldProcessEnded(panelId: string, hello: any, snapshot: Snapshot, now = Date.now()) {
  const match = PANEL.exec(panelId);
  if (!match || !Number.isFinite(snapshot?.observedAt) || Math.abs(now - snapshot.observedAt) > 10000 || !Array.isArray(snapshot.processes)) return false;
  if (!snapshot.processes.every(p => Number.isInteger(p.pid) && p.pid > 0 && Number.isFinite(p.startedAt) && p.startedAt > 0 && p.startedAt <= snapshot.observedAt)) return false;
  if (!snapshot.processes.length) return true;
  if (hello?.panelId !== panelId || !Number.isFinite(hello.updatedAt) || hello.updatedAt < Number(match[1]) || now - hello.updatedAt < 10000) return false;
  return snapshot.processes.every(p => p.startedAt > hello.updatedAt + 2000);
}

export async function recoverAbandonedOwner(directory: string, inspect = windowsAEProcesses) {
  const ownerFile = path.join(directory, "owner.json");
  const ownerBytes = read(ownerFile);
  if (!ownerBytes) return { recovered: false, reason: "No readable owner." };
  const owner = JSON.parse(ownerBytes);
  if (!PANEL.test(owner.panelId)) return { recovered: false, reason: "Owner identity cannot be verified." };
  const helloFile = path.join(directory, "panels", `${owner.panelId}.hello.json`);
  const releasedFile = path.join(directory, "panels", `${owner.panelId}.released.json`);
  if (fs.existsSync(releasedFile)) return { recovered: false, reason: "Owner already released." };
  const helloBytes = read(helloFile);
  const hello = helloBytes ? JSON.parse(helloBytes) : undefined;
  if (hello && Date.now() - hello.updatedAt < 10000) return { recovered: false, reason: "Owner is responding." };
  const snapshot = await inspect();
  if (!oldProcessEnded(owner.panelId, hello, snapshot)) return { recovered: false, reason: "A surviving AE process could still own this panel. Ownership preserved." };
  // Recheck after the asynchronous OS query. A resumed/changed owner must win.
  if (read(ownerFile) !== ownerBytes || read(helloFile) !== helloBytes || fs.existsSync(releasedFile)) return { recovered: false, reason: "Ownership changed during verification." };
  const evidence = { panelId: owner.panelId, releasedAt: Date.now(), reason: "previous-ae-process-ended", lastHello: hello || null, processSnapshot: snapshot };
  const temporary = `${releasedFile}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(evidence), { flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, releasedFile);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  // The existing server observes this release and grants the new owner normally.
  // Never delete request, result or started journals or bypass the server lock.
  return { recovered: true, ...evidence };
}
