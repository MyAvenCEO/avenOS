# Document ingest review verification

Verified on 2026-09-12 against freshly fetched `origin/main` at
`1dc2cdc05f85b368aa89cf44355e441afc8f1091`, in the separate worktree
`document-ingest-review`, branch `codex/verify-document-ingest-review`.

The supplied review identifies several real defects, but its original priority list
is no longer suitable for implementation. It describes `b4482974`, 22 commits before
this verification. The current runtime reads committed steps before invoking Actors,
uses the general observation solver, publishes a valid page fallback, reports remote
progress, permits missing invoice fields, and runs the ingest tests in CI.

The remaining priorities are reliable restart and error reporting, valid camera-image
bytes, runner availability and retry, and truthful financial amounts. This assessment
changes no product code. Its executable probes and test logs are in
[review-evidence](review-evidence/README.md).

## Work that must be addressed

| Priority | Work | Findings | Smallest useful outcome and acceptance proof |
| --- | --- | --- | --- |
| P1 | Restore remote runs using the same canonical source metadata; surface startup failures | F-2, F-5 | An upload followed by application restart reaches the existing run. A refused start or failed source fetch immediately produces an error presentation. Test the actual upload and reload request shapes, including a changed Intent title. |
| P1 | Preserve complete JPEG images in both decoders | F-3, F-16 | Parse JPEG segments correctly and share that pure parser. The camera fixture remains decodable at 3840 × 2160, and the existing trailing-data test still passes. |
| P1 | Remove recovery/execution from status-request handling and reserve database capacity for requests | F-11 | Two held executions do not delay status reads or admission. Recover accepted work independently, bound execution, expose failures, and preserve the customer migration/recovery barriers. This is substantive execution-lifecycle work, not a small local patch. |
| P1 | Provide an explicit retry attempt for failed remote work | F-12 | Retry after a transient failure executes again while reusing committed steps. Repeating an ordinary start request must retain its idempotent meaning. Do not silently turn every repeated start into a new attempt. |
| P1 before relying on open-item amounts | Preserve an explicit zero outstanding balance | F-17 | A fully paid invoice produces zero due. Define how paid items participate in historical-payment matching separately from how unpaid items are ranked. |
| P2, required for robust ingestion | Validate publication inputs and normalize receipt data | F-10, F-26, F-28 | Bad client data returns a stable 4xx code. Fractional provider metadata cannot turn a successful model call into a false store outage. Preserve meaningful downstream error codes through Tauri. |
| P2, required for larger documents | Enforce one end-to-end rendering/publication/model budget | F-8 | Downscale or deliberately select a supported lane before allocating/publishing oversized decoded images. Account for the current inspection blob limit, not just the LLM image limit. Test limits and partial outcomes; do not advertise unrestricted long-statement extraction. |

P1 denotes a user-visible correctness or availability defect; P2 denotes necessary
reliability work with a more conditional trigger. These priorities are based on code
and the bounded probes below, not measured production incident frequency.

## Highest return for modest effort

1. **F-3 plus the narrow part of F-16:** one shared JPEG parser and camera regression
   fixture fix a reproduced failure in both placements. Do not make this depend on
   consolidating the entire PDF decoder.
2. **F-2 and F-5 together:** retain canonical source metadata, attach to the durable run,
   and produce startup error presentations. This removes both the restart failure and
   the misleading waiting state. A persisted run handle is preferable to reconstructing
   immutable source metadata from an editable Intent title.
3. **F-17:** distinguish `null` outstanding from `0`. Add focused paid/unpaid tests.
4. **F-10:** validate body structure before accessing fields, and define a safe receipt
   format. Do not fix arbitrary `TypeError`s by globally classifying them as user errors;
   that would hide programming defects. Keep fractional costs as strings or a defined
   exact representation, or allowlist supported usage counters; do not blindly round.
