# Editing and frame previews (2.1)

Start with `bridge-status`, then inspect the intended composition/layer. Keep the returned project session and stable IDs. The original tools remain supported; the extension adds 20 tools. All edits retain the bridge's request correlation, undo groups, locking and no-replay behavior.

## Text and typography

`edit-text-layer` takes `properties` containing one or more of: text, font, fontSize, fillColor/applyFill, strokeColor/applyStroke/strokeWidth, tracking, leading/autoLeading and left/center/right justification. It edits the existing TextDocument and preserves unspecified fields. Style fields apply across the layer and may flatten mixed character styling. Animated or expressed Source Text is rejected, rather than silently replaced.

Use `list-fonts` to obtain an installed PostScript font name; missing fonts fail before writing. Font enumeration requires a recent AE version and reports CAPABILITY_UNAVAILABLE when missing. Setting explicit leading disables auto-leading; requesting both explicit leading and autoLeading=true is rejected. Changing color alone does not enable a previously disabled fill or stroke; specify the corresponding apply switch.

## Properties, effects and shapes

1. Call `get-layer-properties` with the stable layer IDs. Find the desired group.
2. Pass a returned `path` back to browse that group's children. Continue until a leaf is reached.
3. Call `get-property-info` with `target: {path: returnedPath}`. For the original transforms, `target: {transform: "position"}` is also supported.
4. Supply a value with the inspected dimensions to `set-property-value`, or explicit keys to `set-property-keyframes`.

Paths contain index, matchName and current name for every segment. Each segment is checked again before editing; rename/add/remove/reorder requires reinspection. Identically named siblings in indexed groups are rejected as ambiguous; rename them uniquely in AE. These paths are guarded references, not durable property IDs, and cannot detect replacement by an otherwise identical property. Do not cache them across manual structural edits.

Supported generic leaf types: scalar, 2D/3D vectors (including spatial vectors), and RGBA colors. Shape size/fill parameters and effects share this interface. Source Text, custom plug-in data, shape vertices, layer/mask indices, markers and other complex values require dedicated operations and are rejected here. Static writes reject animation/expressions; values are checked against AE's dimensions/minimum/maximum. AE may normalize a value; inspect the actual value returned.

`list-effects` returns installed matchNames with query/pagination. `add-effect` verifies installation and `canAddProperty`, then returns a guarded effect path. Browse that path to inspect parameters. `edit-effect` changes its name/enabled state; `remove-effect` removes it. The old `apply-effect` Fill convenience tool is unchanged. Only built-in Fill and Gaussian Blur have been exercised in the native acceptance run; third-party effects remain subject to their own property restrictions.

## Animation

`set-property-keyframes` upserts up to 500 `{time, value}` entries, preserving unrelated keys. Duplicate times and invalid values fail before the first write. The resulting property must stay within the 2,000-key inspection limit.

`set-keyframe-interpolation` targets existing keys by exact times, with a tolerance of one microsecond. Choose linear, hold or bezier. Optional `easeIn`/`easeOut` arrays contain `{speed, influence}` per **temporal ease dimension**; inspect this separately from value dimensions. In native AE, spatial Position has three value components but one temporal ease component. Custom easing requires Bezier and disables temporal auto-Bezier/continuity and spatial roving at the targeted keys.

`delete-property-keyframes` resolves every requested time before deletion and removes keys in descending index order. Missing or repeated keys fail without deletion. `set-property-expression` supports the same numeric/color targets; an empty string removes the expression. Expression-driven properties must have the expression removed before key editing.

## Layer organization

- `set-layer-timing`: composition seconds; startTime moves existing in/out points by its delta unless explicit replacements are supplied. Negative times are allowed within AE's limits. The final interval must have outPoint > inPoint. Stretch is preserved.
- `reorder-layer`: before/after another stable layer ID in the same composition.
- `set-layer-parent`: parentLayerId=0 unparents. preserveAppearance=true uses AE's compensating parent assignment; false keeps local transforms. Cycles are rejected. This is AE's native parenting behavior, not a promise to bake world-space animation over time.
- `create-null-layer`: adds a 2D controller spanning the composition.
- `set-layer-switches`: visibility, solo, shy, motion blur, guide, adjustment and label 0–16. Unsupported switches fail before writing.
- `precompose-layers`: move all attributes for the explicit unlocked selection. Reject duplicate IDs and parent relationships crossing the selection boundary. Return the new composition and replacement-layer IDs. Reinspect all targets afterward; no attempt is made to rewrite expressions or arbitrary dependencies outside the selection.

## Frame previews

`capture-composition-frame` takes composition identity and time (0 <= time < duration). It captures at native resolution through AE's `saveFrameToPng`, whose availability is tested at runtime. This method is not covered by Adobe's old CS6 guide and is treated as a version-dependent capability. Native AE 26.3x87 was tested. Composition time is restored if AE changes it.

The tool returns JSON metadata plus MCP `image/png` content. Files are generated as `previews/<requestId>.png` inside the configured bridge directory. No caller-supplied output path is accepted. Node verifies request identity, path confinement, file size, PNG header/dimensions and a complete IEND before sending image content. Native AE can finish writing after the script yields; delivery waits up to five seconds. A delivery failure retains the request ID and metadata: `get-request-result` can retrieve the completed artifact later without recapturing.

Limits: 8.3 million pixels, 16 MiB delivered PNG, 64 cached preview files. Captures prune generated PNGs older than 24 hours; a full cache is reported explicitly. Existing images can be removed from the preview folder when no capture is in progress. A maximum-resolution render may briefly produce a larger file than the delivery cap; it is not sent. Preview capture is standalone and excluded from execute-batch. Long/complex frames can exceed the normal bridge timeout; reconcile the request before retrying.

## Native acceptance

Close other MCP clients for the chosen directory, open the matching panel, and run:

```powershell
$env:AE_MCP_BRIDGE_DIR = 'C:\Users\YourName\.after-effects-mcp\bridge'
node scripts/acceptance-editing.mjs --create-disposable-comps
```

This opt-in fixture creates uniquely named compositions in the open project, exercises editing and negative cases, captures multiple frames, and records calls/images under `local-validation/editing-<timestamp>`. It checks existing composition summaries remain unchanged. Inspect the captured images too: successful parameter writes alone are not visual acceptance.
