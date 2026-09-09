// One catalog drives MCP discovery and validation in both Node and ExtendScript.
const number = (minimum = -1000000, maximum = 1000000) => ({
  type: "number",
  minimum,
  maximum
});
const integer = (minimum = 1, maximum = 2147483647) => ({
  type: "integer",
  minimum,
  maximum
});
const string = (maxLength = 255, minLength = 1) => ({
  type: "string",
  minLength,
  maxLength
});
const array = (items, minItems, maxItems = minItems) => ({
  type: "array",
  items,
  minItems,
  maxItems
});
const object = (properties, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false
});
const color = {
  ...array(number(0, 1), 3),
  description: "RGB channels from 0 to 1."
};
const vec = {
  ...array(number(), 2, 3),
  description:
    "Match the components returned by inspection (AE can expose 3 on 2D layers). Pixels for position/anchorPoint; percentages for scale."
};
const session = { projectSession: string(100) };
const comp = { ...session, compositionId: integer() };
const layer = { ...comp, layerId: integer() };
const property = {
  type: "string",
  enum: ["position", "anchorPoint", "scale", "rotation", "opacity"]
};
const value = { anyOf: [number(), vec] };
const bool = { type: "boolean" };
const transform = object(
  {
    position: vec,
    anchorPoint: vec,
    scale: vec,
    rotation: number(),
    opacity: number(0, 100),
    name: string(),
    enabled: bool
  },
  []
);
transform.minProperties = 1;
function tool(
  operation,
  description,
  properties,
  required,
  readOnly = false,
  destructive = false
) {
  return {
    operation,
    description,
    inputSchema: object(properties, required),
    annotations: {
      readOnlyHint: readOnly,
      destructiveHint: destructive,
      idempotentHint: readOnly,
      openWorldHint: false
    }
  };
}
export const catalog = {
  "bridge-status": tool(
    "status",
    "Round-trip probe of AE. Reports versions, directory and projectSession. A running MCP process alone is not a connection.",
    {},
    [],
    true
  ),
  "get-project-info": tool(
    "getProjectInfo",
    "Inspect the open project and compositions; returns projectSession and stable composition IDs.",
    {},
    [],
    true
  ),
  "list-compositions": tool(
    "listCompositions",
    "List composition IDs and settings in the open project.",
    {},
    [],
    true
  ),
  "get-composition-info": tool(
    "getCompositionInfo",
    "Inspect one exact composition and its layers.",
    comp,
    undefined,
    true
  ),
  "get-layer-info": tool(
    "getLayerInfo",
    "Inspect one exact layer, transform values, keyframes, expressions and effects.",
    layer,
    undefined,
    true
  ),
  "create-composition": tool(
    "createComposition",
    "Create an undoable composition. Width/height in pixels, duration in seconds, frameRate in frames/second.",
    {
      ...session,
      name: string(),
      width: integer(4, 30000),
      height: integer(4, 30000),
      duration: number(0.001, 10800),
      frameRate: number(1, 99),
      pixelAspect: number(0.01, 100)
    },
    ["projectSession", "name", "width", "height", "duration", "frameRate"]
  ),
  "create-text-layer": tool(
    "createTextLayer",
    "Create a 2D text layer with optional font size in pixels and RGB color in 0–1.",
    {
      ...comp,
      name: string(),
      text: string(16000, 0),
      fontSize: number(1, 1296),
      color,
      position: array(number(), 2)
    },
    ["projectSession", "compositionId", "text"]
  ),
  "create-shape-layer": tool(
    "createShapeLayer",
    "Create a rectangle or ellipse. Size/position are pixels, color is RGB 0–1.",
    {
      ...comp,
      name: string(),
      shape: { type: "string", enum: ["rectangle", "ellipse"] },
      size: array(number(0.01, 30000), 2),
      color,
      position: array(number(), 2)
    },
    ["projectSession", "compositionId", "name", "shape", "size", "color"]
  ),
  "create-solid-layer": tool(
    "createSolidLayer",
    "Create a full-composition 2D solid. RGB color uses 0–1.",
    { ...comp, name: string(), color },
    undefined
  ),
  "set-layer-properties": tool(
    "setLayerProperties",
    "Set static transforms, name or visibility on an unlocked layer. Rejects keyed/expressed properties. Position is pixels, rotation degrees, scale/opacity percentages.",
    { ...layer, properties: transform },
    undefined
  ),
  setLayerKeyframe: tool(
    "setLayerKeyframe",
    "Set exactly one keyframe, without inserting implicit keys. Time in seconds within composition; value must match property dimensions.",
    { ...layer, property, time: number(0, 10800), value },
    undefined
  ),
  setLayerExpression: tool(
    "setLayerExpression",
    "Set an AE property expression, or remove it with an empty string. Expressions run in AE’s expression engine; this does not execute JSX. Errors may leave an undoable partial edit.",
    { ...layer, property, expression: string(16000, 0) },
    undefined
  ),
  "apply-effect": tool(
    "applyEffect",
    "Add a supported built-in effect by matchName; currently ADBE Fill. Color uses RGB 0–1. Returns effect index and actual values.",
    { ...layer, effect: { type: "string", enum: ["ADBE Fill"] }, color },
    undefined
  ),
  "duplicate-layer": tool(
    "duplicateLayer",
    "Duplicate an unlocked layer and return the new stable layer ID.",
    { ...layer, name: string() },
    ["projectSession", "compositionId", "layerId"]
  ),
  "delete-layer": tool(
    "deleteLayer",
    "Delete exactly the identified unlocked layer, within an AE undo group.",
    layer,
    undefined,
    false,
    true
  )
};
const batchItems = Object.values(catalog)
  .filter((t) => t.operation !== "status")
  .map((t) =>
    object({
      operation: { type: "string", enum: [t.operation] },
      arguments: t.inputSchema
    })
  );
catalog["execute-batch"] = tool(
  "batch",
  "Execute up to 25 structured operations sequentially. Each entry is {operation, arguments} (not args). All arguments validate first; stopOnError defaults true. No rollback: returns each completed/failed/skipped operation. Use IDs from prior inspection; no implicit active targets.",
  { operations: array({ anyOf: batchItems }, 1, 25), stopOnError: bool },
  ["operations"],
  false,
  true
);
export const protocolVersion = 1;
export const version = "2.0.0";
