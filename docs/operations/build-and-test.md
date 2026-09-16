# Build and test

Status: authoritative

Use the smallest test level that can disprove the change while iterating. Before a
deployment or merge to a release branch, use the complete gate. A collection of unit
tests is not a substitute for the full-stack proof.

## Fast development checks

From the repository root:

```sh
bun run check
bun run check:identity
bun run check:api
bun run check:checkout
bun run check:customer-platform

bun run test:identity
bun run test:api
bun run test:checkout
bun run test:customer-platform
```

The customer-platform checks include the portable Actor runtime and HTTP-resource
contracts. The HTTP-resource suite starts a loopback origin and proves authenticated
redirect handling, exact response bytes, and ETag revalidation; it does not replace
the full-stack customer-database isolation proof.

The native credential regression suite verifies one refresh for 80 concurrent callers,
session separation, expiry, invalid responses and failed-refresh behavior:

```sh
cargo test --locked --release --manifest-path app/src-tauri/Cargo.toml --lib service_token::tests
```

Run the application unit tests separately:

```sh
(cd app && bun test)
```

Agent context now presents the on-screen Intent plus seven recently used Intents,
up to 24 recent completed chat messages (kept in valid turn groups) plus the
active tool round, and the latest 20
attachments in the on-screen Intent. Full histories remain stored. The agent can
use `workspace_search` with kind `intent`, `message`, or `document` to find older records,
and `workspace_read` with the returned kind and ID to read them. These are the only
lookup tools exposed to the model; the previous overlapping list, search, and detail
names are private storage adapters. The model also no longer receives a generic
`send` wrapper over the same registered methods; named tools retain their argument
schemas. Internal actor envelopes still use the normal message bus. Lookup tools
return bounded pages so searching a crowded workspace does not recreate the
large default prompt. Selecting recent messages reads only the bounded tail; a warm
Intent selection uses the reactive ID index instead of rebuilding it every round.

Document research uses a per-turn evidence checklist with source-validated quotes,
one `calculate` tool for signed currency sums or evidence-backed ledger reconciliation,
`check_coverage` for gaps between required and confirmed time intervals, and a separate per-checklist-item model review before
speaking or saving the final answer. The reviewer receives source text and requirements
without the writer's checklist conclusions, preserves source timestamps, and records its reasoning for each item. The review has a 2,048-token JSON budget with reasoning disabled.
There are 32 tool rounds, followed by at most four rounds restricted to the checklist,
calculator, and final answer. An incomplete completion gets one retry; a rejected
answer gets at most two repairs. Rejection clears the earlier checklist conclusions
while retaining requirements and quoted evidence. Search completeness is tracked per
query and scope, so exhausting a page chain clears its incomplete status. Exhaustion, invalid review output, and truncation
are failures, not accepted partial answers. Ordinary conversation still streams
without the document review.

Source search uses a rebuildable IndexedDB token index, including document body
text and an Intent-scoped token index. Each page examines at most 200 metadata rows
and returns at most 20 passages of 650 characters. Keyset cursors avoid offset scans;
a changed index requires restarting pagination. Source bodies are stored separately
and loaded only for returned candidates. Full reads return 12,000-character pages;
the native reader limits search documents to 1 MiB. Larger, unavailable, and partly
extracted sources remain an explicit coverage gap. Unknown source dates remain
candidates and require checking the dates within the document.

The local cache is partitioned by authenticated user and customer environment.
The native host checks current access before exposing search results. Background
indexing waits for processing to finish, has two readers, reuses unchanged cached text across restarts and sign-ins for the same
user and environment, and updates changed projections. Removing an Intent removes its indexed
sources. HTTP rate limiting pauses the background queue for one minute before retrying; it is not recorded as a missing source. The cache is disposable local data, not an authoritative store or backup.
Caches for other users or environments remain inaccessible through the application
and consume browser storage until that site data is cleared. Startup hydrates one
page of 20 recent Intents, each with at most 40 recent contributions. The sidebar
can load another page. Historical intent and message searches query the customer
database directly, without loading every conversation into the app. Source discovery
runs separately through 50-publication cursor pages at `/artifacts/inventory`, without
the legacy debug browser's 10,000-publication/2,000-artifact cap or lineage fan-out.
A source inventory cursor is bound to the database, environment, routing generation
and Artifact Store epoch. Metadata discovery currently replays the publication feed
on restart; the cold source-index build remains proportional to the corpus size.
This does not establish constant-time discovery or bounded metadata memory for an
arbitrarily large document archive.
Incomplete discovery is reported as partial search coverage. Native identity-token exchanges are single-flight and cached in memory for at most sixty seconds per session, shortened to expire at least fifteen seconds before JWT expiry and cleared on logout. Every product request still undergoes identity and customer authorization at the facade.

