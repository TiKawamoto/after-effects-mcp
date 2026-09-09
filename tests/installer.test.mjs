import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

test("installer verifies bytes with Unicode/spaces, preserves settings and supports uninstall", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "AE installer 日本語 "));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const panelDir = path.join(root, "panel dir"),
    bridge = path.join(root, "bridge ü");
  const run = (args) =>
    execFileSync(process.execPath, ["install-bridge.js", ...args], {
      encoding: "utf8",
      stdio: "pipe"
    });
  run(["--panel-dir", panelDir, "--bridge-dir", bridge]);
  const panel = path.join(panelDir, "mcp-bridge-auto.jsx"),
    config = path.join(panelDir, "mcp-bridge.config.json");
  assert.deepEqual(
    fs.readFileSync(panel),
    fs.readFileSync("build/scripts/mcp-bridge-auto.jsx")
  );
  const original = JSON.parse(fs.readFileSync(config, "utf8"));
  original.customSetting = "keep";
  fs.writeFileSync(config, JSON.stringify(original));
  run(["--panel-dir", panelDir]);
  assert.deepEqual(JSON.parse(fs.readFileSync(config, "utf8")), original);
  run(["--panel-dir", panelDir, "--uninstall"]);
  assert.equal(fs.existsSync(panel), false);
  assert.equal(fs.existsSync(config), true);
  assert.equal(fs.existsSync(bridge), true);
  assert.throws(() => run(["--bad-option"]), /Unknown or incomplete/);
});
