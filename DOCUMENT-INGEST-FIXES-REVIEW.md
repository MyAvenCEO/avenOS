# Document ingest fixes: independent verification

Date: 2026-09-12. Target: the uncommitted working tree of
`codex/verify-document-ingest-review` on top of `origin/main` at `2809812c`
(57 modified files, 11 new files, +1515/-782). Subject: the claims in
`DOCUMENT-INGEST-FIXES.md`.

## Verdict

The fixes document is accurate. Every "Fixed" disposition I could execute behaves as
described, every "already fixed" disposition matches `origin/main`, and the four test
suites plus the PostgreSQL-backed runner suite pass here with the numbers claimed. I
found no claim that is false.

I found one regression introduced by the runner redesign that should be fixed before
merge (R-1: pool eviction aborts healthy executions and can leave runs unretryable),
one design consequence of the new image budget that the document describes as
"bounded degradation" but which in practice reduces multi-page scans to unreadable
resolution (R-2), one dead code path (R-3), and a handful of smaller points. None of
them contradicts a disposition in the fixes document; they are the cost of the chosen
designs, and R-1 is a bug.

## What I ran

| Suite | Result | Claimed |
| --- | --- | --- |
| `libs/aven-document-ingest` vitest | 101 passed, 24 skipped; tsc clean | 101 |
| `app` bun test | 182 passed | 182 |
| `services/aven-api` vitest | 38 passed | 38 |
| `services/actor-runner` vitest with a disposable PostgreSQL 16 container | 36 passed, 2 skipped | 36 |
| `services/artifact-store` cargo test | 15 passed (9 + 4 + 2), 0 failed | 15 |
| `bun run check:docs`, `git diff --check` | clean | passed |

Plus a probe script of my own that asserts the new behaviors with the real components
and a fake store transport. Its output is quoted per finding below. The container was
removed afterwards. Not exercised: the Tauri UI, a live model provider, a deployed
store, or the customer-movement proof (its driver change was read, not run).

## Finding-by-finding verification

Line numbers refer to the working tree.