The initial Intent schema includes normalized full-text projections and indexes for
owner-scoped searches and keyset pagination. Provisioning installs this schema
directly; there is no older-schema upgrade or backfill path. The browser index also
starts at schema 1 without importing or upgrading earlier development caches. Searches
use all query terms, fold accents and German ß, preserve original source text, and
return at most 20 message excerpts or 50 Intent summaries. No total-count scan is
required. A bounded unordered candidate probe prevents PostgreSQL from scanning
an entire ordered history when a rare or absent search term is combined with LIMIT.
Archived records remain searchable; merged/deleted Intents are excluded from search.
Full message reads are authorized independently and return 12,000-character pages.

Run the optional real-PostgreSQL proof against a disposable server. The runner creates
and removes its own fresh database; it does not clear an existing customer's schemas:

```sh
INTENT_RETRIEVAL_TEST_DATABASE_URL='postgresql://test-user:test-password@127.0.0.1:5432/postgres' \
bun run --cwd services/intent-service test
INTENT_RETRIEVAL_TEST_DATABASE_URL='postgresql://test-user:test-password@127.0.0.1:5432/postgres' \
bun services/intent-service/bench/retrieval.ts
```

The integration proof installs the initial schema and checks ownership, search, and
full-message paging. The benchmark exercises recent, common, rare, absent, and scoped searches at 10,000,
100,000 and 1,000,000 synthetic messages. It checks result bounds and fails if a query
class exceeds a 250 ms p95. This is database query latency, not end-to-end model latency.
The default evidence path is `/tmp/intent-retrieval-scale.json`; override it with
`INTENT_RETRIEVAL_EVIDENCE_PATH`.

Measure actual browser index performance separately from model latency and server
startup. This benchmark uses real Chromium and IndexedDB with 1,000, 10,000 and
100,000 synthetic documents, exact-reference queries, common terms and scoped queries:

```sh
SOURCE_INDEX_EVIDENCE_PATH='/tmp/source-index-scale.json' \
bun app/e2e/source-index-scale.ts
```

It records build time, query median and 95th percentile, checks returned targets and
fixed page bounds, and fails above a 250 ms query p95. It does not benchmark network
access, initial server inventory loading, or production document-size distributions.

For a live model check of Intent and message retrieval, run the optional synthetic
probe against a trusted OpenAI-compatible endpoint. Use the exact model ID returned
by that endpoint's `/v1/models` response:

```sh
LIVE_LLM_BASE_URL='http://model-host:8000' \
LIVE_LLM_MODEL='exact-model-id' \
LIVE_LLM_EVIDENCE_PATH='app/e2e/live-context-retrieval-results.json' \
bun app/e2e/live-context-retrieval.ts
```

The probe creates 260 synthetic Intents and more than 10,000 synthetic conversation
messages, then asks English, German, and Spanish questions that require older
history. It uses the application's chat turn loop and stream parser, but sends
requests directly to the configured model endpoint with synthetic lookup tools.
It does not exercise customer authentication, databases, or the deployed facade.
It exits nonzero if the model does not use retrieval when needed or gives an
incorrect answer under its rubric. The evidence file records questions, answers,
successful distinct source reads, tool arguments/results, completion reasons, usage,
review decisions, routing, and timing. The probe shares the production index, source
resolver, pagination and chat loop; its data provider remains synthetic. Regex checks
are regression signals, not a complete semantic accuracy proof: inspect contradictory
claims in the saved answers and source evidence before reporting correctness.

For long-horizon tests, regenerate the fictional three-person, 180-day corpus.
Its deterministic scaffold has crowded chat and Intent histories; a live Qwen
generation adds 180 connected episodes with people, emails, documents, tickets,
bookings, orders, returns, support threads, legal drafts, and financial records:

```sh
LIVE_LLM_BASE_URL='http://model-host:8000' \
LIVE_LLM_MODEL='exact-model-id' \
bun app/e2e/corpus/enrich-with-qwen.ts
LIVE_LLM_BASE_URL='http://model-host:8000' \
LIVE_LLM_MODEL='exact-model-id' \
bun app/e2e/corpus/revise-with-qwen.ts
bun app/e2e/corpus/materialize-assets.ts
bun app/e2e/corpus/build.ts
bun test app/tests/persona-corpus.test.ts app/tests/enriched-persona-corpus.test.ts
```

The connected Qwen revision pass repairs selected contradictions and recycled
records against a dated story canon; the builders overlay accepted revisions.
The corpus format and scenarios are described in `app/e2e/corpus/README.md`. To
run its six English, German, and Spanish source-retrieval cases against a live
model, set `LIVE_LLM_CORPUS=personas` along with the live-model variables above.
Set `LIVE_LLM_CORPUS=persona-temporal` for nine natural follow-up questions
asked at their simulated dates; later records are withheld in that mode.
Use a separate `LIVE_LLM_EVIDENCE_PATH` for this run so earlier probe evidence is
preserved. This live mode checks that the model opens the requested email or
document through `workspace_read` with kind `document` before answering. Generated financial and
legal sources are fictional fixtures, and the live checks do not exercise
customer databases or production ingestion.

