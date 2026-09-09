# Baseline audit — 2026-09-08

- Fork already existed: `TiKawamoto/after-effects-mcp`, parent `Dakkshin/after-effects-mcp`.
- Checkout, fork main and upstream HEAD: `88d5fbf08b7ae9f015ee98e5f8c4904095cf8202`. Fetched origin/upstream; created local branch `reliability/file-bridge-v1`. Remote publishing is separate from the requested local commits.
- No repository AGENTS.md found. Worktree was clean initially. Git predates `git switch`; used `git checkout -b`.
- Node 22.12.0, npm 10.9.0, Node executable `B:\Program Files\nodejs\node.exe`.
- Adobe installation directories from 2015.3 through 2026 and Beta exist, but only 2026 contained a detected `Support Files\AfterFX.exe`: file version 26.3. Older directory names do not establish working installations.
- AE was not running at baseline. AE 26.3 preferences already had `Pref_SCRIPTING_FILE_NETWORK_SECURITY = 1`; no permission change was made.
- Windows Known Folder Documents: `C:\Users\Ti\Documents`, no redirection/symlink or OneDrive environment variable detected. Roaming AE settings include a directory named OneDrive, which by itself does not establish Documents redirection. New bridge uses Local AppData explicitly.
- Original Codex config contained the node_repl MCP entry and no AE entry. Claude-style repository `.mcp.json` pointed to another user's Downloads path; it was removed. Consulted official Codex MCP docs, including command/args/env tables and tool timeout settings.

## Source findings

All nine supplied engineering concerns were substantiated by source review: singleton request/result files, early queued replies, weak freshness correlation, differing Documents resolution, eval JSON fallback, misleading read-only description, incomplete/duplicated advertised operations, unwaited/unverified elevated installer and duplicated operation implementations.

The upstream panel also used ExtendScript-incompatible `Date.toISOString` assumptions and display-name property targeting. Shape-layer implementation used property display names and could invalidate property references by adding indexed properties. The replacement uses effect/transform/shape matchNames and sets shape geometry before adding fill. Native behavior still needs live acceptance.

Open upstream PRs/issues reviewed through GitHub API (not treated as merged code or as locally verified results):

- [#33](https://github.com/Dakkshin/after-effects-mcp/pull/33): correlation/ES3 timestamps and status probe.
- [#35](https://github.com/Dakkshin/after-effects-mcp/pull/35): array-valued keyframes.
- [#38](https://github.com/Dakkshin/after-effects-mcp/pull/38): reported live AE fixes including installer completion and effect matchNames.
- [#40](https://github.com/Dakkshin/after-effects-mcp/pull/40): modal/polling collisions and path mismatch.

## Build, dependencies and actual interface

Reviewed first-party `postinstall` (build only) and `install-bridge.js` before dependency installation. Used `npm ci --ignore-scripts`, then an explicit build. Lockfile install hooks were first-party build and esbuild's native-binary installer. Windows esbuild's optional platform binary worked with scripts disabled. No blanket lifecycle scripts were enabled.

Baseline build passed. A real MCP SDK client initialized the original STDIO server and recorded 13 exposed tools in [baseline-tools.json](baseline-tools.json); no AE mutation was called. Build success was not counted as AE validation.

Baseline `npm audit` reported 9 vulnerabilities (2 low, 3 moderate, 4 high), saved in [baseline-audit.json](baseline-audit.json). Removed unused node-fetch/zod direct dependencies and copyfiles, removed automatic postinstall, updated compatible transitive versions and esbuild to patched 0.28.2. The current audit is recorded separately. This is a dependency/advisory review, not a full source audit of every third-party package.

## Scope decisions

Keep file transport; replace the unsafe shared-file protocol and overlapping implementation with one catalog, shared strict validator, ES3 parser, operation module and generated panel. Expose the coherent requested workflow with explicit project/comp/layer IDs. Remove incomplete legacy tools rather than preserve misleading claims. Initial shapes: rectangle/ellipse. Initial effect: built-in Fill. Rendering/import/preview/arbitrary JSX remain deferred.

Use a portable Run Script File palette to avoid elevation. Dockable install remains explicit and verified. Multiple servers are rejected per directory; panel ownership is persistent and never stolen on heartbeat timeout. This is intentionally conservative when recovering from a crashed AE process.