| Finding | Claimed | Verified | Evidence |
| --- | --- | --- | --- |
| F-1 | Already fixed | Yes | Unchanged lookup path; the "reloads the committed prefix" app test still passes. |
| F-2 | Fixed | Yes, by reading | `client-document-processing.ts:186-198` reloads `originalName` and `declaredMediaType` from the source envelope before building the request, on both upload and reopen. No test exercises the upload/reload request shapes (see R-7). |
| F-3 | Fixed in both decoders | Yes, executed | `decoding.ts:79-101` walks segments to SOS before searching for EOI. Camera fixture: `1658098 -> 1583804 bytes, decodes 3840x2160`; the server decoder emits the same 1,583,804 bytes; trailing bytes after EOI are still removed. `app/tests/browser-jpeg.test.ts` covers the browser adapter. |
| F-4 | Already fixed | Yes, executed | Five paths through the real `ArtifactFileService.publishClientRun`: invoice 10, statement 11, page failure 10 (`needs_review`, fallback inputs `source,page,text`, parameters `{page:1}`), classification failure 6, deterministic 6 publications accepted. |
| F-5 | Fixed | Yes, executed, with a caveat | `DocumentExecutionRouter.start` emits an `active` presentation at once and resolves to a `failed` one on any rejection (`execution.ts:326-378`). Probe: `router.start resolved state=failed summary="start refused" onChange states=active,failed status()=failed`. Caveat in R-4. |
| F-6 | Fixed | Yes | Both stale statements replaced; `check:docs` clean. |
| F-7 | Already fixed | Yes | CI gate unchanged; suite green. |
| F-8 | Fixed with bounded degradation | Yes, with a design concern | `renderScale` and `boundedDocument` (`decoding.ts:19-39`), inspector applies it, statement overflow marked and forced to review (`runtime.ts:309-323`, `model.ts` prompt). Probe: two 7 MiB images are dropped while native text is kept. See R-2 for what the budget does to resolution. |
| F-9 | Fixed | Yes, executed | `mismatch: status=inconsistent arithmetic=FAIL`; `absent: status=insufficient-coverage arithmetic=UNKNOWN`. |
| F-10 | Fixed | Yes, executed | Zod schema plus canonical-JSON check before any field access (`service.ts:16-54, 1167-1171`); `missing inputs -> 400 CLIENT_RUN_INVALID`; store 4xx now passes through (`:1397`); `portableUsage({cost:0.01, prompt_tokens:12})` gives `{"cost":"0.01","prompt_tokens":12}`, applied both at the gateway and in the document adapter. |
| F-11 | Fixed | Substantially, with one regression | Runners are cached per pool (`index.ts`), recovery runs in the background on creation and every 5 s (`sql-runner.ts:72-76, 176-198`), the claim is a short `FOR UPDATE SKIP LOCKED` transaction that persists `running` with a 30 s lease and releases the connection before executing (`:320-389`), heartbeat every 5 s, 15-minute deadline, two executions per runner, expired leases become `EXECUTION_UNCERTAIN`. The new e2e test "two pending executions leave a two-connection pool available for admission, status, cancellation and retry" passes against PostgreSQL here. Regression in R-1. |
| F-12 | Fixed | Yes, executed | Memory runner probe: `after retry state=succeeded attemptCount=2 executions=2 priorFailures=1`; repeating the retry request ID is idempotent; retrying a succeeded run is refused. SQL runner covered by the e2e test above; wired through `/retry`, `actor_run_control`, `RemoteDocumentExecutionHost.retry`, and the UI button. |
| F-13 | Fixed | Yes, executed | `application-executor.ts:23-27`; unknown exploration skill throws "not installed". Note it throws synchronously; both runners wrap the call, so this is fine. |
| F-14 | Fixed | Yes | 1 s doubling to a 5 s cap (`execution.ts:97, 216-218`). |
| F-15 | Fixed | Yes | Shared `provenance.ts` drives executor ID, determinism, and `receipt.model` in both adapters; its 20 keys match the facade's 20 descriptors exactly (checked programmatically). |
| F-16 | Fixed | Yes | `decoding.ts` shared by both adapters; `plain-text-document.ts` is a re-export. |
| F-17 | Fixed | Yes, executed | `zero outstanding -> amountDueMinor 0`; `reconciliation.ts:205` adds the `invoice-already-paid` blocker; test present. |
| F-18 | Fixed | Yes | `-model` suffix, "Attempt", CSV labels, independent-page label regex, finance metadata now set by the runtime. |
| F-19 | Fixed | Yes, executed | `contract failure: attempted 1 time(s)`; `transport failure: attempted 3 time(s)`. The retryable flag is threaded from the HTTP client and the Tauri transport through `failure()` and `parseDocumentActorResult`. |
| F-20 | Fixed | Yes | `normalizedRun` composes the viewport transform (`decoding.ts:114-151`); rotated/cropped fixture tests pass. |
| F-21 | Fixed | Yes | Pointers must resolve, byte ranges must fit the primary blob, `INVALID_EVIDENCE` is emitted as 422 (`prepare.rs`, `server/src/lib.rs`); Rust tests included and passing. Replay semantics untouched, as the retraction required. |
| F-22 | Fixed | Yes | `AbortController` per local run, `abortable` helper, checks before dispatch and before publish, `close()` drains; runner cancel aborts the executor; server executor forwards the signal to the model call. See R-8 for a cosmetic point. |
| F-23 | Fixed | Yes | 60 s refresh plus `invalidate()` (`llm-gateway.ts:36-39, 98-100`). |
| F-24 | Already fixed | Yes | Unchanged. |
| F-25 | Compatibility improvement | Yes | `isPdf` scans the first 1,024 bytes and runs before text-like detection. |
| F-26 | Fixed | Mostly | Rust returns `{status, code, message, retryable}` JSON for every mapped path; `transportError()` parses it; publication retry uses the flag. One leftover in R-3. |
| F-27 | Fixed | Yes, executed | Document actors are no longer registered on the application bus; `handles('toString') = false`. The actor explorer no longer lists them, which the updated system document states. |
| F-28 | Fixed | Yes, with a caveat | Unknown errors are logged and return 503; `PlanRunConflict` keeps 409. See R-5. |

