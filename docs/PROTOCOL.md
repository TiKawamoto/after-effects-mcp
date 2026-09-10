# Protocol 1

An absolute local directory is selected once by installation. The panel reads adjacent `mcp-bridge.config.json`; Node uses an explicit `AE_MCP_BRIDGE_DIR`. Node resolves the real directory before acquiring its exclusive kernel lock. This milestone is one server/one active panel per directory. It does not support network or synced filesystem guarantees.

## Layout and publication

- `server.json`: server UUID, exact version/protocol and heartbeat timestamp, replaced by Node once a second.
- `panels/<panelId>.hello.json`: AE/version heartbeat. Panel replaces this through temporary-file rename, with a possible short missing-file interval.
- `owner.json`: exclusive panel selected by the sole server. Persists over server restarts. Never stolen based on time alone.
- `panels/<panelId>.released.json`: written after panel stops scheduling/executing work, or after Windows process evidence proves its AE process ended. A recovered release includes the last heartbeat and process snapshot.
- `requests/<requestId>.json`: immutable UUID envelope, published by Node after exclusive temporary creation, write, fsync, close, same-directory rename.
- `started/<requestId>.json`: immutable pre-execution journal, written/closed/renamed by AE.
- `results/<requestId>.json`: immutable final response, written/closed/renamed by AE.

ExtendScript offers no fsync. Its successful write/close/rename is not a hardware power-loss durability guarantee. Native AE 26.3 on Windows exercised this publication path in the live acceptance workflow. AE can briefly hold a heartbeat file without Windows delete sharing; Node retries the same completed temporary-file rename up to 20 times, waiting 10 ms between sharing/permission/busy failures. It never resends an AE operation. Other publication errors fail immediately. Closing the client releases its kernel lock even if the final heartbeat cannot be published. No promises of distributed exactly-once execution or transactional rollback are made.

Envelope fields: `protocolVersion`, `serverVersion`, `serverId`, `panelId`, UUID `requestId`, allowlisted `operation`, schema-validated `arguments`, numeric epoch-millisecond `createdAt`, `expiresAt`. Lifetime is at most 60 seconds. Server default timeout is 30 seconds; Codex's outer timeout should exceed that.

Response fields: `protocolVersion`, matching server/panel/request IDs and `operation`, `status` (`success`, `error`, `outcome_unknown`), `completedAt`, and `data` or structured `error`. Batch errors can include data with individual results. Errors conservatively indicate whether changes may have occurred.

## Execution and failure behavior

The sole server grants one persisted panel owner. The panel checks ownership and fresh server heartbeat before processing. It handles one request per 500 ms tick, selecting oldest creation time within the first bounded group of up to 32 pending files. AE execution is synchronous; scheduleTask does not run concurrent dispatches. Ordering among simultaneous independent callers is not a contractual FIFO; use a batch or wait for prior results for dependent work.

The panel validates filenames, strict JSON, envelope/version/session/deadline and the shared operation schema before publishing the started journal. It rechecks ownership/server identity before invoking AE. A repeated request with a final response is ignored. A started request lacking a result yields an uncertain outcome without replay. A new Node server creates a new UUID: old-session pending work fails instead of being executed. A panel restart gets a new identity/projectSession. Old heartbeat timestamps cannot grant authority to run old commands.

Only the server grants ownership. A second server fails its OS lock. A second AE panel never consumes requests while a different owner is present. On Windows the server checks abandoned ownership asynchronously, at most every 30 seconds. Recovery requires either no AE processes or a heartbeat at least ten seconds old and every surviving AfterFX.exe process starting more than two seconds after that heartbeat. It validates a fresh CIM process snapshot and rechecks the owner/heartbeat after the query before publishing a release. Missing/invalid evidence, query failure, and any possibly surviving old process preserve ownership. The current owner's heartbeat is exempt from retention pruning. `npm run bridge-recover` invokes the same verification immediately; it does not acquire or bypass the server lock, assign an owner, or delete journals. The existing server performs its normal election after observing the release. If termination cannot be proven, reset after verifying every AE process is closed. A server crash while AE is already inside an operation cannot stop that operation; the result is still correlated to the original UUID and retained for reconciliation.

Temporary files are ignored. Malformed published messages with valid filenames get structured errors. Unsupported operations are rejected. JSON uses a strict recursive-descent parser, rejects duplicate/prototype keys and nesting over 64, and never evaluates input. Schemas reject unknown fields and enforce types/bounds. No arbitrary JSX tool exists.

Limits: requests <=1 MiB; AE reads <=1 MiB and caps serialized output at 500,000 characters. At most 32 outstanding unexpired requests, 25 operations per batch, and 2,000 inspected keys per property. Node retention is 24 hours, or at most 2,048 files per category once records are older than five minutes. Newer records are retained to protect the replay window; temporary files older than five minutes are removed. At the normal half-second processing rate, the five-minute protection window is bounded. Adversarial same-user filesystem floods are out of scope. Old input expires within 60 seconds, before any journal is pruned.

## Crash matrix

| Interruption | Recovery |
| --- | --- |
| Before request rename | No published request; temporary file eventually cleaned |
| After publication, before AE starts | Pending work may expire or fail session check after restart |
| After started journal, before edit | Unknown; no replay, even if nothing was edited |
| During edit / before final response | Unknown/partial; inspect AE and consider Undo |
| After response publication / before caller reads | Retrieve the exact retained UUID result |
| Server restart | New session fences old queue; persisted results remain available |
| Panel crash | Persisted ownership blocks replacements until explicit safe reset |
| Panel close/reopen | Clean release allows a fresh panel; old projectSession must be refreshed |

Undo groups always close in `finally`. They do not roll back failed operations. Batches validate all schemas before starting; runtime errors expose individual results and may leave partial changes. Neither server nor panel automatically retries an operation after it was published.