5. **F-14:** back off status polls from 250 ms. Remote progress already exists. This
   reduces load but does not cure F-11.
6. **F-13:** reject an uninstalled application skill at admission/dispatch. Preserve
   legitimate zero-step completion for generic exploration; that behavior by itself
   is not a planner defect.
7. **F-6 and F-18:** correct two stale documents and the model-stage classifier/labels.
8. **Keep the coordinator-to-facade contract probe:** this verification drives five
   actual paths through `ArtifactFileService`, including failure fallbacks. Promote it
   into the maintained suite, extend it for CSV/confirmations and boundaries, and keep
   the existing CI ingest gate. The original request to add that gate is already done.

The larger worker/lease redesign has high impact, but should not be described as a
quick win. Decoder consolidation beyond shared pure parsing, richer invoice validation,
streaming events, and cancellation can follow the correctness fixes.

## Finding-by-finding verification

References below point to files in this verified worktree. Line numbers identify the
current revision, not the line numbers in the supplied review. “Executed” means the
specified local components ran; it does not imply a deployed end-to-end test.

### F-1 — Launch replay and model publication conflicts: principal defect fixed

`loadPersistentIntents` still starts processing for historical client-ingest sources,
and the Intent store still emits `fileSkill: null`. However,
[runtime.ts](libs/aven-document-ingest/src/runtime.ts), in `#step` at line 415,
now checks the committed publication before calling the Actor. It reconstructs the
inspection from a durable decoded-document blob and materializes committed outputs.
Both production gateways implement lookup:
[client-document-processing.ts](app/src/lib/artifacts/client-document-processing.ts)
and [server.ts:240](libs/aven-document-ingest/src/server.ts).

The app test “reloads the committed prefix after a lost acknowledgement without
repeating decoding or model calls” passes. Thus the claim that every ordinary restart
repays the model and conflicts is stale. Reconstructing historical presentations still
costs source fetches and store reads; durable terminal/run presentation storage is an
optimization worth considering, not the original emergency. The lookup guarantee is
for the same invocation identity/admission; it is not a promise that a changed skill or
model-page admission will reuse all prior work. The store's conflicting-digest rejection
is valid and should remain.

### F-2 — Restart command conflict: confirmed, executed

[ingest.svelte.ts:156](app/src/lib/artifacts/ingest.svelte.ts) still passes no media
type on reload, while upload passes the receipt media type. Reload also uses the Intent
title as the original filename. [execution.ts:84](libs/aven-document-ingest/src/execution.ts)
puts that descriptor into `parameters.source`; both runners compare it in idempotency
material. The probe used the current command constructors and `MemoryPlanRunner` and
reproduced the conflict for the same key. SQL contains the same material comparison.
Use the committed source descriptor/run handle; do not make an editable title part of
reconstructed immutable run identity.

### F-3 — JPEG EXIF truncation: confirmed, executed in both adapters

[server.ts:573](libs/aven-document-ingest/src/server.ts) and
[browser-document-decoder.ts:76](app/src/lib/artifacts/browser-document-decoder.ts)
still cut at the first `FF D9` regardless of JPEG segment boundaries.
`IM_00140.JPG` is 1,658,098 bytes; each adapter emits 4,824 bytes. The original decodes
at 3840 × 2160; the emitted bytes fail the native image decoder. The browser probe
stubs only its unused PDF worker loader. This establishes the EXIF-thumbnail failure,
not the review's broad claim about how frequently phones include thumbnails.

### F-4 — Invalid local page fallback: fixed, executed

The fallback is now in [skill.ts:309–344](libs/aven-document-ingest/src/skill.ts).
It supplies only source, page, and text inputs and `{ page }` parameters. Injecting
page-analysis failure produced ten accepted publications through the real facade
validator and a `needs_review` result. Invoice, statement/fan-out, classification
failure, and deterministic paths also passed this contract probe. No further fallback
shape change is justified by this finding.

