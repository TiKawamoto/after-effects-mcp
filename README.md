# After Effects MCP — dependable personal bridge

A local Node/STDIO MCP server and an ES3 ExtendScript panel. The panel executes structured operations sequentially inside After Effects. Version 2.1 adds property/effect editing, text typography, animation controls, layer organization and PNG frame previews to the correlated file bridge. Install the matching panel when updating.

**Validation status:** The original bridge passed automated, live AE and Codex-driven workflows. The editing/preview extension has additional automated and native AE 26.3x87 checks. See [docs/EDITING.md](docs/EDITING.md) for the new workflow and [docs/VALIDATION.md](docs/VALIDATION.md) for evidence and limits.

## Requirements and installation

- Node 22 or later; Adobe After Effects 22 or later (stable layer IDs). Windows is the primary target. Other platforms are not acceptance-tested.
- A local directory owned by your account. Avoid OneDrive, network shares and cloud-synced folders for the bridge.
- AE: Preferences > Scripting & Expressions > **Allow Scripts to Write Files and Access Network**.

Review `package.json`, the lockfile and `install-bridge.js`, then:

```powershell
npm ci --ignore-scripts
npm test
node install-bridge.js --portable
```

Installation prints and verifies the exact panel, adjacent configuration file, bridge directory and SHA-256. The portable defaults are `.after-effects-mcp/panel` and `.after-effects-mcp/bridge` inside your home directory (`%USERPROFILE%` on Windows). This avoids the private AppData virtualization observed with the MSIX Codex app: a file visible there to Codex can be invisible to AE. There is no Documents-path guessing and no automatic elevation. Both processes use the directory chosen by the installer: AE reads `mcp-bridge.config.json` beside the installed JSX; Node requires `AE_MCP_BRIDGE_DIR`.

Open the portable panel with **File > Scripts > Run Script File**, selecting the printed `mcp-bridge-auto.jsx`. Leave the palette open and click Start if stopped. Portable use does not require restarting AE. The panel shows its directory and connection state. A healthy connection requires Node and the panel to run at the same time.

To install a dockable panel, list real installations and explicitly select one:

```powershell
node install-bridge.js --list
node install-bridge.js --ae-path "C:\Program Files\Adobe\Adobe After Effects 2026"
# Alternatively, supply the exact ScriptUI Panels directory:
node install-bridge.js --panel-dir "D:\Custom AE\Support Files\Scripts\ScriptUI Panels"
# Custom local bridge directory, including spaces and Unicode:
node install-bridge.js --portable --bridge-dir "C:\Users\YourName\AE Bridge 日本語"
```

Restart AE after a new dockable installation, then open **Window > mcp-bridge-auto.jsx**. If application-directory permissions prevent copying, use portable mode, or manually copy the built JSX and the configuration file into ScriptUI Panels using File Explorer. Elevation, if needed, should cover only this copy. Installer failure is reported as failure; it never launches an unwaited elevated shell.

AE 26.3 also supports **File > Scripts > Install ScriptUI Panel**, which installs into the per-user preferences directory. Run this installer with `--panel-dir` pointing to that directory afterward so the adjacent configuration is installed too (on the verified Windows installation: `%APPDATA%\Adobe\After Effects\26.3\Scripts\ScriptUI Panels`). Stop polling before opening script file dialogs. On updates, close and reopen the panel from Window; restart the MCP client to load the matching server and tools.

Manual configuration beside the installed JSX:

```json
{"bridgeDirectory":"C:/Users/YourName/.after-effects-mcp/bridge"}
```

On Windows the installer uses the directory's inherited ACLs. Inspect them with `icacls` if using a custom location; do not use a directory writable by untrusted accounts. This is a trusted same-user integration, not a sandbox against software already running as your account.

## Codex setup

[Official Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) specifies a `[mcp_servers.NAME]` table in `~/.codex/config.toml`. Preserve other entries and replace the example paths with absolute paths for your machine:

```toml
[mcp_servers.after_effects]
command = 'B:\Program Files\nodejs\node.exe'
args = ['H:\Github\After Effects MCP\build\index.js']
startup_timeout_sec = 15
tool_timeout_sec = 45

[mcp_servers.after_effects.env]
AE_MCP_BRIDGE_DIR = 'C:\Users\YourName\.after-effects-mcp\bridge'
AE_MCP_TIMEOUT_MS = '30000'
```

