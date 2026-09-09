import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { host } from "./host.mjs";
import { catalog } from "../src/catalog.mjs";

test("real STDIO initialization, enumeration, schema validation and final/error responses", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "AE MCP 日本語 "));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve("build/index.js")],
    env: {
      ...process.env,
      AE_MCP_BRIDGE_DIR: directory,
      AE_MCP_TIMEOUT_MS: "1000"
    },
    stderr: "pipe"
  });
  const client = new Client({ name: "acceptance-test", version: "1.0.0" });
  t.after(async () => {
    await client.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await client.connect(transport);
  const tools = (await client.listTools()).tools;
  assert.equal(tools.length, Object.keys(catalog).length + 1);
  assert.equal(
    tools.find((t) => t.name === "delete-layer").annotations.destructiveHint,
    true
  );
  assert.equal(
    tools.find((t) => t.name === "bridge-status").annotations.readOnlyHint,
    true
  );
  assert.ok(!tools.some((t) => t.name === "run-script"));
  const invalid = await client.callTool({
    name: "create-composition",
    arguments: { name: "bad" }
  });
  assert.equal(invalid.isError, true);
  assert.match(invalid.content[0].text, /INVALID_ARGUMENTS/);
  const offline = await client.callTool({
    name: "bridge-status",
    arguments: {}
  });
  assert.equal(offline.isError, true);
  assert.match(offline.content[0].text, /PANEL_OFFLINE/);
  const h = host(directory);
  h.run("hello()");
  fs.writeFileSync(
    path.join(directory, "owner.json"),
    JSON.stringify({ panelId: "panel-test-123456789" })
  );
  const pump = setInterval(() => {
    const server = JSON.parse(
      fs.readFileSync(path.join(directory, "server.json"), "utf8")
    );
    for (const f of fs
      .readdirSync(path.join(directory, "requests"))
      .filter((f) => f.endsWith(".json")))
      h.handle(path.join(directory, "requests", f), server);
  }, 20);
  t.after(() => clearInterval(pump));
  const status = await client.callTool({
    name: "bridge-status",
    arguments: {}
  });
  assert.equal(status.isError, false);
  assert.equal(JSON.parse(status.content[0].text).data.connected, true);
  const targetError = await client.callTool({
    name: "get-layer-info",
    arguments: { projectSession: "wrong", compositionId: 1, layerId: 1 }
  });
  assert.equal(targetError.isError, true);
  assert.match(targetError.content[0].text, /PROJECT_CHANGED/);
  const unknown = await client.callTool({
    name: "unknown-tool",
    arguments: {}
  });
  assert.equal(unknown.isError, true);
});