## Issues found in the change

### R-1. Tenant pool eviction aborts healthy executions, and the oldest-pool path can leave them unretryable (should fix before merge)

The runner is now owned by the tenant pool and closed when that pool is evicted
(`services/actor-runner/src/index.ts`, `evict` -> `runner.close()`), and `close()` aborts
every active execution (`sql-runner.ts:91-98`). Pools are evicted in two ways
(`libs/aven-customer-runtime/src/pools.ts`):

- Idle eviction (`:138-145`): `lastUsed` is refreshed only by `forGrant` (`:56-61`),
  and `evictIdle` runs on every `forGrant` for any tenant. A run that nobody is
  polling, which is exactly a recovery-launched run or a run whose client has gone,
  is aborted after five minutes with "Actor Runner is shutting down." and marked
  failed (retryable). Heartbeats and progress writes do not count as use.
- Oldest eviction (`:147-155`) when a provider holds more than eight pools: `onEvict`
  is not awaited before `pool.end()`. Draining then races the pool shutdown, so the
  heartbeat and the final `UPDATE ... WHERE ownerId` (`sql-runner.ts:397-403, 464-474`)
  fail on an ended pool, the row stays `running`, the lease expires, and the next
  recovery marks it `EXECUTION_UNCERTAIN` (`:184-192`), which `retry` refuses
  (`:218-219`). The unsettled marker is never cleaned, so the movement driver's drain
  loop (`movement-postgres.ts:201-212`) will refuse to move that customer until someone
  reconciles by hand.

Traced, not executed; the e2e suite does not cover eviction. Fix: count heartbeats and
progress writes as pool use, or make eviction wait for `#active` to drain before
closing, and await `onEvict` in `evictOldest`.

### R-2. The new image budget silently reduces multi-page vision quality to thumbnails

`renderScale` (`decoding.ts:19-22`) shares a 12 MiB budget across all pages as raw
four-byte pixels, so the per-page resolution falls with page count. From the probe, for
an A4 page:

| Pages | Rendered size | Effective DPI |
| --- | --- | --- |
| 1 | 1190x1684 | 144 |
| 3 | 861x1218 | 104 |
| 5 | 667x944 | 81 |
| 10 | 471x667 | 57 |
| 20 | 333x472 | 40 |
| 63 | 188x266 | 23 |

Below roughly 100 DPI the model cannot read small print, so from about five pages on
the vision lane will produce low-confidence or wrong extractions rather than degrading
to the deterministic lane. Validation catches arithmetic errors, not misread names,
dates, or IBANs. The 12 MiB figure exists because the whole decoded document, images
included, is persisted as the inspection blob under a 24 MiB cap. Options: stop
persisting images in the inspection blob (re-render on demand and keep the gateway's
40 MiB compressed budget as the only bound), or put a floor on the per-page resolution
and take the deterministic lane with a warning below it. The fixes document's "bounded
degradation" wording should say what resolution multi-page scans get.

### R-3. The upload transport retry in Tauri is now dead code

`app/src-tauri/src/artifacts.rs:655` still retries once when the error starts with
"Aven API unavailable:", but every transport failure now returns the JSON string from
`network_error()`. The single automatic upload retry no longer fires. One-line fix:
parse the JSON and check `retryable`.

### R-4. The processing-status fallback still loops, with a different message

`ingest.svelte.ts:191-215` is unchanged. For a source that was not started through the
router, the facade's permanent 404 now surfaces as an error, so the watcher shows
"Processing status unavailable, retrying" and polls with backoff instead of showing
"pending" forever. The claim "no longer becomes pending forever" is true; the loop is
not gone. Low impact, because every document the client starts now has a router
presentation and never reaches this path.