Run the twelve multi-document breaking-point cases (English, German and Spanish)
with `LIVE_LLM_CORPUS=persona-breaking`. Set `LIVE_LLM_CASE_FILTER` to a regular
expression to run a named subset. `LIVE_LLM_MAX_TOKENS` defaults to 8,192 for answer
rounds; the separate review keeps its own smaller budget. `LIVE_LLM_REPLAY_PATH`
regrades an existing evidence file and marks the output as a regrade, not a new live
run. Missing cases are errors, and old traces without successful-source identities
cannot pass the updated evidence checks. All twelve breaking-point cases use an
independent factual rubric withheld from the answering agent. Each criterion cites a numbered passage of the answer; the evaluator resolves that
reference to the original text so quotation-formatting mistakes do not affect the score.
Every criterion must pass. This model judge can itself make mistakes; inspect its
reasoning and the saved sources. Answer latency and grading latency are separate.
Replay reuses only judgments bound to the exact question, answer, rubric, evaluator model and evaluator
version. Set `LIVE_LLM_REGRADE_MODEL=true` to call the model again for fresh grading;
this does not rerun the answering agent.

Set `LIVE_LLM_CORPUS=persona-heldout` for three frozen counterfactual cases in the same
crowded corpus: English timezone-aware care handoffs, German split-tender returns,
and a Spanish executed date amendment with a separate pending capacity permit.
Their outcomes deliberately differ from the original failing cases. They add 27
hand-authored source records; they are not another Qwen-generated life history.

Independent evaluation is optional and sends only the synthetic question, answer,
and rubric to OpenAI. A fixture audit sends the synthetic persona's source corpus
as well. Set `OPENAI_API_KEY_FILE` to a protected local key file (or use
`OPENAI_API_KEY`); never put the credential in tracked files or evidence. Set
`OPENAI_EVALUATION_MODEL=gpt-5.6-terra` to grade Qwen with that independent model.
Set `LIVE_LLM_INDEPENDENT_REVIEW=true` as well to use it for the application loop's
review, which includes the retrieved synthetic source text; Qwen remains the answering model. These opt-in evaluation credentials do
not configure or ship in the production app. The evaluator uses the Responses API
with storage disabled and retains encrypted reasoning only for calls still in the
current conversation. It preserves tool call IDs and respects compacted checklists. `OPENAI_EVALUATION_BUDGET_USD` defaults
to 3 per stream instance; requests reserve a conservative cost bound before sending,
record actual token usage and estimated cost, and stop if the bound would be exceeded.
The cost log defaults to `/tmp/aven-evaluation-cost.jsonl` and contains no credentials.

Audit question validity independently of the answering model's draft:

```sh
AUDIT_INPUT='/tmp/live-results.json' \
OPENAI_API_KEY_FILE='/path/to/protected-key-file' \
bun app/e2e/audit-retrieval-cases.ts
```

The audit receives all sources for the persona and checks whether the question and
rubric are answerable. Every returned source quotation is checked against the actual
body before the result is accepted. It checkpoints after each case. `AUDIT_CASE_FILTER`
selects names; `OPENAI_AUDIT_MODEL` defaults to `gpt-5.6-terra`; `OPENAI_AUDIT_OUTPUT`
defaults to `/tmp/aven-case-audit-verified.json`. Models without explicitly recorded
pricing are rejected. Neither a model's self-review nor an independent model judge
is sufficient proof by itself: inspect the saved sources and contradictions.

The artifact library's scoped SQL projection has a disposable PostgreSQL 18
regression. It checks tenant isolation, validated revision selection, source-backed
financial rows, paging, and a synthetic first page beyond the former browser tail:

```sh
python3 services/artifact-store/tests/library-query.py
```

The script starts and removes a checksum-pinned `postgres:18-alpine` Docker container. Its synthetic
documents contain no customer files. The timing it prints describes that fixture,
not production-scale search latency.

Skill Studio's compiler and service tests run in the customer-platform suite.
Its `studio.persistence.e2e.test.ts` is included in the Actor Runner persistence
stage of the full-stack gate and requires both its disposable PostgreSQL database
and production Artifact Store. The v2 journey proves a synthetic email → exact
nested Skill → committed brief path, output-to-activation-to-Skill provenance,
duplicate-delivery replay, connection catch-up after Runner restart, and draft
conflicts. It does not contact a mailbox or call a model.

Persistence test files run sequentially because they share one Artifact Store
with its production two-upload admission limit. Tests still exercise concurrent
claims, dispatch, and execution within each file; fixture setup from unrelated
files must not compete for those same slots.

For the Studio browser interaction check, start an isolated worktree preview and
run the test in a second terminal:

```sh
(cd app && bunx vite --host 127.0.0.1 --port 1449 --strictPort)
bun app/tests/studio-ui.mjs
```

`AVEN_STUDIO_UI_URL` overrides the preview origin. If the workstation has exhausted
its file-watch limit, prefix the preview command with `CHOKIDAR_USEPOLLING=true`.
The browser test uses the real component and compiler, simulates only native IPC,
and writes desktop/mobile screenshots under `/tmp/aven-studio-*.png`; it is not a
replacement for the database-backed proof.

The artifact library browser check exercises its category filter, financial table,
on-demand source preview, and exact-ID handoff to Studio. Start an isolated app
preview, then run the test in a second terminal:

```sh
(cd app && bunx vite build && bunx vite preview --host 127.0.0.1 --port 1463 --strictPort)
bun app/tests/artifact-library-ui.mjs
```

`AVEN_LIBRARY_UI_URL` overrides its default preview origin. The test simulates the
native IPC boundary and writes `/tmp/aven-artifact-library-invoice.png`; the scoped
PostgreSQL regression above verifies the server projection separately.

Format and lint changed files before committing:

```sh
bun run check:docs
bun run check:secrets
bun audit
cargo install cargo-audit --version 0.22.2 --locked
bun run check:rust-advisories
bun run lint
```

Use `bun run lint:fix` only when you intend to accept its edits.

CI validates commit messages on pull requests and pushes to `main`. Before a squash
merge, also pipe the planned merge message into `bunx commitlint`; GitHub's final
merge message can differ from the individual commits checked on the pull request.

## Build production artifacts

Build the web services:

```sh
bun run build:identity
bun run build:api
bun run build:checkout
```

Build the platform-neutral frontend and check the native Rust shell:

```sh
bun run --cwd app build
cargo check --locked --manifest-path app/src-tauri/Cargo.toml
```

The [client download workflow](client-releases.md) builds and verifies Linux,
macOS, and Android test installers and attaches them to a complete GitHub prerelease.
Signed App Store, Android, and distribution-specific application builds have separate
credentials and guides under `docs/deploy/`; they are not part of the server-platform
deployment.

`platform-release`, running from `main`, publishes immutable GHCR digests only
after verification passes. Secret-bearing deployment jobs consume its verified manifest;
they do not rebuild candidate application code. `Platform release gate` is the stable
required promotion check emitted by `platform-ci`, including documentation-only changes.

