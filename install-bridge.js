import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const repo = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flags = new Set(["--portable", "--list", "--uninstall"]);
const values = new Set(["--ae-path", "--panel-dir", "--bridge-dir"]);
const options = {};
for (let i = 0; i < args.length; i++) {
  if (flags.has(args[i])) options[args[i]] = true;
  else if (values.has(args[i]) && args[i + 1] && !args[i + 1].startsWith("--"))
    options[args[i]] = args[++i];
  else throw new Error("Unknown or incomplete option: " + args[i]);
}
const adobe =
  process.platform === "win32"
    ? path.join(process.env.ProgramFiles || "C:/Program Files", "Adobe")
    : "/Applications";
const installs = fs.existsSync(adobe)
  ? fs
      .readdirSync(adobe)
      .filter((n) => /^Adobe After Effects/.test(n))
      .map((n) => path.join(adobe, n))
      .filter((p) =>
        fs.existsSync(
          process.platform === "win32"
            ? path.join(p, "Support Files", "AfterFX.exe")
            : path.join(p, "Scripts")
        )
      )
  : [];
if (options["--list"]) {
  console.log(JSON.stringify(installs, null, 2));
  process.exit(0);
}
if (
  [options["--portable"], options["--ae-path"], options["--panel-dir"]].filter(
    Boolean
  ).length > 1
)
  throw new Error("Choose one of --portable, --ae-path or --panel-dir.");
let destination = options["--panel-dir"];
if (options["--ae-path"]) {
  const ae = path.resolve(options["--ae-path"]);
  if (
    process.platform === "win32" &&
    !fs.existsSync(path.join(ae, "Support Files", "AfterFX.exe"))
  )
    throw new Error("No AfterFX.exe at custom AE installation.");
  destination = path.join(
    ae,
    ...(process.platform === "win32"
      ? ["Support Files", "Scripts", "ScriptUI Panels"]
      : ["Scripts", "ScriptUI Panels"])
  );
}
// MSIX-packaged clients can virtualize LocalAppData into private package
// storage that AE cannot see. Keep the shared default outside AppData.
const localBase = path.join(os.homedir(), ".after-effects-mcp");
destination = path.resolve(
  destination || path.join(localBase, "panel")
);
const panel = path.join(destination, "mcp-bridge-auto.jsx"),
  config = path.join(destination, "mcp-bridge.config.json");
const source = path.join(repo, "build", "scripts", "mcp-bridge-auto.jsx");
if (options["--uninstall"]) {
  // Deliberately remove only our panel; preserve settings and all bridge journals.
  if (fs.existsSync(panel)) fs.unlinkSync(panel);
  console.log(
    "Panel removed. Settings preserved at " +
      config +
      ". Remove the Codex MCP table separately."
  );
  process.exit(0);
}
const existing = fs.existsSync(config)
  ? JSON.parse(fs.readFileSync(config, "utf8"))
  : null;
const bridgeDirectory = path.resolve(
  options["--bridge-dir"] ||
    existing?.bridgeDirectory ||
    path.join(localBase, "bridge")
);
if (!fs.existsSync(source))
  throw new Error("Build first: npm ci --ignore-scripts && npm run build");
fs.mkdirSync(bridgeDirectory, { recursive: true, mode: 0o700 });
const probe = path.join(bridgeDirectory, ".installer-write-test");
fs.writeFileSync(probe, "test", { flag: "wx", mode: 0o600 });
fs.unlinkSync(probe);
try {
  fs.mkdirSync(destination, { recursive: true });
  fs.copyFileSync(source, panel);
  const hash = (f) =>
    createHash("sha256").update(fs.readFileSync(f)).digest("hex");
  if (hash(source) !== hash(panel))
    throw new Error("Installed panel checksum mismatch");
  const settings = { ...existing, bridgeDirectory };
  if (!existing || options["--bridge-dir"])
    fs.writeFileSync(config, JSON.stringify(settings, null, 2), "utf8");
  if (
    JSON.parse(fs.readFileSync(config, "utf8")).bridgeDirectory !==
    bridgeDirectory
  )
    throw new Error("Panel configuration verification failed");
  console.log(
    JSON.stringify(
      { panel, config, bridgeDirectory, sha256: hash(panel) },
      null,
      2
    )
  );
  console.log(
    "Verified. Portable: AE > File > Scripts > Run Script File. Docked install: restart AE, then Window > mcp-bridge-auto.jsx. Updates: Stop and reopen panel. Enable script file access if needed."
  );
} catch (e) {
  console.error(
    `Install failed: ${e.message}\nNo elevation was attempted. Use --portable, or manually copy ${source} and mcp-bridge.config.json into ${destination}.`
  );
  process.exitCode = 1;
}
