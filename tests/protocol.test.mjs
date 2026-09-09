import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { BridgeClient, atomicWrite } from "../build/bridge-client.js";
import { host } from "./host.mjs";
import { version, protocolVersion } from "../src/catalog.mjs";

test("atomic publication retries sharing violations with the same bytes and bounds failure", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "AE publication "));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const target = path.join(directory, "server.json");
  const rename = fs.renameSync;
  let attempts = 0;
  const temporaryPaths = new Set();
  const payload = { serverId: randomUUID(), updatedAt: 42 };
  try {
    fs.renameSync = (source, destination) => {
      attempts++;
      temporaryPaths.add(source);
      assert.deepEqual(JSON.parse(fs.readFileSync(source, "utf8")), payload);
      if (attempts < 3) throw Object.assign(new Error("sharing violation"), { code: "EPERM" });
      return rename(source, destination);
    };
    atomicWrite(target, payload);
    assert.equal(attempts, 3);
    assert.equal(temporaryPaths.size, 1);
    assert.deepEqual(JSON.parse(fs.readFileSync(target, "utf8")), payload);
    attempts = 0;
    fs.renameSync = () => {
      attempts++;
      throw Object.assign(new Error("still busy"), { code: "EBUSY" });
    };
    assert.throws(() => atomicWrite(target, { updatedAt: 43 }), /still busy/);
    assert.equal(attempts, 20);
    assert.deepEqual(JSON.parse(fs.readFileSync(target, "utf8")), payload);
    assert.deepEqual(fs.readdirSync(directory), ["server.json"]);
  } finally {
    fs.renameSync = rename;
  }
});

test("ExtendScript path validation accepts native absolute paths with spaces and Unicode", () => {
  const h = host(os.tmpdir());
  for (const directory of ["C:/Users/Test/AE 日本語", "H:\\AE bridge\\ü", "/Users/Test/AE ü"])
    assert.equal(h.run(`absoluteBridgePath(${JSON.stringify(directory)})`), true);
  for (const directory of ["relative/path", "C:relative", "", null])
    assert.equal(h.run(`absoluteBridgePath(${JSON.stringify(directory)})`), false);
});