Reconnect/reload Codex's MCP connection after configuration changes. Verify tool discovery and call `bridge-status`. The reply must contain `connected: true`, AE/server/bridge/protocol versions, the expected directory and `projectSession`. Merely listing a configured MCP process is insufficient.

See [the Codex workflow](docs/CODEX-WORKFLOW.md) for targeting, dimensions, inspection and timeout recovery instructions.

One MCP server and one active panel own each directory. A second server fails explicitly, preventing duplicate consumers; close other clients before running the standalone acceptance script. The Windows lock is a kernel-held named pipe, released on process death. Non-Windows uses a loopback port derived from the directory, with possible conservative lock collisions.

## Tools and targeting

`src/catalog.mjs` is the authoritative tool/schema catalog. The same argument validator and catalog are included in the panel at build time.

| Tools | Behavior |
| --- | --- |
| `bridge-status` | Real round-trip liveness probe; no project edit |
| `get-project-info`, `list-compositions` | Inspect current project; return `projectSession` and composition IDs |
| `get-composition-info`, `get-layer-info` | Inspect exact IDs; layer details include transforms, keyframes, expressions and effects |
| `create-composition` | Create composition, returning its ID/settings |
| `create-text-layer`, `create-shape-layer`, `create-solid-layer` | Create layers, returning stable IDs and resulting values |
| `set-layer-properties` | Static position, anchor point, scale, rotation, opacity, name, visibility |
| `setLayerKeyframe`, `setLayerExpression` | One keyframe or expression on a supported transform |
| `apply-effect` | Built-in `ADBE Fill`, with explicit RGB color |
| `duplicate-layer`, `delete-layer` | Exact-ID edits; delete is marked destructive |
| `execute-batch` | Up to 25 structured operations, individual results, explicit partial failure |
| `get-request-result` | Read a retained result/started record after uncertainty; never retries |
| `list-fonts`, `edit-text-layer` | Installed PostScript fonts and existing static Source Text/whole-layer typography |
| `get-layer-properties`, `get-property-info` | Paginated property-group browsing and numeric/color values, keys and easing |
| `set-property-value`, `set-property-expression` | Guarded numeric/vector/RGBA edits and expressions, including effects and shape parameters |
| `set-property-keyframes`, `set-keyframe-interpolation`, `delete-property-keyframes` | Multiple explicit keys, linear/hold/Bezier interpolation, temporal ease and exact-time deletion |
| `set-layer-timing`, `set-layer-switches`, `reorder-layer` | Start/trim, visibility/solo/shy/motion blur/labels and relative ordering |
| `create-null-layer`, `set-layer-parent`, `precompose-layers` | Controllers, parenting/unparenting, and precompose with all attributes |
| `list-effects`, `add-effect`, `edit-effect`, `remove-effect` | Discover installed matchNames, add, rename, enable/disable and remove effects |
| `capture-composition-frame` | Native PNG at an explicit time, delivered as MCP image content; standalone only |

Inspect first and carry forward returned `projectSession`, `compositionId` and `layerId`. Targets are required. There is no fallback to the active composition, layer name or shifting index. Names and indices are descriptive only. Opening/replacing the project or restarting the panel invalidates its project-session token; inspect again. IDs should not be cached across project imports, reloads or panel restarts.

Use pixels for positions and dimensions, seconds for times/durations, degrees for rotation, percentages for scale/opacity, and RGB/RGBA values in **0–1**. Match inspected `valueDimensions`; AE can expose three-component Position/Scale even on a 2D layer. Match `temporalEaseDimensions` separately: spatial Position uses one ease component. Named-transform shortcuts reject separated position; property browsing can target individual numeric followers. Static edits reject keyed/expressed properties. Locked layers fail without being unlocked. Keyframe tools insert only explicit keys.

Shape creation supports rectangles/ellipses; property paths expose their numeric size, color and other parameters. `add-effect` accepts installed effect matchNames; supported numeric/vector/color parameters can be inspected and edited. Complex custom values, shape-path vertices, text animators and layer/mask-index controls are not writable through the generic numeric tools. Expressions run in AE's expression engine, not as unrestricted JSX. Syntax/runtime errors may leave an undoable partial edit. No generic `run-script` is advertised.

## Recovery and batches

Every normal tool waits for its own final response. A failure sets MCP `isError`. Errors include a code, message and conservative `mayHaveChanged` flag. An AE error after beginning a mutation can leave partial changes.

