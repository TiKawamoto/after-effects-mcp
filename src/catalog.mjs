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
const choice = (...values) => ({ type: "string", enum: values });
const fields = (properties) => ({
  ...object(properties, []),
  minProperties: 1
});
const pathStep = object({
  index: integer(),
  matchName: string(),
  name: string(255, 0)
});
const propertyPath = array(pathStep, 1, 16);
const target = {
  anyOf: [object({ transform: property }), object({ path: propertyPath })]
};
const numericValue = { anyOf: [number(), array(number(), 2, 4)] };
const time = number(-10800, 10800);
const times = array(time, 1, 500);
const page = { offset: integer(0, 100000), limit: integer(1, 100) };
const ease = array(
  object({ speed: number(), influence: number(0.1, 100) }),
  1,
  3
);
Object.assign(catalog, {
  "list-effects": tool(
    "listEffects",
    "List installed effect matchNames; filter by name/category. Paginated. Discover before add-effect.",
    { query: string(255, 0), ...page },
    [],
    true
  ),
  "list-fonts": tool(
    "listFonts",
    "List installed PostScript font names for text editing. Requires AE font enumeration support. Paginated.",
    { query: string(255, 0), ...page },
    [],
    true
  ),
  "get-layer-properties": tool(
    "getLayerProperties",
    "Browse direct children of a layer or inspected property-group path. Returns guarded index/matchName/name paths, supported types and pagination. Reinspect after structural edits.",
    { ...layer, path: array(pathStep, 0, 16), ...page },
    Object.keys(layer),
    true
  ),
  "get-property-info": tool(
    "getPropertyInfo",
    "Inspect a numeric/color property, values, key times, interpolation and temporal easing. Target an inspected path or named transform. Complex/custom/text/shape-path values are not editable with this tool.",
    { ...layer, target },
    undefined,
    true
  ),
  "set-property-value": tool(
    "setPropertyValue",
    "Set a static numeric/vector/RGBA property by inspected target. Rejects animated or expression-driven values, incompatible dimensions and bounds.",
    { ...layer, target, value: numericValue },
    undefined
  ),
  "set-property-keyframes": tool(
    "setPropertyKeyframes",
    "Upsert up to 500 explicit keys on a numeric/color property. Times in seconds, including negative layer time. All values/times validate first; existing unrelated keys remain. Use set-keyframe-interpolation for easing.",
    {
      ...layer,
      target,
      keyframes: array(object({ time, value: numericValue }), 1, 500)
    },
    undefined
  ),
  "set-keyframe-interpolation": tool(
    "setKeyframeInterpolation",
    "Edit existing keys selected by exact times (1e-6 second tolerance). Set linear/hold/bezier interpolation; optional ease arrays use the inspected temporalEaseDimensions, which may differ from valueDimensions. Custom easing requires bezier. Disables temporal auto-Bezier/continuity and roving for custom easing.",
    {
      ...layer,
      target,
      times,
      interpolation: choice("linear", "hold", "bezier"),
      easeIn: ease,
      easeOut: ease
    },
    [...Object.keys(layer), "target", "times", "interpolation"]
  ),
  "delete-property-keyframes": tool(
    "deletePropertyKeyframes",
    "Delete only existing keys at the exact requested times. Resolves every key before deleting in descending order; fails if any key is missing.",
    { ...layer, target, times },
    undefined,
    false,
    true
  ),
  "set-property-expression": tool(
    "setPropertyExpression",
    "Set/remove an expression on a supported numeric/color property. Empty string removes it. Reports expression errors; partial edits remain undoable.",
    { ...layer, target, expression: string(16000, 0) },
    undefined
  ),
  "edit-text-layer": tool(
    "editTextLayer",
    "Edit existing static Source Text and whole-layer typography, preserving unspecified TextDocument fields. Style fields apply across the text and may flatten mixed styling. Font must be an installed PostScript name. Animated/expressed Source Text is rejected.",
    {
      ...layer,
      properties: fields({
        text: string(16000, 0),
        font: string(),
        fontSize: number(1, 1296),
        fillColor: color,
        applyFill: bool,
        strokeColor: color,
        applyStroke: bool,
        strokeWidth: number(0, 1000),
        tracking: number(-1000, 10000),
        leading: number(0, 10000),
        autoLeading: bool,
        justification: choice("left", "center", "right")
      })
    },
    undefined
  ),
  "set-layer-timing": tool(
    "setLayerTiming",
    "Move/trim a layer using composition seconds. Setting startTime shifts existing in/out points by the delta unless explicit replacements are supplied. Requires outPoint > inPoint; preserves stretch and source settings.",
    {
      ...layer,
      timing: fields({ startTime: time, inPoint: time, outPoint: time })
    },
    undefined
  ),
  "reorder-layer": tool(
    "reorderLayer",
    "Move this layer immediately before/after another stable layer ID in the same composition.",
    {
      ...layer,
      relativeLayerId: integer(),
      placement: choice("before", "after")
    },
    undefined
  ),
  "set-layer-parent": tool(
    "setLayerParent",
    "Parent to a stable layer ID in the same composition, or 0 to unparent. preserveAppearance defaults true (AE adjusts transforms); false keeps local transform values. Rejects cycles.",
    { ...layer, parentLayerId: integer(0), preserveAppearance: bool },
    [...Object.keys(layer), "parentLayerId"]
  ),
  "precompose-layers": tool(
    "precomposeLayers",
    "Precompose explicit unlocked layers, moving all attributes. Returns new composition and replacement layer IDs. Rejects parenting across the selection boundary. Old composition/layer targets must be reinspected.",
    { ...comp, layerIds: array(integer(), 1, 100), name: string() },
    undefined
  ),
  "create-null-layer": tool(
    "createNullLayer",
    "Create a 2D null controller spanning the composition.",
    { ...comp, name: string() },
    undefined
  ),
  "set-layer-switches": tool(
    "setLayerSwitches",
    "Set visibility/solo/shy/motion-blur/guide/adjustment switches or label color (0–16) on an unlocked layer. Unsupported switches are rejected before editing.",
    {
      ...layer,
      switches: fields({
        enabled: bool,
        solo: bool,
        shy: bool,
        motionBlur: bool,
        guideLayer: bool,
        adjustmentLayer: bool,
        label: integer(0, 16)
      })
    },
    undefined
  ),
  "add-effect": tool(
    "addEffect",
    "Add an installed effect using an exact matchName from list-effects. Returns a guarded path; inspect its parameters before editing. Reinspect paths after adding/removing/reordering effects.",
    { ...layer, matchName: string(), name: string() },
    [...Object.keys(layer), "matchName"]
  ),
  "edit-effect": tool(
    "editEffect",
    "Rename/enable/disable an effect selected by its inspected guarded path.",
    {
      ...layer,
      path: propertyPath,
      properties: fields({ name: string(), enabled: bool })
    },
    undefined
  ),
  "remove-effect": tool(
    "removeEffect",
    "Remove exactly one effect selected by its inspected guarded path. Reinspect remaining effect paths afterward.",
    { ...layer, path: propertyPath },
    undefined,
    false,
    true
  ),
  "capture-composition-frame": tool(
    "captureCompositionFrame",
    "Capture one native-resolution PNG at a composition time and return an MCP image. Max 8.3 million pixels/16 MiB. AE frame-capture availability is checked at runtime. Does not change composition time; writes only a generated preview artifact. Not available inside batches.",
    { ...comp, time: number(0, 10800) },
    undefined,
    true
  )
});
const batchItems = Object.values(catalog)
  .filter(
    (t) => t.operation !== "status" && t.operation !== "captureCompositionFrame"
  )
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
export const version = "2.1.0";