### F-5 — Startup failures without a presentation: still valid; later failures improved

`processClientDocument` still awaits the router without a catch, and callers discard
its promise. In [execution.ts:129](libs/aven-document-ingest/src/execution.ts),
the initial remote presentation is still created only after `runner.start`. A refused
start was reproduced with `status(artifactId) === undefined`. Local source resolution
also precedes the runtime's first presentation. The fallback processing endpoint still
always returns 404, and [artifacts.rs:232](app/src-tauri/src/artifacts.rs) still turns
404 into pending.

The newer remote catch does mark an **existing** presentation failed after monitoring
errors/timeouts. Thus not every example in the review still waits indefinitely.
Keep “server execution failed” distinct from “client could not monitor it”: a monitoring
failure is not proof that the server stopped.

### F-6 — Contradictory active documentation: partly fixed

[document-ingest-system.md](docs/document-ingest-system.md) now explicitly describes
model support in both placements and the observation solver. The cited local-only
statements are gone. However,
[client-document-ingest.md:324](docs/client-document-ingest.md) still says the runner
is not used by the adapter, and
[actors/README.md:102](libs/aven-document-ingest/src/actors/README.md) still describes
server emulation and says the HTTP runner does not execute these Actors. Those two
statements should be corrected. The repair is documentation work, not an architecture
redesign.

### F-7 — Missing CI tests and bundle failures: CI claim fixed; failures not reproduced

[platform-verification.yml:165](.github/workflows/platform-verification.yml) runs
the ingest test script in the reusable verification workflow. The package suite in
this clean, locked installation passed: **89 passed, 24 skipped**. That includes
the three named production-bundle PDF cases. Their warning expectation has also been
updated since the original revision. There is no present evidence for treating the
bundle decoder as broken. A deployed runner image was not exercised here; a clean
bundle pass is narrower evidence than production-image qualification.

### F-8 — Inconsistent limits: valid, with changed failure behavior and an earlier bound

The 63-page admission, scale-2 PNG rendering, 12 MiB/page limit, 40-million-pixel
limit, all-page extraction, and 40 MiB gateway aggregate budget remain. See
[server.ts:443](libs/aven-document-ingest/src/server.ts),
[model.ts:7](libs/aven-document-ingest/src/model.ts), and
[llm-gateway.ts:8](services/aven-api/src/lib/server/llm-gateway.ts).
No particular 15–20-page threshold follows without measuring content/compression.

There is now an earlier constraint: the inspector persists the entire decoded
document, including base64 images, as a JSON blob. The facade limits inspection blobs
to 25 MiB. A synthetic decoder returning three 7 MiB images caused the **real runtime
and facade** to fail inspection publication before any model invocation. The decoded
JSON is already over 28 MiB. This is a publication-budget probe, not a real scanned-PDF
render benchmark.

The new solver can turn model invocation failures into `needs_review`, so “every limit
failure fails the whole run” is too broad. Inspection/render or publication failures
still can. The 128-transaction schema/fan-out bounds remain; however,
[statement-normalizer/index.ts:36](libs/aven-document-ingest/src/actors/statement-normalizer/index.ts)
**does** mark exactly 128 extracted rows `row-limit-reached`. What is missing is an
explicit extraction overflow/chunking policy and proof that all source rows were seen,
not an entirely unreachable marker.

### F-9 — Invoice schema and validation: two major claims fixed; arithmetic classification remains weak

The current extractor uses nullable
[invoice-candidate.v2](services/artifact-store/conformance/fixtures/protocol/bookkeeping.invoice-candidate.v2.json).
It no longer forces the listed missing identity and amount fields to non-null values.
The app's blank-supplier test passes without inventing an open item or retrying extraction.
[runtime.ts:330](libs/aven-document-ingest/src/runtime.ts) now requires consistent
validation for success; insufficient coverage becomes `needs_review`.