Mutations have a `beginUndoGroup`/`endUndoGroup` pair closed in `finally`. Undo provides recovery convenience, **not transactional rollback**. Use AE's Edit > Undo after inspecting the actual project. A batch has one undo group per mutation, not one atomic group for the whole sequence.

Batch arguments contain `operations: [{operation: "setLayerProperties", arguments: {...}}, ...]` and optional `stopOnError` (default true). All schemas validate before any operation executes. Runtime failure stops subsequent entries by default; false continues. Results identify success, error and skipped items by index and operation. IDs must come from prior calls; this milestone does not resolve references to newly created batch outputs. Dependent creation is best done as separate confirmed calls.

**Timeout does not mean no edit occurred.** Keep the returned `requestId`; call `get-request-result`, inspect AE, and reconcile before retrying. The server never automatically resends mutations. A durable started journal is published before execution. If AE crashes after editing but before publishing a result, the record remains `outcome_unknown`; it is never replayed. After 24-hour retention, absence of a record proves nothing.

The file protocol, fencing, limits and crash windows are documented in [docs/PROTOCOL.md](docs/PROTOCOL.md).

## Troubleshooting, updates and uninstall

- `PANEL_OFFLINE`: open the matching panel, click Start, check file permissions/directory, dismiss AE modal dialogs, and let AE finish busy work. Status requests are read-only and may be retried. Mutation timeouts require reconciliation.
- `VERSION_MISMATCH`: rebuild, reinstall, Stop and reopen the panel. Both versions must match exactly.
- `SERVER_ALREADY_RUNNING`: close the other MCP client using this directory. Running multiple Codex connections requires coordinating ownership.
- Panel waits for ownership: Stop the older panel. Ownership is never automatically stolen from a stale heartbeat because it may still be editing.
- Crashed/abandoned panel: close **all AE instances and MCP clients**, then run `npm run bridge-reset -- --confirm-ae-closed` with `AE_MCP_BRIDGE_DIR` set. The reset script verifies AE is closed and acquires the server lock. It preserves request/result/started journals. Reopen AE/panel and the MCP client afterward.
- Docked panels may remain alive when their tab is hidden; use **Stop** to disconnect explicitly. Reopening the script in the same AE engine cancels its prior scheduled task. Closing a floating palette stops it. Polling uses a single self-rescheduled task; modal dialogs may delay it. If AE cancels a task during a modal collision, Stop/Start reschedules it.

Update: Stop the panel and close its MCP client; update this checkout, `npm ci --ignore-scripts`, `npm test`, reinstall to the same destination, and reopen. Existing configuration/custom settings are preserved unless an explicit `--bridge-dir` is supplied. Reinstallation checks the panel hash. No automatic dependency installation/build hooks run.

Uninstall: Stop/close the panel, close the MCP client, run `node install-bridge.js --portable --uninstall` (or use the original `--ae-path`/`--panel-dir`), and remove only the `mcp_servers.after_effects` table and its environment table from Codex configuration. Settings and journals are preserved. Delete those manually only after reconciling uncertain requests and closing AE. Restart AE to refresh its Window menu after removing a docked panel.

## Verification

```powershell
npm test
npm audit
# With a new EMPTY disposable project and the panel open; close Codex's AE MCP first:
$env:AE_MCP_BRIDGE_DIR = 'C:\Users\YourName\.after-effects-mcp\bridge'
npm run acceptance
# Additional editing/preview fixture (creates uniquely named comps; leaves existing comps alone):
node scripts/acceptance-editing.mjs --create-disposable-comps
```

The automated real-AE script refuses a nonempty initial project. It creates a 5-second 1920×1080 composition; adds solid/text/shape; animates position/opacity; sets an expression and Fill; inspects; duplicates/deletes; runs a batch; and checks an invalid target. It saves local JSON evidence. Then visually inspect the actual timeline, keyframes, effect and composition; test Undo; Stop/reopen the panel and inspect with fresh IDs. Repeat the workflow through Codex itself. See [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md).

Build sources: `src/index.ts` and `src/bridge-client.ts` handle MCP/Node; `src/bridge/*.jsx` implement parsing, AE operations and lifecycle. `scripts/build.mjs` assembles one panel and checks ES3 syntax with Acorn. There are no separately maintained copies of operation implementations.

License: MIT, retaining upstream attribution in LICENSE.