test("shutdown releases exclusive ownership even if its final heartbeat write fails", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "AE shutdown "));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const bridge = new BridgeClient(directory);
  await bridge.start();
  const rename = fs.renameSync;
  try {
    fs.renameSync = () => { throw Object.assign(new Error("disk unavailable"), { code: "EIO" }); };
    await assert.rejects(bridge.close(), /disk unavailable/);
  } finally {
    fs.renameSync = rename;
  }
  const next = new BridgeClient(directory);
  await next.start();
  await next.close();
});
async function fixture(t, timeout = 1000) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "AE bridge 日本語 "));
  const bridge = new BridgeClient(directory, timeout);
  await bridge.start();
  const h = host(directory);
  h.run("hello()");
  atomicWrite(bridge.file("", "owner.json"), {
    panelId: "panel-test-123456789"
  });
  const server = { serverId: bridge.serverId };
  function pump() {
    for (const f of fs
      .readdirSync(bridge.file("requests", ""))
      .filter((f) => f.endsWith(".json")))
      h.handle(bridge.file("requests", f), server);
  }
  t.after(async () => {
    await bridge.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { bridge, h, pump, directory, server };
}
test("concurrent calls match their own final responses over spaces/Unicode paths", async (t) => {
  const { bridge, pump } = await fixture(t);
  const calls = Array.from({ length: 12 }, () => bridge.call("status", {}));
  pump();
  const results = await Promise.all(calls);
  assert.equal(new Set(results.map((r) => r.requestId)).size, 12);
  for (const r of results) {
    assert.equal(r.status, "success");
    assert.equal(r.data.connected, true);
  }
});
test("duplicate request executes once; missing response with started marker is unknown", async (t) => {
  const { bridge, h, pump } = await fixture(t);
  h.run(
    "var executions=0; perform=function(){executions++;return {count:executions};};"
  );
  const call = bridge.call("status", {});
  pump();
  const result = await call;
  pump();
  assert.equal(h.run("executions"), 1);
  fs.unlinkSync(bridge.file("results", result.requestId + ".json"));
  pump();
  assert.equal(h.run("executions"), 1);
  assert.equal(bridge.result(result.requestId).status, "outcome_unknown");
});
test("strict parser rejects executable, duplicate keys, partial and invalid JSON", async (t) => {
  const { h } = await fixture(t);
  for (const s of [
    "({x:1})",
    '{"x":(function(){return 1})()}',
    '{"x":1,"x":2}',
    '{"__proto__":{}}',
    "[1,]",
    '{"x":',
    "01",
    "1e999",
    '"a\nb"'
  ]) {
    assert.throws(() => h.run(`StrictJSON.parse(${JSON.stringify(s)})`));
  }
  const value = { s: '日本語\n"\\', n: -1.25e10, a: [true, false, null] };
  assert.deepEqual(
    JSON.parse(
      h.run(
        `StrictJSON.stringify(StrictJSON.parse(${JSON.stringify(JSON.stringify(value))}))`
      )
    ),
    value
  );
});
test("partial temp file ignored; malformed published request gets structured error", async (t) => {
  const { bridge, pump } = await fixture(t);
  fs.writeFileSync(bridge.file("requests", "partial.tmp"), "{");
  const id = randomUUID();
  fs.writeFileSync(bridge.file("requests", id + ".json"), "{");
  pump();
  assert.equal(bridge.result(id).status, "error");
  assert.equal(fs.readdirSync(bridge.file("started", "")).length, 0);
});
test("stale session, expired and incompatible requests never execute", async (t) => {
  const { bridge, h, pump } = await fixture(t);
  h.run("var executions=0; perform=function(){executions++;return {};};");
  for (const change of [
    { serverId: randomUUID() },
    { expiresAt: Date.now() - 1 },
    { protocolVersion: 99 }
  ]) {
    const requestId = randomUUID();
    atomicWrite(bridge.file("requests", requestId + ".json"), {
      protocolVersion,
      serverVersion: version,
      serverId: bridge.serverId,
      panelId: "panel-test-123456789",
      requestId,
      operation: "status",
      arguments: {},
      createdAt: Date.now() - 100,
      expiresAt: Date.now() + 1000,
      ...change
    });
    pump();
    assert.equal(bridge.result(requestId).status, "error");
  }
  assert.equal(h.run("executions"), 0);
});
test("timeout is unknown; late result can be reconciled without retry", async (t) => {
  const { bridge, pump } = await fixture(t, 100);
  let id;
  await assert.rejects(bridge.call("status", {}), (e) => {
    id = e.requestId;
    return e.code === "OUTCOME_UNKNOWN" && e.mayHaveChanged;
  });
  pump();
  assert.equal(bridge.result(id).error.code, "EXPIRED_REQUEST");
});
test("second server cannot acquire directory; restart fences pending requests", async (t) => {
  const { bridge, directory, h } = await fixture(t, 100);
  const second = new BridgeClient(directory, 100);
  await assert.rejects(
    second.start(),
    (e) => e.code === "SERVER_ALREADY_RUNNING"
  );
  const pending = bridge.call("status", {}).catch((e) => e);
  await bridge.close();
  assert.equal((await pending).code, "OUTCOME_UNKNOWN");
  const restarted = new BridgeClient(directory, 100);
  await restarted.start();
  try {
    for (const f of fs.readdirSync(bridge.file("requests", "")))
      h.handle(bridge.file("requests", f), { serverId: restarted.serverId });
    const r = JSON.parse(
      fs.readFileSync(
        bridge.file("results", fs.readdirSync(bridge.file("results", ""))[0]),
        "utf8"
      )
    );
    assert.equal(r.error.code, "STALE_SESSION");
  } finally {
    await restarted.close();
  }
});
test("response correlation mismatch and panel version mismatch fail honestly", async (t) => {
  const { bridge } = await fixture(t);
  const call = bridge.call("status", {});
  const f = fs.readdirSync(bridge.file("requests", ""))[0];
  const req = JSON.parse(fs.readFileSync(bridge.file("requests", f), "utf8"));
  atomicWrite(bridge.file("results", f), {
    ...req,
    operation: "other",
    status: "success",
    data: {}
  });
  await assert.rejects(
    call,
    (e) => e.code === "INVALID_RESPONSE" && e.mayHaveChanged
  );
  atomicWrite(bridge.file("panels", "panel-test-123456789.hello.json"), {
    panelId: "panel-test-123456789",
    updatedAt: Date.now(),
    protocolVersion: 99,
    bridgeVersion: "old"
  });
  await assert.rejects(
    bridge.call("status", {}),
    (e) => e.code === "VERSION_MISMATCH"
  );
});
test("queue and message limits, bounded retention", async (t) => {
  const { bridge, pump } = await fixture(t, 10000);
  const calls = Array.from({ length: 32 }, () => bridge.call("status", {}));
  await assert.rejects(
    bridge.call("status", {}),
    (e) => e.code === "QUEUE_FULL"
  );
  pump();
  await Promise.all(calls);
  await assert.rejects(
    bridge.call("status", { s: "x".repeat(1048576) }),
    (e) => e.code === "MESSAGE_TOO_LARGE"
  );
  const file = bridge.file("results", randomUUID() + ".json");
  fs.writeFileSync(file, "{}");
  fs.utimesSync(file, new Date(0), new Date(0));
  bridge.cleanup();
  assert.equal(fs.existsSync(file), false);
});

test("inactive/second panel cannot consume; heartbeat freshness never steals ownership", async (t) => {
  const { bridge, h } = await fixture(t);
  h.run(
    `var scheduled=0; app.scheduleTask=function(){scheduled++;return scheduled;};app.cancelTask=function(){};panelId='panel-second-123456789';`
  );
  const call = bridge.call("status", {});
  h.run("tick()");
  assert.equal(fs.readdirSync(bridge.file("started", "")).length, 0);
  assert.equal(
    JSON.parse(fs.readFileSync(bridge.file("", "owner.json"), "utf8")).panelId,
    "panel-test-123456789"
  );
  h.run(`panelId='panel-test-123456789';tick();`);
  assert.equal((await call).status, "success");
  h.run("stop();");
  assert.equal(h.run("stopped"), true);
  assert.equal(h.run("taskId"), null);
  await assert.rejects(
    bridge.call("status", {}),
    (e) => e.code === "PANEL_OFFLINE"
  );
});

test("a replaced panel cannot restart from its old Start callback", async (t) => {
  const { bridge, h } = await fixture(t);
  h.run(`
    var scheduled = 0, cancelled = 0, closed = 0;
    app.scheduleTask = function () { return ++scheduled; };
    app.cancelTask = function () { cancelled++; };
    function Window() {}
    ui = new Window();
    ui.close = function () { closed++; };
    tick();
    var previousId = panelId;
    dispose();
    start();
  `);
  assert.equal(h.run("panelId === previousId"), true);
  assert.equal(h.run("scheduled"), 1);
  assert.equal(h.run("cancelled"), 1);
  assert.equal(h.run("closed"), 1);
  assert.equal(h.run("stopped && retired && taskId === null"), true);
  assert.equal(
    fs.readdirSync(bridge.file("panels", "")).filter(f => f.endsWith(".hello.json")).length,
    1
  );
});

test("late completion after caller timeout is recoverable and malformed final responses fail closed", async (t) => {
  const { bridge } = await fixture(t, 100);
  let requestId;
  const call = bridge.call("status", {});
  const f = fs.readdirSync(bridge.file("requests", ""))[0];
  const r = JSON.parse(fs.readFileSync(bridge.file("requests", f), "utf8"));
  atomicWrite(bridge.file("started", f), { requestId: r.requestId });
  await assert.rejects(call, (e) => {
    requestId = e.requestId;
    return e.code === "OUTCOME_UNKNOWN";
  });
  atomicWrite(bridge.file("results", f), {
    ...r,
    status: "success",
    data: { connected: true }
  });
  assert.equal(bridge.result(requestId).status, "success");
  const malformed = bridge.call("status", {});
  const other = fs
    .readdirSync(bridge.file("requests", ""))
    .find((name) => name !== f);
  fs.writeFileSync(bridge.file("results", other), "{");
  await assert.rejects(malformed, (e) => e.code === "INVALID_RESPONSE");
});

test("started request from a prior server stays outcome unknown after restart", async (t) => {
  const { bridge, h, pump } = await fixture(t);
  const requestId = randomUUID();
  atomicWrite(bridge.file("requests", requestId + ".json"), {
    protocolVersion,
    serverVersion: version,
    serverId: randomUUID(),
    panelId: "panel-old-123456789",
    requestId,
    operation: "createComposition",
    arguments: {},
    createdAt: Date.now() - 10000,
    expiresAt: Date.now() - 9000
  });
  atomicWrite(bridge.file("started", requestId + ".json"), { requestId });
  h.run("var executions=0;perform=function(){executions++;};");
  pump();
  assert.equal(bridge.result(requestId).status, "outcome_unknown");
  assert.equal(h.run("executions"), 0);
});