### R-5. Client-state errors on the runner are reported as 503

`handler.ts` now maps every non-`PlanRunConflict` error to `503 RUNNER_UNAVAILABLE`.
`assertPlanRunTransition` (cancel on a failed run) and `requiredContinuation`
("continuation is not open") throw plain `Error`, so a client mistake is reported as a
runner outage. Map those to 409 or 400.

### R-6. Continuation submissions are refused, not queued, when two executions are active

`sql-runner.ts:274-277` returns a conflict ("Execution is busy") for a `submit` when the
runner has two executions in flight, whereas starts and retries are queued and picked
up by recovery. Not mentioned in the fixes document; probably acceptable, but the
client has to retry.

### R-7. No test covers the F-2 request shapes

The verification asked for a test of the actual upload and reload request shapes
including a changed intent title. The fix is in `processClientDocument`, which calls
Tauri directly, and there is no such test. The behavior is clear from reading, but this
is the second time this path shipped without one.

### R-8. Smaller points

- Publication identities change with this release: `DOCUMENT_MODEL_CONTRACT_VERSION`
  is now `v6` and the skill operation IDs are `v3`, so committed-step lookup will miss
  for every existing document and each one re-executes once (including model calls)
  on its next reopen. Expected, but worth a release note.
- A locally cancelled run is presented as `failed` with "Retry processing" offered;
  there is no cancelled state in the presentation.
- When a remote start fails, the router's generic warning replaces the remote host's
  more specific `server-monitoring-failed` warning.
- `EXECUTION_UNCERTAIN` has no reconciliation path or tool; the fixes document says so.
  Until one exists, R-1's oldest-pool path is the most likely way to reach that state.
- An aborted execution keeps its capacity slot until the underlying executor settles
  (bounded by the 900 s LLM client timeout), by design.

## Recommendation

Merge after R-1 and R-3; both are small. Decide R-2 deliberately: either drop images
from the inspection blob or add a resolution floor, and say in the documentation what
multi-page scans get. R-4 to R-8 can follow.

## Appendix: probe output

```text
F-3: camera 1658098 -> visual 1583804 bytes, decodes 3840x2160; decoder emitted 1583804 bytes
F-3: trailing bytes after EOI are still removed
F-8 boundedDocument: 2 x 7 MiB images -> outcome ok, images kept: 0, text runs kept: true
F-5: router.start resolved state=failed summary="start refused" onChange states=active,failed status()=failed
F-9 mismatch: status=inconsistent arithmetic=FAIL
F-9 absent: status=insufficient-coverage arithmetic=UNKNOWN
F-27: handles('toString') = false
F-17: zero outstanding -> amountDueMinor 0
F-12: after retry state=succeeded attemptCount=2 executions=2 priorFailures=1
F-12: repeated retry id is idempotent; retry of a succeeded run is refused
F-13: unknown exploration skill rejected
F-10: missing inputs -> 400 CLIENT_RUN_INVALID
F-10: portableUsage({cost:0.01, prompt_tokens: 12}) = {"cost":"0.01","prompt_tokens":12}
F-4 contract invoice: succeeded; 10 publications accepted by the facade
F-4 contract bank-statement: succeeded; 11 publications accepted by the facade
F-4 contract page-failure: needs_review; 10 publications accepted by the facade
F-4 contract classification-failure: needs_review; 6 publications accepted by the facade
F-4 contract deterministic: succeeded; 6 publications accepted by the facade
F-19 contract failure: classify-document attempted 1 time(s)
F-19 transport failure: classify-document attempted 3 time(s)
ALL PROBES PASSED
```

Runner suite command used:

```bash
TEST_ACTOR_RUNNER_DATABASE_URL=postgres://postgres:review@localhost:15432/postgres bun x vitest run
```
