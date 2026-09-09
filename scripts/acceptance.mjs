// Executes the real MCP workflow. Refuses to mutate any nonempty project initially.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const c = new Client({ name: "ae-real-acceptance", version: "1.0.0" }),
  records = [];
const report = path.resolve(
  "local-validation",
  "acceptance-" + Date.now() + ".json"
);
fs.mkdirSync(path.dirname(report), { recursive: true });
await c.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve("build/index.js")],
    env: { ...process.env },
    stderr: "inherit"
  })
);
async function call(name, args = {}, expectError = false) {
  const result = await c.callTool({ name, arguments: args });
  const response = JSON.parse(result.content[0].text);
  records.push({ tool: name, arguments: args, ...response });
  fs.writeFileSync(report, JSON.stringify(records, null, 2));
  assert.equal(!!result.isError, expectError, JSON.stringify(response));
  return response.data;
}
try {
  // Wait for initial owner grant; retry only the read-only status probe.
  let status;
  for (let i = 0; i < 10; i++) {
    try {
      status = await call("bridge-status");
      break;
    } catch (e) {
      if (i === 9) throw e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  const project = await call("get-project-info");
  assert.equal(
    project.itemCount,
    0,
    "Acceptance needs a NEW EMPTY DISPOSABLE project; no edits were made."
  );
  const projectSession = status.projectSession;
  const comp = await call("create-composition", {
    projectSession,
    name: "MCP Acceptance",
    width: 1920,
    height: 1080,
    duration: 5,
    frameRate: 30
  });
  const target = { projectSession, compositionId: comp.compositionId };
  const background = await call("create-solid-layer", {
    ...target,
    name: "Background",
    color: [0.04, 0.07, 0.12]
  });
  const text = await call("create-text-layer", {
    ...target,
    name: "Title",
    text: "Dependable AE MCP",
    fontSize: 92,
    color: [1, 1, 1],
    position: [480, 440]
  });
  const shape = await call("create-shape-layer", {
    ...target,
    name: "Accent",
    shape: "rectangle",
    size: [600, 12],
    color: [0.1, 0.8, 0.7],
    position: [960, 600]
  });
  const textTarget = { ...target, layerId: text.layerId },
    shapeTarget = { ...target, layerId: shape.layerId };
  await call("set-layer-properties", {
    ...shapeTarget,
    properties: { rotation: -3, opacity: 85 }
  });
  await call("setLayerKeyframe", {
    ...textTarget,
    property: "position",
    time: 0,
    value: [480, 440].concat(text.transforms.position.value.slice(2))
  });
  await call("setLayerKeyframe", {
    ...textTarget,
    property: "position",
    time: 2,
    value: [680, 440].concat(text.transforms.position.value.slice(2))
  });
  await call("setLayerKeyframe", {
    ...textTarget,
    property: "opacity",
    time: 0,
    value: 0
  });
  await call("setLayerKeyframe", {
    ...textTarget,
    property: "opacity",
    time: 1,
    value: 100
  });
  await call("setLayerExpression", {
    ...shapeTarget,
    property: "rotation",
    expression: "Math.sin(time * 2) * 3"
  });
  await call("apply-effect", {
    ...shapeTarget,
    effect: "ADBE Fill",
    color: [0.2, 0.65, 1]
  });
  const inspected = await call("get-layer-info", textTarget);
  assert.deepEqual(inspected.transforms.position.keyframes.map((key) => key.time), [0, 2]);
  assert.deepEqual(inspected.transforms.position.keyframes.map((key) => key.value), [
    [480, 440].concat(text.transforms.position.value.slice(2)),
    [680, 440].concat(text.transforms.position.value.slice(2))
  ]);
  assert.deepEqual(inspected.transforms.opacity.keyframes.map((key) => [key.time, key.value]), [[0, 0], [1, 100]]);
  const inspectedShape = await call("get-layer-info", shapeTarget);
  assert.equal(inspectedShape.transforms.rotation.expression, "Math.sin(time * 2) * 3");
  assert.equal(inspectedShape.transforms.rotation.expressionEnabled, true);
  assert.equal(inspectedShape.transforms.rotation.expressionError, "");
  assert.equal(inspectedShape.effects[0].matchName, "ADBE Fill");
  assert.ok(inspectedShape.effects[0].color.slice(0, 3).every((value, index) => Math.abs(value - [0.2, 0.65, 1][index]) < 0.00001));
  const duplicate = await call("duplicate-layer", {
    ...shapeTarget,
    name: "Delete Me"
  });
  assert.equal(duplicate.original.index, duplicate.duplicate.index + 1);
  assert.notEqual(duplicate.original.layerId, duplicate.duplicate.layerId);
  await call("delete-layer", {
    ...target,
    layerId: duplicate.duplicate.layerId
  });
  const batch = await call("execute-batch", {
    operations: [
      {
        operation: "setLayerProperties",
        arguments: { ...shapeTarget, properties: { scale: shape.transforms.scale.value.map((value, index) => index < 2 ? 105 : value) } }
      },
      { operation: "getLayerInfo", arguments: shapeTarget }
    ]
  });
  assert.equal(batch.results.length, 2);
  assert.ok(batch.results.every((result) => result.status === "success"));
  const other = await call("create-composition", {
    projectSession,
    name: "Untouched Control",
    width: 640,
    height: 360,
    duration: 5,
    frameRate: 30
  });
  await call(
    "set-layer-properties",
    {
      projectSession,
      compositionId: 2147483647,
      layerId: shape.layerId,
      properties: { name: "WRONG" }
    },
    true
  );
  const control = await call("get-composition-info", {
    projectSession,
    compositionId: other.compositionId
  });
  assert.equal(control.layerCount, 0);
  const final = await call("get-composition-info", target);
  assert.equal(final.layerCount, 3);
  const successfulRecords = records.filter((record) => record.requestId);
  assert.equal(new Set(successfulRecords.map((record) => record.requestId)).size, successfulRecords.length);
  console.log(
    JSON.stringify(
      {
        result: "MCP assertions passed; real visual/undo/reopen checks remain",
        report,
        target,
        backgroundId: background.layerId,
        textId: text.layerId,
        shapeId: shape.layerId
      },
      null,
      2
    )
  );
} finally {
  await c.close();
}