The arithmetic rule in
[invoice-validator/index.ts:21](libs/aven-document-ingest/src/actors/invoice-validator/index.ts)
still returns `UNKNOWN` for known unequal totals. A gross amount of 190000 against
10000 net plus 1900 tax reproduced `insufficient-coverage`, not arithmetic failure.
Improve this distinction, but account for documented adjustments before treating every
net-plus-tax mismatch as invalid. Broader line-item/tax/payment validation is additional
domain work. It is no longer justified by the original claim of silent success or a
schema that forces invention.

### F-10 — Input errors masquerading as store outages: confirmed, executed

[handler.ts:142](services/aven-api/src/artifacts/handler.ts) still casts parsed JSON;
[service.ts:1349](services/aven-api/src/lib/server/artifacts/service.ts) still
maps unexpected errors to a store-unavailable 502. Omitting `inputs` reproduced that
response. Injecting fractional `usage.cost` into a model receipt drove the real runtime
through successful model execution and then a publication failure reported as
“Artifact Store is unavailable.” Provider usage is still passed through at
[llm-gateway.ts:797](services/aven-api/src/lib/server/llm-gateway.ts).
The store's 429 and 422 responses are also still converted to 502. This deserves a
focused transport/receipt contract fix.

### F-11 — Request-path recovery and pinned connections: core finding valid; update the reasoning

[index.ts:92](services/actor-runner/src/index.ts) constructs a runner and awaits
`recoverAcceptedRuns()` before returning it for each request.
[sql-runner.ts:140](services/actor-runner/src/sql-runner.ts) selects accepted work
on the worker pool and awaits execution. `execute` holds a worker connection throughout
the executor, and [pools.ts:77](libs/aven-customer-runtime/src/pools.ts) defaults
to two connections with a five-second acquisition timeout. Two active executions
therefore leave no worker connection for request-path recovery. The handler cannot
reach even its status read, despite status using a separate API pool. This is a traced
availability defect in **Actor Runner tenant routes**, not evidence that unrelated
tenant services all fail.

Other subclaims:

- The persisted run still remains `accepted` while executing. Progress now updates
  the record/revision, but does not persist `running`. The SQL persistence test even
  asserts `accepted` during progress. Terminal application bypasses the declared
  accepted-to-planning-to-running transitions. Memory and SQL idempotency scopes still
  differ: memory includes skill, SQL uniqueness is subject plus key within the database.
- Background execution errors are still swallowed by the kick-off catch. There is
  no autonomous recovery loop, execution lease/heartbeat or overall run timeout.
- `HttpLlmGatewayClient` has no explicit request timeout, **but the facade now applies
  `AbortSignal.timeout` to provider calls**. Thus a normally functioning gateway does
  bound a hung provider. A stuck gateway/transport or an Actor that never settles is
  still unbounded at the runner.
- Cancel changes durable state without passing an abort signal to the executor.
  Progress writes can notice cancellation, but ongoing work is not immediately stopped.
- The current production runner also holds the shared customer-execution lock and
  marks `execution_unsettled` via `beginExecution`. A second/crash-recovered attempt
  encounters that marker and requires reconciliation. Therefore the old unconditional
  “lost connection causes duplicate model execution on the next poll” sequence is no
  longer established for this configuration. The barrier must survive a worker redesign;
  simply dropping the session lock while running would weaken migration safety.

The two-run production pool scenario and disconnect recovery were not executed against
PostgreSQL here. The code path is direct, but its deployed timing/behavior remains an
integration-test requirement. A missing local `initdb` prevented an isolated database
probe; existing database-dependent tests were skipped rather than reported as passes.

### F-12 — Failed remote run cannot retry: confirmed, executed

[execution.ts](libs/aven-document-ingest/src/execution.ts), in
`documentRunStartRequest`, still derives the same document idempotency key.
Both runners return the previous failed handle for matching material. An executor
that fails once was invoked exactly once across two starts; the second returned the
same failed run. The existing CSV confirmation suffix solves a different continuation
case. Introduce explicit attempt identity/retry semantics and retain committed-step
lookup. A new upload can create another source, so “permanently unprocessable” is too
absolute; the same admitted document currently lacks a retry path.

