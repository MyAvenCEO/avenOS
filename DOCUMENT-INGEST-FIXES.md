# Document ingest review: verified fixes

Revision 2 of `DOCUMENT-INGEST-REVIEW.md` was checked against fetched `origin/main`
`2809812c` in the separate worktree on branch `codex/verify-document-ingest-review`.
The original working checkout was not modified. This change addresses the surviving
correctness findings and the small supporting improvements. It does not reintroduce
findings that the review already retracted.

## Disposition, piece by piece

| Finding | Verified disposition and change |
| --- | --- |
| F-1 | The committed-step lookup was already fixed. It remains covered by replay/conformance tests. Reopening local history still reconstructs the presentation from committed steps; no new terminal cache was added. |
| F-2 | Fixed. [Desktop start/reopen](app/src/lib/artifacts/client-document-processing.ts) resolves the immutable file name and media type from the source artifact, including CSV review routing. An editable Intent title no longer changes server admission material. |
| F-3 | Fixed in both decoders. [Shared JPEG segment parsing](libs/aven-document-ingest/src/decoding.ts) skips the EXIF thumbnail and finds the main image end. The camera fixture now decodes at 3840×2160; its visual bytes end at 1,583,804, before trailing vendor data. |
| F-4 | Already fixed. The fallback input shape remains unchanged and validated. |
| F-5 | Fixed. [Hosts/router](libs/aven-document-ingest/src/execution.ts) expose startup failures even before admission or source resolution succeeds. The caller catches transport failures, and a permanent missing-processing response no longer becomes pending forever. |
| F-6 | Fixed. The client guide and actor README now describe the real server runner. System and recovery documentation describe the new lifecycle. |
| F-7 | Already fixed. Ingest tests already gate CI; the earlier bundle failure was not a current defect. |
| F-8 | Fixed with automatic page/text chunking. Inspection retains metadata, rendering is lazy and keeps useful resolution independent of length, and deterministic merges preserve disjoint financial rows. See the [implemented limits](docs/document-ingest-system.md#bounds-and-failure-controls). |
| F-9 | Fixed. Known arithmetic disagreement is inconsistent; missing operands remain unknown. Documented adjustments require review rather than being silently assumed. |
| F-10 | Fixed. Publication bodies are validated before field access, invalid Artifact JSON returns 400, store 4xx status/codes survive the facade, and fractional provider usage is carried as strings. |
| F-11 | Fixed. [Customer runners](services/actor-runner/src/sql-runner.ts) are reused; recovery runs in the background. Short claims persist running leases and release pooled connections before execution. Heartbeats, a 15-minute no-progress deadline, bounded concurrency, queued admission, pool drain and fail-closed lease recovery replace request-path execution. |
| F-12 | Fixed. Explicit retry retains durable run identity, prior failure summaries and attempt count. Repeating a retry request ID is idempotent. Ordinary reopen never implicitly retries failed execution. Monitoring failures reopen observation without restarting active work. |
| F-13 | Fixed. Unknown exploration skills fail at dispatch instead of reporting empty success. |
| F-14 | Fixed. Polling backs off from one to five seconds within the existing monitoring deadline. |
| F-15 | Fixed. Both publication adapters use shared actor attribution and determinism metadata, and store model receipts in the same `receipt.model` position. Transport adapter/version fields remain placement-specific. |
| F-16 | Fixed. JPEG parsing, image dimensions, bounds, text decoding and coordinate conversion are shared; browser/native rendering remains host-specific. |
| F-17 | Fixed. Explicit zero outstanding remains zero. Paid invoices carry an automatic-match blocker; the normalizer still rejects missing identity/currency. |
| F-18 | Fixed. Model stages use the actual `-model` procedure suffix, attempt text is consistent, finance metadata reaches the existing highlights, and current CSV/fallback page labels are recognized. Retained-stage compatibility labels remain intentional. |
| F-19 | Fixed. Only declared retryable execution errors receive bounded retries. Invalid model contracts fail their invocation immediately; successful drafts still survive publication retries. |
| F-20 | Fixed. Text regions use the PDF viewport transform. A real cropped/rotated PDF fixture verifies displayed coordinates. |
| F-21 | Fixed. [Evidence byte ranges](services/artifact-store/crates/core/src/prepare.rs) must fit the primary blob, and RFC 6901 pointers must resolve in the exact input/output payload. Invalid evidence returns 422 `INVALID_EVIDENCE`. Replay authority semantics and upload backpressure remain unchanged. |
| F-22 | Fixed. UI/native run controls are connected; cancellation propagates to execution and blocks subsequent publication. Runtime close and runner/pool shutdown drain run promises. An already committed publication is not undone. |
| F-23 | Fixed. Catalog selection refreshes after 60 seconds and supports explicit invalidation. |
| F-24 | Already fixed; no further change required. |
| F-25 | Compatibility improvement included. PDF headers in the first 1,024 bytes are recognized before text-like filename detection. This was not a specification defect. |
| F-26 | Fixed. Native errors carry status, code, message and retryability; publication retry no longer depends on English error strings. |
| F-27 | Fixed. Document actors belong only to the runtime's private bus, removing both direct chat tools and generic-send reachability. Actor method lookup uses `Object.hasOwn`. |
| F-28 | Fixed. Unexpected repository errors are logged and return a generic 503; known command conflicts retain 409. |

## Regression evidence

- Document suite: camera image decoding, actual rotated/cropped PDF, image/JSON budgets,
  pre-admission failure, cancellation during admission, invoice arithmetic, paid-item
  matching and explicit statement overflow.
- App suite: model/transport retry separation, cancellation during discovery, model
  catalog invalidation, portable fractional usage, browser JPEG and processing views.
- API suite: malformed bodies and fractional Artifact JSON fail before store access;
  store 422/429 categories survive the facade.
- PostgreSQL runner suite: two simultaneous executions leave a two-connection pool
  available for status/admission; cancellation, deadlines, explicit retry, replay of a
  retry request, expired-lease refusal, concurrent recovery and secret non-persistence.
- Rust core/native tests: evidence pointer and byte-range bounds; structured transport
  status, code, message and retryability.
- Customer movement proof: live executor drain, uncertain-execution refusal, restore,
  routing and rollback across two disposable clusters.

The historical `DOCUMENT-INGEST-VERIFICATION.md` and `review-evidence/reproduce.ts`
record the defects before this change. Those probes intentionally assert the old
behavior and are not the regression command for this worktree.

## Operating limits

The first authorized request after service restart discovers a customer's runner and
starts background recovery; there is no privileged fleet-wide customer enumerator.
Expired running work becomes `EXECUTION_UNCERTAIN` and requires reconciliation.
Execution markers are not cleared merely because a lease or deadline expired.

Cancellation prevents new publication attempts. An already submitted publication can
still commit. A native model request already in
flight can finish later; arbitrary external effects are not made transactional by an
abort signal. Each model invocation remains bounded to 128 financial rows; merged documents support
10,000 rows. Dense single-page overflow and conflicting chunk metadata require review.

## Attached review dispositions

| Finding | Disposition |
| --- | --- |
| R-1 | Fixed: busy runners cannot be evicted by idle/capacity maintenance; eviction awaits drain. Regression covers both paths. |
| R-2 | Fixed: metadata-only inspection and lazy per-page rendering preserve A4 resolution at 1190×1684 regardless of length. |
| R-3 | Fixed: native upload retry parses the structured retryable flag; native unit test covers classification. |
| R-4 | Fixed: permanent status 4xx errors stop the fallback poller; transient failures retain backoff. |
| R-5 | Fixed: invalid cancellation and closed continuations are command conflicts. |
| R-6 | Retained deliberately: secret continuations are not persisted in a queue; busy submissions return a conflict for caller resubmission. Documented in the runner README. |
| R-7 | Fixed: upload and reopen use a tested immutable request builder. Edited titles, missing MIME hints, both placements and failed metadata reads are covered. |
| R-8 | Publication-version replay costs and uncertain-execution reconciliation limits are documented. Cancellation remains a failed presentation with Retry; aborted work retains its slot until the executor settles. These conservative lifecycle/UI choices do not block chunking. |

## Validation result

Final chunking verification is recorded in `review-evidence/fixes-validation.txt`.
The historical verification document records the pre-fix reproduction only.
