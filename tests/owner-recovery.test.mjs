import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { oldProcessEnded, recoverAbandonedOwner } from "../build/owner-recovery.js";
import { BridgeClient } from "../build/bridge-client.js";

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "AE recovery 日本語 "));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, "panels"));
  const now = Date.now(), panelId = `panel-${now - 60000}-12345`;
  const owner = path.join(directory, "owner.json");
  const hello = path.join(directory, "panels", `${panelId}.hello.json`);
  const release = path.join(directory, "panels", `${panelId}.released.json`);
  fs.writeFileSync(owner, JSON.stringify({ panelId }));
  fs.writeFileSync(hello, JSON.stringify({ panelId, updatedAt: now - 30000 }));
  const snapshot = { observedAt: now, processes: [{ pid: 123, startedAt: now - 10000 }] };
  return { directory, panelId, owner, hello, release, snapshot, now };
}

test("staleness alone never authorizes recovery; every surviving AE process must be newer", t => {
  const f = fixture(t), hello = JSON.parse(fs.readFileSync(f.hello));
  assert.equal(oldProcessEnded(f.panelId, hello, f.snapshot, f.now), true);
  const withOlderProcess = { ...f.snapshot, processes: [...f.snapshot.processes, { pid: 456, startedAt: f.now - 120000 }] };
  assert.equal(oldProcessEnded(f.panelId, hello, withOlderProcess, f.now), false);
  for (const snapshot of [{}, { ...f.snapshot, observedAt: f.now - 15000 }, { ...f.snapshot, processes: [{ pid: 123, startedAt: null }] }, { ...f.snapshot, processes: [{ pid: 123, startedAt: f.now + 5000 }] }])
    assert.equal(oldProcessEnded(f.panelId, hello, snapshot, f.now), false);
  assert.equal(oldProcessEnded(f.panelId, undefined, f.snapshot, f.now), false);
  assert.equal(oldProcessEnded(f.panelId, undefined, { ...f.snapshot, processes: [] }, f.now), true);
  assert.equal(oldProcessEnded(f.panelId, { ...hello, updatedAt: f.now }, f.snapshot, f.now), false);
});

test("verified recovery publishes evidence without deleting ownership or request journals", async t => {
  const f = fixture(t);
  for (const name of ["requests", "results", "started"]) {
    fs.mkdirSync(path.join(f.directory, name));
    fs.writeFileSync(path.join(f.directory, name, "keep.json"), "original");
  }
  const result = await recoverAbandonedOwner(f.directory, async () => f.snapshot);
  assert.equal(result.recovered, true);
  assert.equal(JSON.parse(fs.readFileSync(f.release)).reason, "previous-ae-process-ended");
  assert.equal(JSON.parse(fs.readFileSync(f.owner)).panelId, f.panelId);
  for (const name of ["requests", "results", "started"]) assert.equal(fs.readFileSync(path.join(f.directory, name, "keep.json"), "utf8"), "original");
  assert.equal((await recoverAbandonedOwner(f.directory, async () => { throw new Error("must not re-query"); })).recovered, false);
});

test("recovery refuses failed process inspection, changed owners and resumed heartbeats", async t => {
  const f = fixture(t);
  await assert.rejects(recoverAbandonedOwner(f.directory, async () => { throw new Error("access denied"); }), /access denied/);
  assert.equal(fs.existsSync(f.release), false);
  const resumed = await recoverAbandonedOwner(f.directory, async () => {
    fs.writeFileSync(f.hello, JSON.stringify({ panelId: f.panelId, updatedAt: Date.now() }));
    return f.snapshot;
  });
  assert.equal(resumed.recovered, false);
  assert.equal(fs.existsSync(f.release), false);
  fs.writeFileSync(f.hello, JSON.stringify({ panelId: f.panelId, updatedAt: f.now - 30000 }));
  const changed = await recoverAbandonedOwner(f.directory, async () => {
    fs.writeFileSync(f.owner, JSON.stringify({ panelId: `panel-${f.now}-98765` }));
    return f.snapshot;
  });
  assert.equal(changed.recovered, false);
  assert.equal(fs.existsSync(f.release), false);
});

test("server elects the waiting panel after verified release and retains owner evidence", async t => {
  const f = fixture(t);
  await recoverAbandonedOwner(f.directory, async () => f.snapshot);
  const nextId = `panel-${Date.now()}-67890`;
  const nextHello = path.join(f.directory, "panels", `${nextId}.hello.json`);
  fs.writeFileSync(nextHello, JSON.stringify({ panelId: nextId, updatedAt: Date.now() }));
  const bridge = new BridgeClient(f.directory);
  try {
    await bridge.start();
    assert.equal(JSON.parse(fs.readFileSync(f.owner)).panelId, nextId);
    fs.utimesSync(nextHello, 0, 0);
    bridge.cleanup();
    assert.equal(fs.existsSync(nextHello), true, "Current owner evidence must survive ordinary retention");
  } finally { await bridge.close(); }
});