### F-13 — Unknown exploration skill succeeds empty: confirmed, executed; admission issue

[application-executor.ts:21](services/actor-runner/src/application-executor.ts)
still routes unknown skills into the empty generic host. A document command with
skill version `@2` completed with zero steps and `stoppingReason: saturated` in the
probe. The generic empty exploration result is coherent on its own; accepting a missing
application skill as implemented is the problem. Also, the document UI expects a
document presentation in the checkpoint, so an empty generic result is not evidence
that the UI displays a successfully processed document.

### F-14 — Aggressive polling: valid; missing progress claim fixed

[execution.ts:97](libs/aven-document-ingest/src/execution.ts) still uses a 250 ms
poll interval and 15-minute client deadline. The 2,400 calls in ten minutes is the
near-zero-latency upper approximation; each request duration adds to the interval.
The SSE route still emits a snapshot then closes. However, server `reportProgress`,
SQL progress persistence, and remote presentation updates now exist and their tests
pass. Add backoff first; full streaming is optional larger work.

### F-15 — Provenance naming/shape mismatch: partly valid, lower priority

[server.ts:306](libs/aven-document-ingest/src/server.ts) still uses
`actor-runner:client.*` executor IDs and an outcome-only run receipt; the client uses
the Actor ID and `receipt.model`. Model provenance is **not lost** on the server:
it remains in `parameters.modelReceipt`. Aligning these contracts would help readers
and consumers. The server now passes `declaredMediaType` during blob upload at line
279, so the claimed dropped upload media type is fixed. `client.*` procedure names
are a naming issue, not by themselves an execution or provenance-integrity defect.

### F-16 — Duplicate decoder helpers: valid

The image marker parsing, dimensions, bounds, coordinate normalization and plain-text
decoding remain duplicated between server and app. Shared PDF text extraction has
been added, so do not rely on the original approximate line count. Share pure JPEG
and bound helpers alongside F-3. Keep browser canvas/PDF loading and native canvas
loading as separate host responsibilities.

### F-17 — Open-item normalization: zero balance defect remains; missing-identity defects improved

[open-item-normalizer/index.ts:45](libs/aven-document-ingest/src/actors/open-item-normalizer/index.ts)
still substitutes gross when outstanding is zero. The probe reproduced 11900 due
for an invoice with zero outstanding and 11900 paid. This affects matching amounts.
Current code rejects absent supplier, invoice number and invalid currency, including
null; it no longer emits literal `NULL` currency. Nullable candidates also remove the
schema-forced placeholder premise. Arbitrary identical supplier/number pairs can still
share a business key, but fabricated-placeholder collisions were not demonstrated.

### F-18 — Processing-flow labels: valid, inexpensive

[processing-flow.ts:93](app/src/lib/artifacts/processing-flow.ts) still tests
`model.` while actual procedures use `client.*-model`, and line 106 still says
“Versuch.” Old stage names and unused expected metadata remain in
[processing.ts](app/src/lib/artifacts/processing.ts). Fix model-stage recognition
and the stale labels together. Verify metadata against the projected artifacts rather
than adding invented fields to satisfy the display.

### F-19 — Repeating model contract failures: valid retry behavior; savings are unmeasured

[runtime.ts](libs/aven-document-ingest/src/runtime.ts), in `#step`, retries
invocation/parse failures according to the operation's maximum attempts; model
operations still request three. [llm-gateway.ts](libs/aven-document-ingest/src/llm-gateway.ts)
sets temperature zero. A transport/contract distinction is useful, but temperature
zero does not guarantee identical output and the review measured no repeat rate.
This is a bounded efficiency improvement, not a demonstrated universal failure.

