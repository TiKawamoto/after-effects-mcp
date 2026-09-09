import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { createHash, randomUUID } from "node:crypto";
import { protocolVersion, version } from "./catalog.mjs";

export const MAX_BYTES = 1024 * 1024;
export const MAX_QUEUE = 32;
export const ID = /^[a-f0-9-]{36}$/;
export type Response = {
  protocolVersion: number;
  requestId: string;
  operation: string;
  status: "success" | "error" | "outcome_unknown";
  data?: any;
  error?: { code: string; message: string; mayHaveChanged?: boolean };
  [key: string]: any;
};
export class BridgeError extends Error {
  constructor(
    public code: string,
    message: string,
    public requestId?: string,
    public mayHaveChanged = false
  ) {
    super(message);
  }
}
export function atomicWrite(file: string, value: any) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  const bytes = JSON.stringify(value);
  if (Buffer.byteLength(bytes) > MAX_BYTES)
    throw new BridgeError("MESSAGE_TOO_LARGE", "Bridge message exceeds 1 MiB");
  try {
    const fd = fs.openSync(temporary, "wx", 0o600);
    try {
      fs.writeFileSync(fd, bytes, "utf8");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    // AE briefly opens heartbeat files without FILE_SHARE_DELETE on Windows.
    // Retry publication of the same completed bytes, never an AE operation.
    for (let attempt = 0; ; attempt++) {
      try {
        fs.renameSync(temporary, file);
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (attempt >= 19 || !["EPERM", "EACCES", "EBUSY"].includes(code || "")) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
export function readJSON(file: string): any {
  if (fs.statSync(file).size > MAX_BYTES)
    throw new BridgeError(
      "MESSAGE_TOO_LARGE",
      `File exceeds 1 MiB: ${path.basename(file)}`
    );
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
function maybe(file: string): any {
  try {
    return readJSON(file);
  } catch {
    return undefined;
  }
}
function validPanel(id: unknown): id is string {
  return typeof id === "string" && /^panel-[a-z0-9-]{5,90}$/.test(id);
}

export class BridgeClient {
  readonly serverId = randomUUID();
  readonly directory: string;
  private lock = net.createServer((socket) => socket.destroy());
  private timer?: NodeJS.Timeout;
  private pending = 0;
  private closed = false;
  constructor(
    directory: string,
    public timeoutMs = 30000
  ) {
    if (!directory || !path.isAbsolute(directory))
      throw new BridgeError(
        "CONFIGURATION",
        "Set AE_MCP_BRIDGE_DIR to an absolute local directory. Run npm run install-bridge -- --portable first."
      );
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.directory = fs.realpathSync(directory);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000)
      throw new BridgeError("CONFIGURATION", "Timeout must be 100–60000 ms");
  }
  file(folder: string, name: string) {
    return path.join(this.directory, folder, name);
  }
  async start() {
    // Kernel-held lock: automatic release on process death. Never steal a timed-out lease.
    const key = createHash("sha256")
      .update(
        process.platform === "win32"
          ? this.directory.toLowerCase()
          : this.directory
      )
      .digest("hex");
    const endpoint =
      process.platform === "win32" ? `\\\\.\\pipe\\ae-mcp-${key}` : undefined;
    await new Promise<void>((resolve, reject) => {
      this.lock.once("error", () =>
        reject(
          new BridgeError(
            "SERVER_ALREADY_RUNNING",
            "Another server owns this bridge directory (or its lock endpoint is unavailable). Close that MCP connection first."
          )
        )
      );
      if (endpoint) this.lock.listen(endpoint, resolve);
      else
        this.lock.listen(
          {
            host: "127.0.0.1",
            port: 20000 + (parseInt(key.slice(0, 4), 16) % 30000)
          },
          resolve
        );
    });
    for (const folder of ["requests", "results", "started", "panels"])
      fs.mkdirSync(this.file(folder, ""), { recursive: true, mode: 0o700 });
    this.tick();
    this.timer = setInterval(() => {
      try {
        this.tick();
      } catch (e) {
        console.error("Bridge maintenance:", String(e));
      }
    }, 1000);
    this.timer.unref();
  }
  private tick() {
    atomicWrite(this.file("", "server.json"), {
      serverId: this.serverId,
      protocolVersion,
      serverVersion: version,
      updatedAt: Date.now()
    });
    let owner = maybe(this.file("", "owner.json"));
    if (
      owner &&
      validPanel(owner.panelId) &&
      maybe(this.file("panels", `${owner.panelId}.released.json`))
    ) {
      fs.unlinkSync(this.file("", "owner.json"));
      owner = undefined;
    }
    if (!owner) {
      const candidates = fs
        .readdirSync(this.file("panels", ""))
        .filter((f) => f.endsWith(".hello.json"))
        .sort();
      for (const f of candidates) {
        const h = maybe(this.file("panels", f));
        if (
          h &&
          validPanel(h.panelId) &&
          f === `${h.panelId}.hello.json` &&
          !maybe(this.file("panels", `${h.panelId}.released.json`)) &&
          Math.abs(Date.now() - h.updatedAt) < 5000
        ) {
          atomicWrite(this.file("", "owner.json"), { panelId: h.panelId });
          break;
        }
      }
    }
    this.cleanup();
  }
  cleanup() {
    // Never prune records inside the five minute replay horizon.
    for (const folder of ["requests", "results", "started", "panels"]) {
      const files = fs
        .readdirSync(this.file(folder, ""))
        .filter((f) => /\.(json|tmp)$/.test(f))
        .map((name) => ({
          name,
          mtime: fs.statSync(this.file(folder, name)).mtimeMs
        }))
        .sort((a, b) => b.mtime - a.mtime);
      for (let i = 0; i < files.length; i++) {
        const f = files[i],
          age = Date.now() - f.mtime;
        if (
          age > 86400000 ||
          (i >= 2048 && age > 300000) ||
          (f.name.endsWith(".tmp") && age > 300000)
        )
          fs.unlinkSync(this.file(folder, f.name));
      }
    }
  }
  panel() {
    const owner = maybe(this.file("", "owner.json"));
    const h =
      owner &&
      validPanel(owner.panelId) &&
      maybe(this.file("panels", `${owner.panelId}.hello.json`));
    if (
      !h ||
      h.panelId !== owner.panelId ||
      typeof h.updatedAt !== "number" ||
      !Number.isFinite(h.updatedAt) ||
      Math.abs(Date.now() - h.updatedAt) > 5000 ||
      maybe(this.file("panels", `${owner.panelId}.released.json`))
    )
      throw new BridgeError(
        "PANEL_OFFLINE",
        `AE panel is closed, paused, busy, or disconnected. Open mcp-bridge-auto.jsx and Start. Check script file permissions and directory: ${this.directory}. An abandoned owner requires closing all AE processes before npm run bridge-reset.`
      );
    if (h.protocolVersion !== protocolVersion || h.bridgeVersion !== version)
      throw new BridgeError(
        "VERSION_MISMATCH",
        `Server ${version}/protocol ${protocolVersion}; panel ${h.bridgeVersion}/protocol ${h.protocolVersion}. Reinstall and reopen the panel.`
      );
    return h;
  }
  result(requestId: string): any {
    if (!ID.test(requestId))
      throw new BridgeError("INVALID_ID", "Expected a UUID requestId");
    const request = maybe(this.file("requests", `${requestId}.json`));
    const result = maybe(this.file("results", `${requestId}.json`));
    if (
      result &&
      result.requestId === requestId &&
      result.protocolVersion === protocolVersion &&
      ["success", "error", "outcome_unknown"].includes(result.status)
    ) {
      if (
        request &&
        (result.operation !== request.operation ||
          result.serverId !== request.serverId)
      )
        throw new BridgeError(
          "INVALID_RESPONSE",
          "Retained response does not match the original request.",
          requestId,
          true
        );
      return result;
    }
    const started = maybe(this.file("started", `${requestId}.json`));
    return {
      requestId,
      status: started
        ? "outcome_unknown"
        : request
          ? "pending_or_expired"
          : "not_found",
      started: started || null,
      message:
        "Reconciliation only; never retries. If started without a result, inspect AE and undo as needed. Absence after retention proves nothing."
    };
  }
  async call(operation: string, args: unknown): Promise<Response> {
    if (this.closed) throw new BridgeError("DISCONNECTED", "Server is closing");
    const panel = this.panel();
    if (this.pending >= MAX_QUEUE)
      throw new BridgeError(
        "QUEUE_FULL",
        "At most 32 operations may wait for AE."
      );
    const requestId = randomUUID(),
      createdAt = Date.now();
    const request = {
      protocolVersion,
      serverVersion: version,
      serverId: this.serverId,
      panelId: panel.panelId,
      requestId,
      operation,
      arguments: args,
      createdAt,
      expiresAt: createdAt + this.timeoutMs
    };
    const destination = this.file("requests", `${requestId}.json`);
    const waiting = fs
      .readdirSync(this.file("requests", ""))
      .filter(
        (f) =>
          f.endsWith(".json") &&
          !fs.existsSync(this.file("results", f)) &&
          (maybe(this.file("requests", f))?.expiresAt ?? 0) > Date.now()
      ).length;
    if (waiting >= MAX_QUEUE)
      throw new BridgeError("QUEUE_FULL", "The bridge queue is full.");
    atomicWrite(destination, request);
    this.pending++;
    try {
      while (Date.now() <= request.expiresAt && !this.closed) {
        const filename = this.file("results", `${requestId}.json`);
        if (fs.existsSync(filename)) {
          let r: Response;
          try {
            r = readJSON(filename);
          } catch {
            throw new BridgeError(
              "INVALID_RESPONSE",
              "AE published a malformed response; reconcile before retrying.",
              requestId,
              true
            );
          }
          if (
            r.protocolVersion !== protocolVersion ||
            r.requestId !== requestId ||
            r.operation !== operation ||
            r.serverId !== this.serverId ||
            r.panelId !== panel.panelId ||
            !["success", "error", "outcome_unknown"].includes(r.status) ||
            (r.status === "success"
              ? !Object.hasOwn(r, "data")
              : !r.error?.code || typeof r.error.message !== "string")
          )
            throw new BridgeError(
              "INVALID_RESPONSE",
              "Response identity, version, or payload does not match this request.",
              requestId,
              true
            );
          return r;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new BridgeError(
        "OUTCOME_UNKNOWN",
        "No final response before timeout/disconnect. AE may have changed the project. Use get-request-result with this requestId, inspect targets, and reconcile before any retry.",
        requestId,
        true
      );
    } finally {
      this.pending--;
    }
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    try {
      const s = maybe(this.file("", "server.json"));
      if (s?.serverId === this.serverId)
        atomicWrite(this.file("", "server.json"), { ...s, updatedAt: 0 });
    } finally {
      await new Promise<void>((r) => this.lock.close(() => r()));
    }
  }
}
