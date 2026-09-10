// Opt-in live SDK test. Creates uniquely named disposable comps; never edits existing ones.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
if (!process.argv.includes("--create-disposable-comps"))
  throw new Error(
    "Pass --create-disposable-comps to authorize the live fixture."
  );
const directory = process.env.AE_MCP_BRIDGE_DIR;
if (!directory || !path.isAbsolute(directory))
  throw new Error("Set AE_MCP_BRIDGE_DIR to the live test panel directory.");
const runId = Date.now();
const output = path.resolve("local-validation", `editing-${runId}`);
fs.mkdirSync(output, { recursive: true });
const client = new Client({
  name: "editing-native-acceptance",
  version: "2.1.0"
});
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve("build/index.js")],
    env: {
      ...process.env,
      AE_MCP_BRIDGE_DIR: directory,
      AE_MCP_TIMEOUT_MS: "30000"
    },
    stderr: "inherit"
  })
);
async function call(name, args = {}, expectedError) {
  const response = await client.callTool({ name, arguments: args });
  const result = JSON.parse(
    response.content.find((c) => c.type === "text").text
  );
  const images = response.content.filter((c) => c.type === "image");
  for (const img of images)
    fs.writeFileSync(
      path.join(output, `${result.requestId}.png`),
      Buffer.from(img.data, "base64")
    );
  fs.appendFileSync(
    path.join(output, "calls.ndjson"),
    JSON.stringify({ name, args, result, images: images.length }) + "\n"
  );
  console.log(name, result.status, result.error?.code || "");
  if (expectedError) {
    assert.equal(result.error?.code, expectedError, JSON.stringify(result));
    return result;
  }
  assert.equal(response.isError, false, JSON.stringify(result));
  if (name === "capture-composition-frame") {
    assert.equal(images.length, 1, "MCP must deliver native image content");
    const recovered = await client.callTool({
      name: "get-request-result",
      arguments: { requestId: result.requestId }
    });
    assert.equal(recovered.isError, false);
    assert.deepEqual(recovered.content.filter(c => c.type === "image"), images);
  }
  return result.data;
}
try {
  const status = await call("bridge-status");
  assert.equal(status.bridgeVersion, "2.1.0");
  const projectSession = status.projectSession;
  const before = await call("list-compositions");
  const c = await call("create-composition", {
    projectSession,
    name: `Editing acceptance ${runId}`,
    width: 640,
    height: 360,
    duration: 5,
    frameRate: 30
  });
  const comp = { projectSession, compositionId: c.compositionId };
  const layer = (l) => ({ ...comp, layerId: l.layerId });
  const background = await call("create-solid-layer", {
    ...comp,
    name: "Background",
    color: [0.025, 0.05, 0.09]
  });
  const text = await call("create-text-layer", {
    ...comp,
    name: "Title",
    text: "Before editing",
    fontSize: 32,
    position: [80, 150]
  });
  const fonts = await call("list-fonts", { query: text.text.font, limit: 10 });
  assert.ok(fonts.items.some((f) => f.postScriptName === text.text.font));
  const edited = await call("edit-text-layer", {
    ...layer(text),
    properties: {
      text: "Editing tools verified",
      font: text.text.font,
      fontSize: 34,
      fillColor: [1, 1, 1],
      tracking: 15,
      justification: "left"
    }
  });
  assert.equal(edited.text.text, "Editing tools verified");
  assert.equal(edited.text.fontSize, 34);
  assert.equal(edited.text.justification, "left");
  for (const justification of ["center", "right", "left"]) {
    const aligned = await call("edit-text-layer", {
      ...layer(text),
      properties: { justification }
    });
    assert.equal(aligned.text.justification, justification);
  }
  await call(
    "edit-text-layer",
    { ...layer(text), properties: { font: "MCP Missing Font 123" } },
    "FONT_UNAVAILABLE"
  );
  const shape = await call("create-shape-layer", {
    ...comp,
    name: "Accent",
    shape: "rectangle",
    size: [250, 8],
    color: [0.1, 0.6, 1],
    position: [320, 215]
  });
  const positionTarget = { transform: "position" };
  const pos = await call("get-property-info", {
    ...layer(text),
    target: positionTarget
  });
  const v0 = pos.property.value.slice(),
    v2 = v0.slice();
  v0[0] = 35;
  v2[0] = 95;
  await call("set-property-keyframes", {
    ...layer(text),
    target: positionTarget,
    keyframes: [
      { time: 0, value: v0 },
      { time: 1, value: v0 },
      { time: 2, value: v2 }
    ]
  });
  const keyed = await call("get-property-info", {
    ...layer(text),
    target: positionTarget
  });
  const ease = Array.from(
    { length: keyed.property.temporalEaseDimensions },
    () => ({ speed: 0, influence: 65 })
  );
  for (const interpolation of ["hold", "linear"]) {
    const changed = await call("set-keyframe-interpolation", {
      ...layer(text),
      target: positionTarget,
      times: [0, 2],
      interpolation
    });
    assert.equal(changed.property.keyframes[0].interpolationOut, interpolation);
  }
  const eased = await call("set-keyframe-interpolation", {
    ...layer(text),
    target: positionTarget,
    times: [0, 2],
    interpolation: "bezier",
    easeIn: ease,
    easeOut: ease
  });
  assert.equal(eased.property.keyframes[0].interpolationOut, "bezier");
  assert.ok(
    Math.abs(eased.property.keyframes[0].easeOut[0].influence - 65) < 0.01
  );
  await call("delete-property-keyframes", {
    ...layer(text),
    target: positionTarget,
    times: [1]
  });
  await call(
    "delete-property-keyframes",
    { ...layer(text), target: positionTarget, times: [1.5] },
    "KEYFRAME_NOT_FOUND"
  );
  const scalar = { transform: "rotation" };
  await call("set-property-expression", {
    ...layer(shape),
    target: scalar,
    expression: "time * 2"
  });
  await call("set-property-expression", {
    ...layer(shape),
    target: scalar,
    expression: ""
  });
  const fillEffects = await call("list-effects", { query: "Fill", limit: 100 });
  assert.ok(fillEffects.items.some((e) => e.matchName === "ADBE Fill"));
  const fx = await call("add-effect", {
    ...layer(shape),
    matchName: "ADBE Fill",
    name: "MCP Accent Fill"
  });
  const params = await call("get-layer-properties", {
    ...layer(shape),
    path: fx.path
  });
  const color = params.items.find((p) => p.matchName === "ADBE Fill-0002");
  assert.ok(color);
  const colored = await call("set-property-value", {
    ...layer(shape),
    target: { path: color.path },
    value: [0.15, 0.7, 1, 1]
  });
  assert.ok(Math.abs(colored.property.value[1] - 0.7) < 0.0001);
  const renamed = await call("edit-effect", {
    ...layer(shape),
    path: fx.path,
    properties: { name: "Renamed Fill", enabled: false }
  });
  await call(
    "set-property-value",
    { ...layer(shape), target: { path: color.path }, value: [1, 0, 0, 1] },
    "PROPERTY_PATH_CHANGED"
  );
  await call("edit-effect", {
    ...layer(shape),
    path: renamed.path,
    properties: { enabled: true }
  });
  const blurEffects = await call("list-effects", {
    query: "Gaussian",
    limit: 100
  });
  const blurMatch = blurEffects.items.find(
    (e) => e.matchName === "ADBE Gaussian Blur 2"
  );
  assert.ok(blurMatch);
  const blur = await call("add-effect", {
    ...layer(shape),
    matchName: blurMatch.matchName,
    name: "MCP Blur"
  });
  const blurParams = await call("get-layer-properties", {
    ...layer(shape),
    path: blur.path
  });
  const amount = blurParams.items.find(
    (p) => p.matchName === "ADBE Gaussian Blur 2-0001"
  );
  assert.ok(amount);
  await call("set-property-value", {
    ...layer(shape),
    target: { path: amount.path },
    value: 2
  });
  await call("remove-effect", { ...layer(shape), path: blur.path });
  const groups = await call("get-layer-properties", { ...layer(shape) });
  assert.ok(
    groups.items.some((p) => p.matchName === "ADBE Root Vectors Group")
  );
  // Walk the inspected shape tree to exercise nested indexed groups.
  const vectors = groups.items.find(
    (p) => p.matchName === "ADBE Root Vectors Group"
  );
  const vectorGroups = await call("get-layer-properties", {
    ...layer(shape),
    path: vectors.path
  });
  const groupProps = await call("get-layer-properties", {
    ...layer(shape),
    path: vectorGroups.items[0].path
  });
  const contents = groupProps.items.find(
    (p) => p.matchName === "ADBE Vectors Group"
  );
  assert.ok(contents);
  const contentProps = await call("get-layer-properties", {
    ...layer(shape),
    path: contents.path
  });
  const rect = contentProps.items.find(
    (p) => p.matchName === "ADBE Vector Shape - Rect"
  );
  assert.ok(rect);
  const rectProps = await call("get-layer-properties", {
    ...layer(shape),
    path: rect.path
  });
  const size = rectProps.items.find(
    (p) => p.matchName === "ADBE Vector Rect Size"
  );
  assert.ok(size);
  await call("set-property-value", {
    ...layer(shape),
    target: { path: size.path },
    value: [280, 10]
  });
  const timed = await call("set-layer-timing", {
    ...layer(shape),
    timing: { startTime: 0.2, inPoint: 0, outPoint: 4.5 }
  });
  assert.equal(timed.outPoint, 4.5);
  const switches = await call("set-layer-switches", {
    ...layer(shape),
    switches: { shy: true, label: 9, motionBlur: true }
  });
  assert.equal(switches.shy, true);
  assert.equal(switches.label, 9);
  await call("reorder-layer", {
    ...layer(shape),
    relativeLayerId: text.layerId,
    placement: "after"
  });
  const controller = await call("create-null-layer", {
    ...comp,
    name: "Controller"
  });
  const parented = await call("set-layer-parent", {
    ...layer(text),
    parentLayerId: controller.layerId
  });
  assert.equal(parented.parentLayerId, controller.layerId);
  await call(
    "set-layer-parent",
    { ...layer(controller), parentLayerId: text.layerId },
    "PARENT_CYCLE"
  );
  const preview0 = await call("capture-composition-frame", {
    ...comp,
    time: 0
  });
  const preview2 = await call("capture-composition-frame", {
    ...comp,
    time: 2
  });
  await call(
    "precompose-layers",
    { ...comp, layerIds: [text.layerId], name: "Invalid external parent" },
    "EXTERNAL_PARENT"
  );
  const precomp = await call("precompose-layers", {
    ...comp,
    layerIds: [text.layerId, controller.layerId],
    name: `Title precomp ${runId}`
  });
  assert.ok(precomp.replacementLayer?.layerId);
  const final = await call("get-composition-info", comp);
  assert.equal(final.layers.length, 3);
  const afterPrecompose = await call("capture-composition-frame", { ...comp, time: 2 });
  assert.deepEqual(
    fs.readFileSync(path.join(output, afterPrecompose.artifact)),
    fs.readFileSync(path.join(output, preview2.artifact)),
    "Precomposing this fixture must preserve its rendered frame"
  );
  const after = await call("list-compositions");
  for (const original of before.compositions)
    assert.deepEqual(
      after.compositions.find(
        (c) => c.compositionId === original.compositionId
      ),
      original
    );
  fs.writeFileSync(
    path.join(output, "summary.json"),
    JSON.stringify(
      {
        passed: true,
        status,
        compositionId: c.compositionId,
        precomp,
        preview0,
        preview2,
        output
      },
      null,
      2
    )
  );
  console.log("PASS", output);
} finally {
  await client.close();
}