### F-20 — Rotated PDF text coordinates: valid by trace

Both `normalizedRun` implementations consume raw text transforms without composing
the rotated viewport transform; the page dimensions come from that viewport. This
can misplace evidence regions on rotated pages. Add a rotation/crop-origin coordinate
fixture when consolidating those helpers. This verification did not render and compare
a rotated-page evidence overlay, so the finding remains traced rather than executed.

### F-21 — Store evidence/replay/admission: mixed; reject replay criticism

[prepare.rs:359](services/artifact-store/crates/core/src/prepare.rs) still ignores
existing-artifact data while validating evidence. Byte ranges are checked for ordering,
not blob length; JSON pointers are checked only for an empty value or leading slash,
not target existence or full escape syntax. Stronger evidence validation is useful.
The specialized evidence error is defined without a corresponding emission path;
unknown type/core validation errors still fall through to 422 `MALFORMED_REQUEST`.

Returning a successful replay before checking new blob authorities is **intentional**:
the store first checks publisher identity and the stored intent digest. It neither
creates new artifacts nor authorizes new blob content.
[The store transaction contract](services/artifact-store/artifact-store-spec/ARTIFACT-STORE-MINIMAL-CORE.md)
explicitly returns authenticated matching replays at step 3, before fresh authorities
are resolved at step 6. Requiring fresh upload claims would damage replay after claims
expire. Do not implement that suggestion.

The default process-wide upload semaphore is still two and rejects excess admission
with 429. That is explicit backpressure, not inherently a correctness defect or proof
of tenant leakage. Preserve retryable 429 classification at the client; capacity and
fairness should be measured before raising the limit.

### F-22 — Cancellation/drain absent: valid capability gap

The Tauri runner client still throws for cancel, the local coordinator lacks a cancel
or shutdown lifecycle, and SQL cancellation does not abort execution. This is useful
future work for long runs, with the runner abort/timeout work in F-11 taking precedence.
Server document Actor instances are now disposed in a `finally` after the runtime;
that does not add desktop cancellation.

### F-23 — Cached model selection: valid, low priority

[llm-gateway.ts](libs/aven-document-ingest/src/llm-gateway.ts) caches successful
selection; rejected discovery clears the cache. The server composition constructs one
document model gateway for the process. Successful catalog changes therefore require
refresh/restart. All tenants currently use the same service-configured catalog, so
shared selection is not itself a tenant-boundary violation. Add refresh/invalidation
when hot catalog updates become a requirement.

### F-24 — Coordinator nits: mixed

The empty-string inspection input fallback is gone: [skill.ts:113](libs/aven-document-ingest/src/skill.ts)
binds the source ID directly. The old per-page assignment is also gone; page count is
now derived after solver execution. A publication failure before that point can still
omit known page count, a minor diagnostic issue. `results.ts` still casts facets/spans
without validating them. These are not urgent defects on the current trusted Actor
path; use proper boundary parsing if it becomes remote or independently extensible.

### F-25 — Input detection: compatibility opportunity, not a broad correctness finding

Both adapters still require `%PDF-` at byte zero. The installed PDF.js reader searches
for its header within a bounded initial region, so this admission gate rejects some
inputs PDF.js itself could recover. The review's stronger claim about what the PDF
specification permits was not established here. Treat leading-junk support as a reader
compatibility choice. Rejecting binary data named `.csv` as malformed is safe behavior,
not by itself a defect; CSV decoding now also rejects unsupported control characters.

### F-26 — Retry by message string: confirmed

[client-document-processing.ts:46](app/src/lib/artifacts/client-document-processing.ts)
still recognizes three exact English messages. Return structured Tauri error codes
and preserve service status/retryability. Bundle this with F-10 rather than fixing
wording independently.

### F-27 — Chat can invoke document Actors: reachability confirmed by source; impact narrower

