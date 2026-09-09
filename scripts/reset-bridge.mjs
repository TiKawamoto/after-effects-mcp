import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { BridgeClient } from "../build/bridge-client.js";
if (!process.argv.includes("--confirm-ae-closed"))
  throw new Error(
    "Close ALL AE instances and MCP clients, then pass --confirm-ae-closed. Journals will be preserved."
  );
if (process.platform !== "win32")
  throw new Error(
    "Automatic process verification is Windows-only. With AE and Node stopped, manually remove owner.json and panels/*.json only."
  );
const processes = execFileSync(
  "tasklist.exe",
  ["/FI", "IMAGENAME eq AfterFX.exe", "/FO", "CSV", "/NH"],
  { encoding: "utf8", windowsHide: true }
);
if (/AfterFX\.exe/i.test(processes))
  throw new Error("After Effects is still running. Ownership was not changed.");
const bridge = new BridgeClient(process.env.AE_MCP_BRIDGE_DIR || "");
await bridge.start();
try {
  const owner = bridge.file("", "owner.json");
  if (fs.existsSync(owner)) fs.unlinkSync(owner);
  for (const f of fs.readdirSync(bridge.file("panels", ""))) {
    if (/^panel-[a-z0-9-]+\.(hello|released)\.json$/.test(f))
      fs.unlinkSync(path.join(bridge.directory, "panels", f));
  }
  console.log(
    "Ownership reset; request/result/started journals preserved. Reopen panel and restart MCP client."
  );
} finally {
  await bridge.close();
}
