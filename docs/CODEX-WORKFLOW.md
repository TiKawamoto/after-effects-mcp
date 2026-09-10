# Working with AE from Codex

1. Call `bridge-status`; verify `connected`, versions and the expected bridge directory. Keep the panel open.
2. Inspect the project and intended composition/layer. Carry forward returned `projectSession`, `compositionId` and `layerId`. Names and indices are descriptive; never guess target IDs.
3. For property edits or keyframes, inspect `valueDimensions` and the current value. Preserve the third component when AE exposes one, including on 2D layers. Position is pixels, scale/opacity percentages, rotation degrees, time seconds and RGB color 0–1.
4. Wait for each dependent edit's final response. Use returned IDs when creating subsequent objects. A batch requires already-known targets, returns individual results, and stops on the first runtime error unless `stopOnError: false` is requested.
5. Inspect the resulting properties and the actual AE viewer/timeline. Each mutation has its own AE Undo group; Undo is recovery convenience, not rollback.
6. If a call times out, keep its request ID. Call `get-request-result`, inspect the actual targets, and reconcile the outcome before considering another mutation. Never automatically retry an uncertain edit.
7. After opening another project or restarting the panel, inspect again for a fresh session token. Close other MCP clients before switching between Codex and a standalone test client.

For a disposable acceptance project, ask Codex to use its `after_effects` MCP tools to create a five-second 1920×1080 composition, add a background/text/shape, animate text Position and Opacity, set a shape rotation expression and Fill, inspect keys/effect/expression, duplicate and delete only the test copy, run a property-plus-inspection batch, and verify an invalid composition ID leaves a separate control composition unchanged. Verify Undo and panel close/reopen in AE. See [ACCEPTANCE.md](ACCEPTANCE.md) for the exact reference scene.

Version 2.1 also provides structured property/text/effect editing and single-frame PNG previews. Follow [EDITING.md](EDITING.md) for property paths and easing dimensions. Capture frames after changes and inspect the returned images. General rendering jobs, media import and unrestricted JSX remain outside the integration. Use only capabilities present in discovered schemas.
