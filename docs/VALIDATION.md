# Validation record — 2026-09-09

## Abandoned ownership recovery — 2026-09-10

Reproduced a waiting panel with only one AfterFX.exe process running. `owner.json` still referenced the prior day's panel, whose last heartbeat preceded the current AE process's Windows creation time. The new recovery command verified that evidence, published a release record, and the existing server elected today's waiting panel. Native UI inspection confirmed **Connected**, with the current empty project unchanged. No process was terminated and no request/result/started journal was deleted or replayed.

Build, strict TypeScript, ES3 parsing and **34 tests pass**. Recovery tests cover multiple processes, stale/malformed evidence, unavailable process inspection, resumed heartbeats, changed owners, preserved journals, normal server election and retention of owner evidence. Both installed panel copies were checksum-verified. The running client was recovered with the explicit helper; automatic verification activates when that client next reloads the updated server.

## Editing and previews 2.1

Build, strict TypeScript, generated ES3 parsing and **30 automated tests pass**. New coverage includes guarded property paths, numeric bounds, keyframe preflight and easing dimensions, text/font validation, layer relationships, property browsing and bounded, correlated PNG delivery. Deferred PNG publication is tested through completion and timeout without recapture.

The live SDK-over-STDIO acceptance workflow passed on **AE 26.3x87**, server/panel **2.1.0**, protocol **1**. It exercised all 20 added tools against disposable compositions: installed font/effect discovery; text content, size, tracking and left/center/right alignment; generic shape/effect values; keyframe insertion, deletion, linear/hold/Bezier interpolation, temporal ease and expressions; timing, switches, ordering, nulls, parenting and precomposition. Missing fonts, stale property paths, missing keys, parenting cycles and external-parent precomposition failed as expected. Existing composition summaries remained unchanged.

Three native 640×360 PNGs arrived as MCP image content. Visual inspection verified the full white title and cyan accent at two times. The two-second frame before and after precomposition is byte-identical. A separate retained-result call returned the exact original image after the test client restarted, without another capture.

Native testing exposed two issues fixed before completion: AE can finish writing `saveFrameToPng` output after the JSX call returns, so Node waits for a complete PNG; text alignment required explicit native-enum assignment branches and now has a checked postcondition. The live test asserts all three alignments and interpolation modes.

Local evidence: `local-validation/editing-1788980227432/` contains calls, summary, previews and `preview-recovery.json`. New tools were verified with the real MCP SDK and native AE; the desktop's already-running MCP connection must reload to discover the 2.1 tools. Other AE versions and third-party effects have not been certified. See [EDITING.md](EDITING.md) for supported property types and limits.

The verified fixture is saved separately as `local-validation/verified-editing-and-previews.aep`. Both the portable and per-user dockable panel installations were updated with checksum verification. The docked panel was reopened in its original location on the normal bridge directory. It correctly reports a version mismatch against the desktop's still-running 2.0 server until Codex reloads; no ownership locks or session records were bypassed.

## Previous 2.0 milestone

Baseline: 88d5fbf08b7ae9f015ee98e5f8c4904095cf8202. Branch: reliability/file-bridge-v1. See [BASELINE.md](BASELINE.md) and the measured [Codex call evidence](validation-evidence.json).

## Automated checks — passed

Build, strict TypeScript and generated ECMAScript 3 parsing pass. **22 tests pass**, covering correlated concurrent requests, duplicate suppression, malformed/partial files, session/version mismatch, timeout/late-result reconciliation, restart, exclusive ownership, queue/retention limits, spaces/Unicode paths, strict JSON, targeting/dimensions/locking, duplicate indexing, partial batches and undo-group closure. Native-file regression tests cover bounded sharing-violation retries and lock release after shutdown publication failure.

MCP tests use the actual SDK over STDIO for initialization, discovery, schemas and error/final responses. Installer tests check checksums, custom paths, preserved settings and uninstall. The host simulator executes the actual parser, validator, dispatcher and panel sources.

Dependency audit after updates: **0 reported vulnerabilities** (current-audit.json). This is an advisory scan, not a full dependency source audit.

## Live AE acceptance — passed

Windows, AE **26.3x87**, Node **22.12.0**, server/bridge **2.0.0**, protocol **1**. Only disposable projects created by this task were edited.

The full SDK workflow passed in both the default directory and C:/Users/Ti/.after-effects-mcp/bridge 日本語 test. The final Unicode-path run used the current build and exact-value assertions:

- Five-second 1920×1080 composition at 30 fps, Background solid, Title text and Accent rectangle.
- Exact Position keys at 0/2 seconds and Opacity keys at 0/1 seconds; enabled rotation expression without errors; Fill color within native float tolerance.
- Duplicate/delete, resulting original index, three-layer final result and two successful batch entries.
- Invalid composition returned TARGET_NOT_FOUND; the separate control remained empty.
- Native ExtendScript write/close/rename produced correlated final responses.

AE's actual viewer at two seconds showed white text, blue accent and dark background. Its timeline showed the intended Position/Opacity key times; Effects/Properties panels showed Fill, scale105%, opacity85% and expression-driven rotation.

An additional duplicate was deleted through MCP. AE's Edit menu showed **Undo MCP: deleteLayer**. Native Undo restored the same layer ID31, confirmed by timeline and MCP inspection. Redo returned the scene to three layers.

Stop returned PANEL_OFFLINE. Close/reopen produced a new panel/session and successful status. An old-token mutation returned PROJECT_CHANGED; subsequent inspection confirmed the original scene remained intact. Repeated loading disposes the old panel. A second live client was refused with SERVER_ALREADY_RUNNING; clients were run serially.

Local evidence under local-validation/: acceptance-1788962401981.json, acceptance-1788963109971.json and live-results.ndjson. The initial failed dimensions probe is retained too.

## Through Codex itself — passed

Codex CLI exec --ephemeral discovered and called the configured after_effects STDIO tools. It created **Codex Acceptance**, animated and inspected its layers, applied an expression and Fill, verified duplicate indexing, deleted the copy, verified a batch, rejected an invalid target and inspected both controls. The final composition has exactly three layers. AE's actual viewer showed **Verified through Codex** at two seconds.

Across two invocations: 37 calls comprised 33 dispatched operations, two retained-result lookups and two initial client approval rejections. Every dispatched operation's arguments and request/server/panel/protocol identities were checked against its real request file. No SDK or direct-file substitute was used for these Codex tool calls.

The initial noninteractive approval policy rejected deletion and batch **before dispatch**. A second invocation completed those already-authorized disposable tests with documented invocation-scoped per-tool approval settings. Persistent approval defaults were preserved. See [ACCEPTANCE.md](ACCEPTANCE.md).

Local evidence: both codex-acceptance event transcripts and final reports, plus verified-native-and-codex.aep. The current desktop task's tool snapshot does not refresh mid-turn; reload its MCP connection or use a fresh task when needed. Tools were verified in Codex CLI, not inferred from configuration parsing.

After restoring the normal directory and reopening the saved project/panel, a final Codex invocation using the restored MCP configuration successfully called bridge-status and list-compositions. It returned the new session and all three expected composition IDs (32, 1, 19). Evidence: codex-final-status-events.ndjson and codex-final-status.txt.

## Native findings fixed

1. MSIX AppData virtualization made the original portable location visible to Codex but invisible to AE. Defaults now use .after-effects-mcp in the user profile.
2. ExtendScript rejected a regex accepted by Acorn ES3. Absolute-path detection now uses character checks and loads natively.
3. AE exposes three-component Position/Scale values even on these 2D layers. Inspection returns valueDimensions; edits/keyframes follow the inspected array length.
4. AE briefly holds heartbeat files without Windows delete sharing. Node retries publication of the same finished bytes for a bounded interval, never an edit.
5. Duplication shifts the original index; the response now inspects it after duplication.

## Installed state and limits

Panel: C:/Users/Ti/.after-effects-mcp/panel/mcp-bridge-auto.jsx. Normal bridge: C:/Users/Ti/.after-effects-mcp/bridge. Installation verifies SHA-256. The bridge ACL grants full control to the user, SYSTEM and Administrators; no broad write grant was observed.

Codex uses absolute Node/build paths, the explicit directory, 30-second bridge timeout, 15-second startup timeout and 45-second tool timeout. A TOML comparison against the initial backup confirmed all pre-existing settings match except the current Computer Use runtime pipe directory, which was retained. Persistent approval defaults are preserved.

The September 8 no-window launch issue was resolved by opening AE interactively. Native File > Scripts was used for testing; shell AfterFX -r did not reliably reach the visible instance in this packaged-client environment.

Other AE versions/platforms, network/cloud directories and power-loss durability are not certified. Undo is not rollback. Crashes between editing and response publication remain honestly uncertain and are never automatically replayed. Rendering, media import, previews and unrestricted JSX remain outside this milestone.