The gate also builds Linux DEB/AppImage packages and runs the same packaged-app
verification used by the download publisher. This runs alongside the other checks
and catches packaging failures before promotion. See the
[client download checks](client-releases.md#retry-and-verification) for its isolated
desktop session and diagnostic artifacts.

The Linux full-stack E2E and release publisher also run `bash scripts/scan-container-os.sh`
against their exact built image references. This requires Docker, curl, jq and network
access to the pinned scanner release and its advisory database. To scan an existing
local image directly, pass its name or digest as the final argument. Fixed high/critical
OS findings fail the gate; unresolved upstream findings are reported separately. This
gate does not audit Go libraries embedded in the upstream Caddy binary. Updating the
Alpine packages cannot patch those libraries; they require an updated binary.

`check:secrets` scans working files and reachable Git history with fully redacted output.
Its checksum-pinned scanner first proves that a synthetic registry credential is detected.
The historical baseline contains exact reviewed commit/file/rule fingerprints, not broad
path exclusions. New occurrences still fail. Never add an active credential to the baseline.
Public synthetic fixtures have exact-value exceptions restricted to their fixture files;
these do not exempt other values in those files.

CI dependency installation temporarily authenticates through an owner-only project
`.npmrc`, then restores its exact prior contents and permissions in the same step.
The action restores it on success, failure and handled cancellation; it does not leave
a token hidden behind Git's skip-worktree flag. A local action regression runs in both
platform CI and release verification before scanning. An abruptly killed disposable
runner cannot execute its cleanup trap, so no workspace or registry configuration is
exported as a cache or artifact.

The Rust audit checks every supported application, library and service lockfile, excluding
archived code. Artifact Store's locked but unused SQLx MySQL/RSA dependency is exempt only
when Cargo proves it absent from every enabled target/feature graph on that run. Other
vulnerabilities fail. RustSec informational/unmaintained warnings remain visible: Tauri's
Linux GTK3 stack still requires old bindings, including the `glib::VariantStrIter`
unsoundness warning. No local fork or unsupported GTK ABI upgrade conceals that upstream
constraint. CI installs the official pinned auditor release only after checking its
recorded SHA-256; it does not share an executable scanner cache between development
and release branches. The manual `cargo install` command above builds the same version
from crates.io when a supported prebuilt CI binary is not applicable.

## Infrastructure and recovery checks

These tests do not contact Hetzner:

```sh
bun run test:deploy
bun run test:proxy-boundary
bun run test:recovery
bun run test:customer-movement
bun run test:customer-runtime
bun run test:release-archive
```

- `test:deploy` validates shell scripts, production Compose files, Caddy
  configuration, dependency order, non-root images, secret-safe build contexts, and
  immutable runtime preparation with separate credentials, storage and routes, host
  control/runtime separation, and interrupted cohort retry behavior.
- `test:proxy-boundary` runs the production checkout Caddy block against a loopback
  fixture on Linux, proves distinct transport clients survive forwarding, rejects
  caller-selected forwarding identity, and checks the production Svelte one-hop settings.
  It does not simulate separate users behind the same NAT or a future CDN.
- `test:customer-movement` uses two disposable PostgreSQL clusters to prove customer
  routing and holds, executor drain, uncertain-attempt refusal, source fencing, exact
  database restore, failed readiness and resume, controller contention, and retained
  rollback after new writes while another customer keeps its data. Its fixture adapter
  does not prove provider provisioning or a complete native journey through migration.
- `test:release-archive` requires Python 3 and Docker Compose. It restores pinned images
  and private configuration without registry access, starts the retained image, and
  refuses another target, inconsistent release identity, damaged configuration, or an
  existing recovery destination.
- `test:recovery` creates source databases, takes encrypted backups including a retained
  release, removes the original release files, restores fresh targets, compares exact
  data and access control lists, starts the retained image, and proves bounded provider
  failure, wrong-key, and populated-target rejection.

`test:runtime-install` exercises the generation startup tool using the service images
built by the full-stack harness. That harness invokes it after customer journeys, with
package credentials already removed. An isolated loopback registry provides immutable
image references; an internal control network and disposable database replace hosted
infrastructure. The test uses a Docker tools container with the local engine socket to
run the host-administrator operation. It never receives provider or deployment secrets.
Run it separately only after building those images at the current checkout:

```sh
bun run test:runtime-install
```

## Full-stack E2E release gate

On a prepared Linux workstation:

```sh
bun run test:e2e:platform
```

The harness builds an optimized Rust/Tauri application and every service image, starts
fresh databases on dynamic loopback ports, and proves the public journey:
When `CARGO_TARGET_DIR` is set for an isolated worktree, the harness uses that
directory for both the native build and its application executable.
The raw test binary loads the fetched ONNX Runtime from this worktree; installed
application packages use their bundled resource path.

- checkout, email, fake payment, signup, and raw Polar webhook retention;
- first and second passkey enrollment and login;
- native Tauri device authorization and short-lived service-token exchange;
- native workspace message search/read, exact evidence quotes, and absence of removed lookup aliases;
- customer database provisioning and per-schema isolation;
- two unique name purchases by one identity subject, native environment selection
  and same-session switching, with reads isolated to each customer database;
- live membership downgrade/removal with an unchanged identity token, while another
  environment remains independently accessible;
- artifact upload and exact readback;
- native document import on both Device and Server placement, exact source and
  extracted bytes, and canonical stored-graph equivalence for the text note
  fixture;
- synthetic invoice and statement PDF imports in opposite orders on Device and Server,
  automatic match proposals, and a physical confirmation through the existing native
  comparison control, with the accepted decision and its three evidence inputs read
  back from the customer database;
- authenticated LLM chat with durable Intent history, including session-local
  anonymous speaker attribution and a duplex interruption followed by another
  speaker;
- focused Actor runtime conformance against fresh PostgreSQL and the production Rust
  Artifact Store image, including authenticated admission, durable checkpoints,
  a single database-backed executor claim under concurrent recovery, lineage,
  idempotent publication replay, local/server outcome equivalence, and a secret
  continuation that never persists the submitted secret;
- persistent Actor admission through the facade in the native user journey;
- resistance to forged identity, routing, and tenant-grant headers; and
- managed static hosting with verified Git revisions.

The test uses disposable volumes and always tears down the `hosting` profile. Setting
`E2E_SKIP_IMAGE_BUILD=true` is useful while iterating but is not release proof.
The harness overlays production container limits, capability removal, read-only roots,
temporary filesystems, and child-process reaping. Recovery uses a separate drill; the
local payment, inbox and LLM fixtures do not prove availability of external providers.
The voice path uses deterministic silent fixtures through the production semantic
state machine. It proves ordering, interruption, attribution transport, and Intent
persistence without microphone hardware; physical acoustic qualification remains the
separate procedure in
[Voice dependency qualification](../voice-dependency-qualification.md).
The [Actor runtime proof strategy](../actor-runtime-proof-strategy.md) states the exact
claims this rail establishes. The focused document conformance suite additionally
compares browser and headless-runner results for deterministic text, CSV, native-text
PDF and model-backed image goldens. The real-store reconciliation suite also proves
restart without repeated model calls, identical local/remote financial payloads,
candidate lineage, decision replay and scope denial. The native journey has a
180-second budget. Financial document waits fail immediately on terminal failure or
unexpected review-required processing; otherwise they allow 20 seconds per document
and 10 seconds for saving a decision. Failed decodes retain diagnostic context.
Text-document graph waits are bounded to 20 seconds. Financial waits print stage
transitions and retry errors; remote progress comes from the runner's shared status
protocol. There is no longer a per-test override extending the journey to five minutes.

CSV intake has a separate native checkpoint: the test imports a recognized synthetic
CSV on Device and Server, verifies that no transactions or matching candidates exist
from it before a physical click, exercises rejection and acceptance, then verifies the
accepted transaction amounts and dates without accepting any invoice relationship.
These expected document-type review states use their own 10-second bounded waits.
The native test then imports a matching synthetic invoice on each placement and
requires a second physical decision before accepting the exact invoice/booking
relationship. It checks the original CSV row and all three decision evidence inputs.
The same two-gate composition also has a fast in-memory integration test.
Restart tests replay accepted and rejected document decisions without
presenting another gate or treating restoration as a new human click.
The shared detector/runtime tests run with `bun run --cwd libs/aven-document-ingest test`;
the physical-gate unit tests run with `bun test app/tests/csv-document-review.test.ts`.
The [CSV corpus](../../fixtures/golden/bank-csv/README.md) records supported and blocked
formats, source provenance and the distinction between decoding and financial import.

### Use a real document model in the local proof

The document provider is opt-in. Set both `TEST_DOCUMENT_PROVIDER_BASE_URL` (the
OpenAI-compatible `/v1` base, not `/models`) and `TEST_DOCUMENT_PROVIDER_MODEL` to the
exact installed model. `TEST_DOCUMENT_PROVIDER_PROFILE=qwen-tools` selects the
production Qwen tool-call adapter and disables thinking; the default is
`openai-json-schema`. Do not select a profile merely to hide invalid provider output.

With these variables set, `bun deploy/e2e/document-provider.ts` runs the two reviewed
OCR goldens through the production facade translation. It accepts an optional
`TEST_DOCUMENT_PROVIDER_TOKEN`, binds its temporary gateway to loopback with a random
token, limits each provider request to 45 seconds and each test to 120 seconds, stops
at the first failed test, and kills the child process group if the suite exceeds
270 seconds. No external endpoint
is contacted by this test unless configured explicitly.

Two expanded corpora use the same wrapper and provider variables:

```bash
TEST_DOCUMENT_CORPUS=market bun deploy/e2e/document-provider.ts
TEST_DOCUMENT_CORPUS=market TEST_DOCUMENT_CASE=cn-private-receipt bun deploy/e2e/document-provider.ts
bun fixtures/golden/public-documents/fetch.ts
AVEN_PUBLIC_DOCUMENT_DIR="$PWD/fixtures/golden/public-documents/files" TEST_DOCUMENT_CORPUS=public bun deploy/e2e/document-provider.ts
```

The [market corpus](../../fixtures/golden/reconciliation-market/README.md) has 13
single-document tests; its full-suite watchdog is 1,590 seconds (13 bounded tests
plus teardown), not a longer per-document wait. A selected case retains the
270-second suite watchdog. The [public corpus](../../fixtures/golden/public-documents/README.md)
has seven checksum/page-count checks and two live blank-form safety checks. Its
download step contacts only the listed issuer URLs, refuses changed hashes, and
does not submit files to a model. The subsequent opt-in provider command does.
For public decoding without any model calls, set only `AVEN_PUBLIC_DOCUMENT_DIR`
when running the document-ingest suite.

To regenerate the synthetic PDFs, use Python with ReportLab plus installed
DejaVuSans, DejaVuSans-Bold and DroidSansFallbackFull fonts at the paths in the
generator, then run `python3 fixtures/golden/reconciliation-market/build.py`.
Render and inspect every page after regeneration and rerun the decoder tests;
font substitutions can lose Chinese or Latin glyphs without failing PDF generation.

The same base/model/profile variables also make `bun run test:e2e:platform` use that
provider for native PDF invoice/statement processing on both Device and Server.
Chat remains the deterministic fixture provider. This full-stack override currently
uses an unauthenticated endpoint reachable from its containers; the focused wrapper's
token option does not configure native-stack credentials. Live document waits allow
60 seconds, within the native journey's 180-second total budget. CSV detection is
deterministic and never calls the LLM, even in this mode.

The long-document provider proof uses the authenticated facade, production gateway and decoder with an
in-memory publication store. It verifies a 160-row statement, replay in a fresh runtime,
a two-page invoice, and a 70-page PDF larger than 25 MiB with scanned pages beyond
page 63. It also sends a detailed PNG larger than 2 MiB through the facade body
reader to the real model. Run it explicitly:

```sh
TEST_CHUNK_LLM_URL="$TEST_DOCUMENT_PROVIDER_BASE_URL" TEST_CHUNK_MODEL_ID="$TEST_DOCUMENT_PROVIDER_MODEL" bun run --cwd libs/aven-document-ingest test tests/chunking-provider.e2e.test.ts
```

This proof currently uses the `qwen-tools` profile. JSON results and model receipts go
to `TEST_CHUNK_EVIDENCE_DIR` (default `/tmp/aven-chunk-real`). The statement has a
20-minute budget, the invoice 10 minutes, the manual 30 minutes and the PNG 5 minutes; requests remain bounded by the
900-second provider timeout. The separate full-stack gate proves real-store contracts
and customer isolation; the in-memory provider proof does not replace it.

The facade has a separate memory-admission proof. After dependencies and the local
`aven-e2e-api:local` image have been built by the platform gate, run:

```sh
python3 deploy/e2e/facade-memory.py --output /tmp/facade-memory.json
```

It starts and removes its own disposable container at the production 768 MiB limit,
mounts source/dependencies read-only, binds a random loopback port and sends eight
concurrent image-sized JSON envelopes. A stalled model transport holds admitted
requests; no real LLM or customer service is contacted. The production facade must
keep two requests, reject six with 503, release capacity, accept six successive large retries and stay
under the memory limit. The result records request sizes, status codes, container
peak memory and OOM state. `--image` selects an already available Bun 1.3.13 image;
the harness never pulls one. For a deliberate baseline reproduction only, use
`--source /absolute/path/to/old-worktree --expect-oom`; this expects the disposable
container to be killed by its memory limit.

Live-provider success proves the tested inputs and adapter, not general OCR accuracy,
provider determinism or recognition of unsupported documents. Keep corpus expected
values independent of the provider response.

These are synthetic correctness fixtures, not a representative validation corpus.
The native invoice and statement PDFs use a deterministic structured-output model in the
isolated E2E catalog; all decoders, Actors, solver, transports, publication validation,
database and review controls are production implementations. This proves wiring and
invariants, not OCR accuracy, supplier coverage or quarter-level precision/recall.
The optional live native run verifies provider-backed local/remote parity for those
same inputs; expanded provider corpus tests use an in-memory publication gateway.
No automated
settlement or global assignment is claimed. See the
[reconciliation validation boundaries](../invoice-statement-reconciliation.md#current-executable-flow-and-validation-boundaries).

On filesystems that reject native file watches with `EINVAL`, use
`CHOKIDAR_USEPOLLING=true bun run test:e2e:platform`. This changes file watching only;
it does not skip any gate or alter the application under test.

## Polar Sandbox checkout E2E

The required full-stack gate above keeps its signed fake-payment provider. It is the
deterministic checkout proof and does not depend on Polar availability. A separate,
explicitly authorized test exercises Polar's isolated Sandbox, hosted checkout, test
card, signed webhook delivery, and local purchase projection. It expects the
interactive local stack and a Polar webhook listener to be running; it does not start
or remove them.

Prepare a Polar Sandbox organization once:

1. Create a Sandbox organization access token with product, checkout, order,
   customer, subscription, benefit, meter, and webhook access.
2. Create the one-time avenNAME product and retain its Sandbox product ID.
3. Add `localhost:13200` to the organization's checkout Embed Hosts.
4. Install the Polar CLI and authenticate it against the Sandbox organization.

In one terminal, forward real Sandbox webhooks to the local checkout handler:

```sh
polar listen http://localhost:13200/api/webhooks/polar
```

The listener prints a signing secret. In a second terminal, start the local stack with
that secret and the Sandbox-only credentials:

```sh
export POLAR_API_KEY='sandbox-organization-access-token'
export POLAR_SERVER=sandbox
export POLAR_WEBHOOK_SECRET='secret-printed-by-polar-listen'
export AVEN_TIER_NAME='sandbox-aven-name-product-id'
bun run local:up
```

Then run the opt-in test from that same environment:

```sh
POLAR_SANDBOX_E2E=true bun run test:e2e:polar-sandbox
```

The browser creates a unique name hold, follows the Mailpit checkout email, fills
Polar's embedded checkout with the Sandbox `4242 4242 4242 4242` card, and waits for
the success page. It then requires all of the following independent evidence:

- Polar's Checkout API reports `succeeded`;
- exactly one local payment event and processed `order.paid` delivery exist;
- the name and checkout customer share the provisioned identity subject;
- the purchase entitlement outbox reaches `delivered`; and
- the identity setup email opens the new account page.

The test leaves its Sandbox customer and order in Polar for provider-side diagnosis;
the local stack remains disposable through `local:down`. Run this lane manually or
from a secret-equipped scheduled runner with an authenticated webhook tunnel. Do not
add it to the required per-pull-request gate: external availability, Sandbox rate
limits, and hosted checkout changes are deliberately outside the deterministic proof.

The deployment checks also start the pinned PostgreSQL 18 image, verify persisted
rows after restart, and confirm that an older cluster layout is refused without
initializing a replacement cluster. These checks use disposable Docker volumes.

## Complete pre-deployment gate

For a clean local release candidate, run:

```sh
bun install --frozen-lockfile
bun run lint
bun run check:docs
bun run check
bun run check:identity
bun run check:api
bun run check:checkout
bun run check:customer-platform
bun run test:identity
bun run test:api
bun run test:checkout
bun run test:customer-platform
(cd app && bun test)
bun run build:identity
bun run build:api
bun run build:checkout
bun run test:deploy
bun run test:recovery
bun run test:customer-movement
bun run test:customer-runtime
bun run test:release-archive
bun run test:e2e:platform
```

`platform-ci` and `platform-release` call the same `platform-verification` workflow at
the caller's source revision. Image publication requires that entire workflow to pass.
The required Platform release gate also fails when verification fails or is cancelled.

## CI scheduling and caches

Platform verification runs five independent jobs concurrently: static checks and builds,
unit/infrastructure tests, migration/recovery drills, the native/browser journey, and
host rollout with fresh fleet recovery. The last two jobs consume the same verified
release manifest and run independently; neither waits for the other to finish.
The fleet recovery job allows 60 minutes, including encrypted image archives and
cleanup, to accommodate hosted-runner disk variation. It exits as soon as it finishes.
Every job is required. Security scans still run for each source revision; no path filter,
previous green run or cache hit substitutes for verification. The checks have read-only
repository/package permissions and receive no deployment Environment credentials. Package
registry authentication is scoped to dependency installation and the E2E image builds;
the harness removes it before scans, services and customer tests run.

Only the native/browser journey installs WebDriver and Playwright. Unit tests install the
native build libraries they need. Protected release builds use per-image BuildKit caches;
the exact published image digests are still scanned before the manifest is released.
The source-level workflow contract test checks that both callers retain all critical gates.

Pull-request checks cancel an older run when a newer commit arrives on the same pull
request. Deployment, infrastructure, and operations mutations keep their target-scoped,
non-cancelling locks. The Voice workflow also uses dependency-aware paths on `main`, so an
unrelated merge does not rebuild the native audio stack.

Platform, deployment verification, Actor, Voice, and Android jobs cache compiler or build
download state keyed by their lockfiles, toolchain, operating system, target, and profile.
Caches only accelerate the normal locked build: no compiled release artifact replaces a
build or verification step, and a cache miss runs the same assertions.
Android jobs install `platform-tools` during SDK setup, then install Android 36, build
tools 36.0.0, and the pinned NDK separately. The setup action's default `tools` package
is no longer available from the Android SDK repository.

## Failure handling

- Read the first failing component, not the final aggregate exit code.
- On an E2E failure, the harness prints Compose state and the last 200 log lines before
  cleanup.
- Do not call a result flaky without identifying and recording the nondeterministic
  dependency.
- Re-run the complete gate after changing shared contracts, migrations, deployment
  sources, authentication, authorization, or recovery behavior.

The runtime installation harness also contains a host-controller fixture. It uses the
real API and customer services for entitlement admission, an Intent write, quiesced
adoption, two runtime rollouts and retry without database replacement. It then removes
all platform databases and release configuration, restores the fleet from encrypted
repositories, compares the original Intent and performs a new authenticated write.
It verifies that Actor execution remains paused after recovery. Commerce workers and
the public edge are inert in this fixture; the separate full native journey remains
required for those services. The independent identity fixture survives the simulated
platform loss. This test does not replace infrastructure through a cloud provider.
The host fixture must pass before publishing a release with lifecycle changes.

`bun run test:e2e:platform` remains the complete local native and host proof. CI uses
`bun run test:e2e:native` and `bun run test:e2e:runtime` as separate required jobs.
The runtime command builds and scans its service images from the clean checkout;
image builds require `NODE_AUTH_TOKEN` with package-read access. For release verification,
both jobs instead pull the exact manifest images and run all their assertions. The
lower-level `test:runtime-install` command still consumes already available images.
Its tooling and operations image builds stream progress and stop after ten minutes;
package updates and the container security scan remain required before installation.

Release builds publish candidate image digests first, scan them, and pass their exact
manifest to the full verification workflow. The release journey pulls those images
and skips rebuilding service images; all customer and native tests still run. Only a
successful complete gate publishes the attested durable release manifest. Pull
request verification builds local fixture images because it has no release manifest.
The build and verification jobs have no deployment Environment credentials.

Each release build refreshes the runtime OS package layer using a unique run/attempt
build argument. Compiler and dependency caches remain reusable; a cached package-update
layer cannot silently preserve a vulnerability after an upstream fix becomes available.
Local image-building test runs also supply a fresh OS-layer identifier. The normal
container security scan still blocks fixable high/critical findings on the resulting
images. Verifying an existing release manifest does not read a package token to rebuild
images.