The same Actor instances are registered on application and private runtime buses.
[chat.actor.svelte.ts:118](app/src/lib/actors/chat.actor.svelte.ts) exposes the full
`bus.toolSpecs()` list and dispatches arbitrary supplied tool payloads, including the
generic `send` path. Thus the review's conditional namespace-filter question is resolved:
there is no such filter here. `Actor.handles('toString')` was also confirmed true.
Mailbox payloads remain passed by reference.

A chat invocation can consume model resources and contend for those Actor mailboxes.
It returns Actor drafts; it does **not** automatically commit them through the
document runtime's publication boundary. No tenant bypass or automatic forged-artifact
publication was demonstrated. Decide whether these low-level methods belong in chat;
if not, registration on a separate non-executable catalog and dispatch authorization
must cover generic `send` as well as advertised tool names. `Object.hasOwn` for handler
lookup is a small independent improvement. Payload cloning needs care around large
decoded documents and is not automatically a worthwhile blanket change.

### F-28 — Raw errors reported as conflicts: confirmed by trace

[handler.ts:206](services/actor-runner/src/handler.ts) still returns unknown
`Error.message` as a 409. Known validation/admission cases have mappings, but pool and
unexpected database failures can still look like command conflicts and expose internal
diagnostics. Log details server-side, return a safe error category, and retain specific
409 behavior for actual command/idempotency conflicts. Address with F-11/F-26.

## Other sections of the supplied review

- **Method and historical test results:** these describe the old checkout. They cannot
  serve as current evidence. The independent results below supersede them for this
  revision; this verification does not claim to recreate the original author's full
  environment or live deployment.
- **System description:** placement, shared Actors and typed publication boundaries
  remain useful descriptions. The hand-ordered DAG description is stale: `runtime.ts`
  adapts `executeObservedProgram`, and `skill.ts` owns bindings and projections.
- **Fitness for purpose:** immutable artifacts and explicit publication contracts remain
  strengths. Replay is materially improved, nullable candidates no longer force absent
  values, and progress is present. Camera decoding, startup/retry, larger-input bounds,
  and request-path recovery still limit reliability. This focused audit does not certify
  every tenant/security guarantee asserted in the original broad table.
- **Test coverage:** committed-prefix/lost-ack recovery, blank supplier handling and
  remote progress now have tests. Ingest tests are now a merge-verification command.
  The newly executed coordinator/facade probe adds evidence that was missing in the
  original review. Full source-to-UI restart and SQL production-pool contention remain
  important gaps.
- **Architecture/order of work:** preserve Actor/publication separation and the current
  solver. Do not add another replay mechanism or rewrite the fixed fallback. Prioritize
  the remaining outcomes above. A worker design must integrate customer lifecycle
  fencing; not all original high findings are “small, local changes.”

## Executed validation and limits

| Check | Result |
| --- | --- |
| Ingest TypeScript check | Passed |
| Ingest package suite | 89 passed, 24 skipped; three cited PDF bundle cases passed |
| App document Actors, browser decoder and model gateway tests | 22 passed |
| Facade artifact service tests | 7 passed |
| Actor Runner suite | 27 passed, 8 skipped |
| Review probes | Startup conflict, absent startup presentation, retry lockout, unknown exploration, both JPEG decoders, arithmetic classification, zero outstanding, malformed body, fractional usage, and inspection-size boundary reproduced; five real facade contract paths passed |

The app configuration was generated before the final app/runner runs. Initial missing
generated-config and sandbox loopback failures were setup constraints; reruns after
setup passed. Dependencies were installed with the lockfile, without changing it.
Database/store/provider-dependent tests remain skipped. No deployed store, provider,
production image, Tauri UI session, full Docker journey, or two-run PostgreSQL contention
test was exercised. Raw evidence and reproduction instructions accompany this report.

Input review SHA-256:
`1eb154a78b1fa64dc68fca54166d7c223d551c302cc184f5fa56fd7bf03d1b2a`.
