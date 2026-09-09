# Real AE and Codex acceptance checklist

Use an empty disposable project. Do not run against production work. The Node/MCP automated suite and the host simulator cannot validate actual AE property semantics or native File.rename. Record exact versions, IDs, request UUIDs, visual observations and failures in `local-validation/` (ignored by Git).

## Standalone MCP client

1. Close other MCP clients using the directory. Open AE 2026 with a new empty project, and run the installed portable panel. Start it.
2. Set the exact printed `AE_MCP_BRIDGE_DIR`, then `npm run acceptance`. This launches the real Node MCP through STDIO and waits for its responses. It refuses a nonempty project before its first edit. It saves every request/response to a timestamped local JSON report.
3. The script creates `MCP Acceptance` (1920×1080, 5 seconds, 30 fps), solid `Background`, text `Title`, and rectangle `Accent`. It animates text position at 0/2 seconds and opacity at 0/1 seconds, assigns a rotation expression and Fill to Accent, inspects actual values, duplicates/deletes a temporary layer, executes a two-operation batch, and checks a missing composition ID leaves `Untouched Control` empty.
4. Open `MCP Acceptance` in AE. At two seconds, confirm the text is visible, the blue line is visible, the background is dark, and the timeline has exactly three layers. Inspect Position/Opacity keys, expression and Fill in AE's own panels. JSON alone is insufficient.
5. Use a confirmed `duplicate-layer` on Accent; verify four timeline layers. In AE choose Edit > Undo MCP: duplicateLayer; verify three layers and that subsequent inspection cannot find the duplicate ID. Repeat with delete and Undo if needed. Do not assume undo rolls back arbitrary failures.
6. Stop the panel: `bridge-status` should fail or time out. Close and reopen it, Start, and verify a new panel/project session plus successful status. Inspect again; old `projectSession` must fail. Reopening while another same-engine panel exists should stop the old poller, not create duplicate execution.
7. Keep one server and start a second client: it must fail clearly. Open a second panel/AE instance only in a disposable environment: it must wait for ownership. Do not reset ownership while AE is running.
8. Inspect the bridge directory: each published request has an individual started journal and correlated response. Verify no truncated requests/results and no legacy `ae_command.json` activity. Native Windows/ExtendScript publication is established only by this live run.

## Through Codex itself

Close the standalone acceptance client. Ensure the server table in Codex uses the absolute Node/build paths and the same bridge directory. Reconnect Codex's MCP tools, then:

1. List the tools and call `bridge-status`; confirm AE 26.3 (or your exact installed version), bridge/server 2.0.0, protocol 1, and the expected directory.
2. Inspect the new disposable project. Use only returned `projectSession`, composition IDs and layer IDs.
3. Ask Codex to create a separate 5-second 1920×1080 composition with solid/text/rectangle, set position/opacity keys, an expression and Fill, then inspect. Every mutation must return its own final result.
4. Ask it to duplicate/delete a test layer, execute a batch and test an invalid composition ID. Check the actual AE state and Undo.
5. Stop/reopen the panel and ask Codex for status/inspection again. It must refresh IDs/session. If a call times out, use `get-request-result` for that UUID and inspect before retrying.

The current task's loaded tool catalog may not refresh after editing config. If `after_effects` tools are not exposed, reload the MCP connection or open a fresh task after restarting Codex. Config parsing and a standalone SDK client are not equivalent to this acceptance gate.

Codex may require approval for tools annotated destructive, including `delete-layer` and `execute-batch`. A noninteractive run with approval policy `never` can reject these before any request reaches AE. This is a client approval error, not a bridge timeout. For an explicitly authorized disposable test, Codex supports invocation-scoped `mcp_servers.after_effects.tools.<tool>.approval_mode="approve"` settings; the live validation used these only for the two approved test tools and did not change persistent approval defaults. See [official MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli). Batch entries use the exact nested key `arguments`.

## Suggested Codex working instruction

“Use the After Effects MCP only after bridge-status confirms AE is connected. Inspect the project and targets; carry forward returned projectSession and stable IDs. Wait for each final response before dependent edits. Treat error/timeout outcomes as potentially partial. Reconcile UUID results and inspect AE before any retry. Use Undo deliberately; batches do not roll back. Start all tests in a disposable project.”
