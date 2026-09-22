# Build and test

Status: authoritative

Use the smallest test level that can disprove the change while iterating. Before a
deployment or merge to a release branch, use the complete gate. A collection of unit
tests is not a substitute for the full-stack proof.

## Test-data boundary

Tests use independently invented records in isolated test environments, or public
specimens with documented provenance. Inspecting a customer's Intent to diagnose a
bug does not authorize copying it into a fixture or an evaluation prompt. Preserve
the failure pattern, not the customer's names, document identifiers, filenames,
amounts, dates, routes, quotations, or distinctive combinations of facts. Merely
marking copied data as “synthetic” or changing a name is insufficient.

The same boundary applies to live-model requests, retained tool receipts, screenshots,
and replay files. Do not use customer database exports as test input. If customer-derived
data entered a fixture, replace it with a separately invented example and invalidate
the affected evidence; do not edit old receipts and call them a new passing run.
Remove affected disposable test outputs after identifying their exact paths. Keep
customer documents and conversations untouched. Existing Git history and model-server
logs are separate retention surfaces and must not be described as erased by a working-tree
cleanup.

Before publishing, inspect the unpublished commits as well as the current files.
A later cleanup commit does not remove data from its parents. Sanitize affected
unpublished versions without changing unrelated work or published history; explicitly
invalidate their old evidence rather than attributing it to replacement fixtures.
Do not put customer-specific strings into a committed privacy scanner or regression
test either. Local recovery objects and provider logs require separate retention
decisions; rewriting a branch is not secure deletion of those surfaces.

## Isolated native connection qualification

Connection qualification uses independently invented mail, API content and accounts.
The real model must be Qwen. No customer database or running-container secrets are
copied into the fixture. Build the six connection images described in
[Local stack](local-stack.md#prepare-a-protected-local-composition) first, plus a current
Intent Service image (`aven-e2e-intent-service:local`, or the explicit
`E2E_INTENT_SERVICE_IMAGE` override).

```sh
LIVE_LLM_BASE_URL=http://trusted-qwen-host:8000/v1 \
LIVE_LLM_MODEL=actual-qwen-model-id bun deploy/e2e/prepare-connection-stack.ts
```

The script prints a private temporary directory and starts nothing. It refuses an
existing `aven-connections` project so a repeated preparation cannot silently replace
its keys. Use the printed directory in both `-f` arguments:

```sh
docker compose -p aven-connections -f /tmp/PRINTED_DIRECTORY/base.json \
  -f /tmp/PRINTED_DIRECTORY/compose.json up -d --wait --wait-timeout 180
```

This stack uses API port 13041, identity 13141, checkout 13241, PostgreSQL 55441 and
Mailpit 18042. It has its own databases and generated keys, no model mock, and only
synthetic remote destinations. Build a separate native development binary with
`AVEN_API_BASE_URL=http://localhost:13041`,
`AVEN_IDENTITY_BASE_URL=http://localhost:13141`,
`AVEN_PASSKEY_ORIGIN=http://localhost:13141`, `AVEN_PASSKEY_RP_ID=localhost` and
`TAURI_CONFIG='{"build":{"devUrl":"http://127.0.0.1:1457"}}'`. Start its frontend on
1457 using the native proof's normal development server. Do not launch this binary
as a customer checkpoint: it deliberately targets the isolated stack.

```sh
bun deploy/e2e/live-native-connections.ts /absolute/path/to/test/aven-os-app /tmp/PRINTED_DIRECTORY
CREDENTIAL_TEST_DATABASE_URL=postgres://test-admin:test-password@127.0.0.1:5432/postgres \
bun deploy/e2e/credential-backup-proof.ts
```

The native proof creates a fresh account, verifies protected connections were installed
as a standard component, enrolls a virtual passkey, authorizes the real desktop, and
uses the settings controls for IMAP/HTTP destinations, rotation and revocation. It
restarts only this stack's three credential services, checks retained metadata, and
declines an exact-request review in the real Studio. Qwen receives redacted metadata
through the actual native model transport. A second query enters through the real
input widget and router: the agent discovers the installed metadata capability,
authors/publishes/runs a Skill and answers from its results without supplied metadata.
Every tool call must succeed. Evidence lives in
`/tmp/aven-native-connections-*`. Set `E2E_CAPTURE_SCREENSHOTS=true` to retain images;
WebKit screenshot availability is separate from successful control interaction.
The test closes its native process and browser in `finally`; the deliberately shared
test stack and frontend remain for inspection. Stop those exact processes and project
when finished; do not prune other projects or images. Retain failed evidence as failed.

The backup proof creates and removes its own databases and key files. It exercises
real PostgreSQL dump/restore, ciphertext-only retention, missing-key rejection,
separate-key recovery, customer-context binding and paused restored execution. It
does not qualify hosted key escrow. Positive remote exchanges and exact content
lineage are covered separately by `live-connection-skills.ts` below, using real TLS,
Dovecot, shared review, Studio and Qwen. A native decline is not evidence of a positive
remote fetch. Hosted deployment, automatic mailbox synchronization and microphone
interaction remain outside these connection proofs.

## Fast development checks

The optional credential component and protected connection factories have isolated
integration checks. Use a disposable local PostgreSQL maintenance database, never a
customer database. Helpers create random test databases/roles and remove them. IMAP
starts and removes a real Dovecot container with invented mail and temporary TLS keys.
The model endpoint must be the authorized real Qwen server.

```sh
CREDENTIAL_TEST_DATABASE_URL=postgres://test-admin:test-password@127.0.0.1:5432/postgres \
bun run --cwd libs/aven-credential-storage test
CREDENTIAL_TEST_DATABASE_URL=postgres://test-admin:test-password@127.0.0.1:5432/postgres \
bun run --cwd services/credential-service test
PROVISIONER_TEST_DATABASE_URL=postgres://test-admin:test-password@127.0.0.1:5432/postgres \
bun run --cwd services/platform-provisioner test
PROVISIONER_TEST_DATABASE_URL=postgres://test-admin:test-password@127.0.0.1:5432/postgres \
LIVE_LLM_BASE_URL=http://trusted-qwen-host:8000/v1 \
LIVE_LLM_MODEL=actual-qwen-model-id bun run --cwd services/platform-provisioner test
bun run --cwd libs/aven-mail test
bun run --cwd services/credential-executor check
bun run --cwd services/credential-service check
docker build -f deploy/e2e/imap-fixture.Dockerfile -t aven-imap-proof:local deploy/e2e
CREDENTIAL_TEST_DATABASE_URL=postgres://test-admin:test-password@127.0.0.1:5432/postgres \
LIVE_LLM_BASE_URL=http://trusted-qwen-host:8000/v1 \
LIVE_LLM_MODEL=actual-qwen-model-id bun deploy/e2e/live-credential-proxy.ts
CREDENTIAL_TEST_DATABASE_URL=postgres://test-admin:test-password@127.0.0.1:5432/postgres \
LIVE_LLM_BASE_URL=http://trusted-qwen-host:8000/v1 \
LIVE_LLM_MODEL=actual-qwen-model-id bun deploy/e2e/live-imap-proxy.ts
CREDENTIAL_TEST_DATABASE_URL=postgres://test-admin:test-password@127.0.0.1:5432/postgres \
LIVE_LLM_BASE_URL=http://trusted-qwen-host:8000/v1 \
LIVE_LLM_MODEL=actual-qwen-model-id bun deploy/e2e/live-credential-management.ts
```

Both connection proofs also start the actual Rust Artifact Store on their disposable
database. Build `aven-artifact-store` first using the Store build procedure below;
the binary must contain the connection type catalog. Requests and selections are
committed artifacts, and successful observations are published and replayed with
their original bytes. The proofs remove their Store processes before dropping the
isolated databases.
The HTTP proof checks concurrent ownership and shutdown cancellation. Both proofs
check settlement and retained-result replay; SQL tests separately check the interval
between the winning claim and explicit host settlement.
The PostgreSQL contract tests cover concurrent settlement, suspension, expiry and
protocol/owner isolation. These checks supplement, not replace, movement/recovery
qualification with deployed executors.

Evidence under `/tmp/aven-live-credential-proxy-*` and `/tmp/aven-live-imap-proxy-*`
retains answers, observations and fingerprints without credentials. These prove
component composition, not a native/facade/Studio journey, production policy issuer,
tenant-scoped Store roles or key escrow. Do not enable customer credential use on the
strength of these proofs alone.

`live-credential-management.ts` exercises the real HTTP facade, signed identity and
tenant grants, SQL membership rechecks, encrypted set-only ingress and the settings
state controller. It checks create/bind/rotate/revoke, acknowledgement loss without
duplicate writes, foreign-origin and customer rejection, and real-Qwen interpretation
of redacted IMAP/HTTP connection metadata. It also starts the actual policy adapters,
admitted invocation guard and shared review flow for HTTP/IMAP use issuance, including
workload-role separation and rejection after run completion. Its disposable database colocates control
and component schemas solely for this test. Evidence goes to
`/tmp/aven-live-credential-management-*`; it does not qualify native login, visual
interaction, production placement or remote protocol execution under that policy.

`live-connection-skills.ts` requires the same model/database variables and Dovecot
image. It combines Qwen-generated request settings, shared Studio execution, the
actual policy issuer and protected HTTP/IMAP hosts. It checks denial before network
access, approved HTTPS capture, mailbox selection and selected-message capture,
byte-exact saved content, Qwen answers from that content, unchanged unread flags,
protected publisher identity through Studio, and settled execution markers. Evidence
is separate under `/tmp/aven-live-connection-skills-*`. The fixture uses a fixed-scope
Store and colocated test control tables. Protected uses exercise real tenant-derived
function-role pools, but this is not native or deployment qualification. Failed runs
retain `passed: false` and do not count as evidence.

It also checks saved HTTP inspection → file → real LLM composition and rejects file
derivation from HTTP errors. Saved mail is decoded by the native parser into files
with declared raw-message inputs. Build the parser as well as the Store before this
proof. The runner Docker image includes its release build; local source runs default
to `target/rust/debug/aven-mail-parser`, or an operator may set `MAIL_PARSER_BINARY`
to the built binary's absolute path. This path is never an Actor parameter.

```sh
cargo build --locked --manifest-path libs/aven-mail/parser/Cargo.toml
cargo test --locked --manifest-path libs/aven-mail/parser/Cargo.toml
```

```sh
CREDENTIAL_TEST_DATABASE_URL=postgres://test-admin:test-password@127.0.0.1:5432/postgres \
LIVE_LLM_BASE_URL=http://trusted-qwen-host:8000/v1 \
LIVE_LLM_MODEL=actual-qwen-model-id bun deploy/e2e/live-connection-skills.ts
```

The provisioner suite also installs Actor schema version 7 in a disposable customer
database and checks function-only review roles, exact decisions, simultaneous answers,
postponement, expiry and lease/generation fences. With the real model variables set,
it exercises Qwen, signed interactive admission, the SQL runner and two Studio review
barriers across restart. It also checks the shared Actor admission hook and private
invocation guard against wrong owner/session/generation and admission after completion.
Evidence is retained under `/tmp/aven-live-review-session-*`.
This proves the shared review flow, not native interaction or credential-use policy.

The host-only credential encoding has a separate focused check:

```sh
bun run --cwd libs/aven-credential-storage check
bun run --cwd libs/aven-credential-storage test
```

The customer-platform check and test scripts include this package. Its
actual-cryptography cases check public-only sealing, authenticated customer and
record context, byte bounds, tampering, closed algorithms, JSON storage round-trips,
and explicit key rotation/removal. Operator-key loader cases additionally check
separate public/private files, permissions, links, closed formats and synthetic
file loss/restore. They do not install a customer Vault, configure deployment keys,
prove external key escrow, or authorize protocol use. No customer secrets are used.

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

Answer openings use a direct result or question with natural punctuation, not a
mandatory five-word sentence ending with a period. The focused real-Qwen regression
checks clarifications in six languages and an exact-format reply twice:

```sh
LIVE_LLM_BASE_URL=http://trusted-qwen-host:8000/v1 \
LIVE_LLM_MODEL=actual-qwen-model-id \
bun deploy/e2e/live-answer-opening.ts
```

Set `COMPARE_LEGACY_OPENING=true` only for the paired calibration experiment. It
alternates the historical and candidate instructions while keeping the same shared
engine and actual model. Evidence under `/tmp/aven-live-answer-opening-*` includes
raw answers and model timings. The punctuation and no-action assertions do not
replace human semantic review, audio-device tests or loaded speech-latency proof.

Document research uses a per-turn evidence checklist with source-validated quotes,
the shared `calculate` Actor for exact decimal arithmetic with explicit units,
`reconcile_ledger` for evidence-backed ledger reconciliation in explicit minor units,
`check_coverage` for gaps between required and confirmed time intervals, and a separate per-checklist-item model review before
speaking or saving the final answer. The reviewer receives source text and requirements
without the writer's checklist conclusions and preserves source timestamps. It checks
request-wide language, time scope, outcome and presentation before the source checklist.
Follow-up turns in the same Intent retain bounded source evidence and remain subject
to review even when the agent does not read those sources again.
Retained pages omitted from the shortened conversation are also supplied to the
writer, without duplicating pages still present in tool results. Speaker roles
remain attached to message evidence; earlier assistant answers are not independent
verification. The shared source-content bound remains 100,000 characters.
If the author omits its factual checklist, a separate model request reconstructs it
from the current request and retained sources, with one validation retry. That phase
has no action tools and never repeats writes. Exact quotations still have to match
retained text, and the normal answer review still follows. Operational requests can
have an empty source checklist; their claims are checked against actual tool outcomes.
Verification enables private model reasoning within a 12,288–16,384-token budget scaled
to checklist size; only its structured assessments are retained in diagnostics.
The review uses ordinary generation followed by strict application-side JSON and
index validation. Decoder-enforced JSON together with the tested Qwen reasoning
mode repeatedly exhausted its completion budget. Removing that decoding constraint
does not remove any acceptance checks. A
malformed or incomplete review gets one verifier-only retry; it never repeats previously
executed actions. Two invalid reviews still fail closed.
There are 32 tool rounds, followed by at most four rounds restricted to the checklist,
calculator, and final answer. Tool planning enables private model reasoning within
an 8,192-token completion bound; reasoning is not shown as conversation text.
An incomplete completion gets one retry; a rejected
answer gets at most two answer-only repairs, with no tools exposed or executed in
that phase. Unfinished actions must be reported as unfinished, not retried while
correcting prose. Correction uses an isolated request with the retained evidence,
actual tool outcomes and review findings, rather than the earlier tool conversation
and rejected working conclusions. The rejected draft itself is omitted so unsupported
claims do not anchor the replacement. Repair enables private reasoning with the same
bounded completion budget as verification. Concision must preserve source-backed
purpose and scope for content questions, including material project or allocation
details on later pages. Operational requests instead get a short receipt; using a
document as an input does not request a recap of its contents. Bounded run observations
retain exact output identities, activation references and timestamps, so the reviewer
can connect a succeeded run to the report the agent inspected.
Internal repair instructions are not added to
conversation history; only the accepted answer carries into subsequent turns.
Rejection clears the earlier checklist conclusions
while retaining requirements and quoted evidence. Search completeness is tracked per
query and scope, so exhausting a page chain clears its incomplete status. Exhaustion, invalid review output, and truncation
are failures, not accepted partial answers. Failed exchanges retain a factual failure
summary in conversation history so follow-up questions do not lose the failed request.
Tool-call diagnostics are saved in contribution payloads with redacted structured
credential fields, bounded details and an explicit truncation flag. They describe
observed calls, not durable execution receipts. Invalid JSON tool arguments are
rejected without execution and quoted as data in subsequent model requests, so a
malformed attempt cannot make the provider reject every later message. Ordinary conversation still streams
without the document review.

Source search uses a rebuildable IndexedDB token index, including document body
text and an Intent-scoped token index. Each page examines at most 200 metadata rows
and returns at most 20 passages of 650 characters. Keyset cursors avoid offset scans;
a multiword document query requires all tokens and visits each source once, rather
than repeating a page chain for each token. Coverage counts use the requested Intent
and date scope; unavailable documents outside that selection do not taint it.
a changed index requires restarting pagination. Source bodies are stored separately
and loaded only for returned candidates. Full reads return 12,000-character pages;
the native reader limits search documents to 1 MiB. Larger, unavailable, and partly
extracted sources remain an explicit coverage gap. Unknown source dates remain
candidates and require checking the dates within the document.
Assembled text coverage compares complete chunk page counts with the inspected page
count. Pending classification or financial review alone does not make that text
incomplete. Active processing, missing chunks and incomplete extraction still do.
A successful direct read repairs a stale unavailable-index marker after caching.
Source review retains `sourceComplete` separately from `nextOffset`; a page with more
readable text is not a truncated upload. Search titles, page sizes and scoped index
coverage are retained for review, within explicit metadata bounds. They establish
file metadata, not document content or independently verified business facts.

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
Each message-search preview supplies its exact code-point `readOffset`, so an agent
can open the matching page without guessing or walking the entire message. The
SQL returns an exact original substring with source identity and range metadata;
that displayed range is retained for quotation without another fetch. Document
search summaries and unmarked snippets remain navigation only. If headline generation
removes markup and cannot be located verbatim, the original first page is shown instead.
Messages of at most 700 code points are returned whole, even when matching terms
occur after the beginning. The shared agent search allows an explicit integer page
size from 1 to 20, default 20; chronological ordering still requires an exact Intent.
The page size changes neither query scope nor the meaning of an exhausted cursor.
Historical research checklists and their turn-local quote handles are excluded from
the next question's model context; original traces and ordinary action receipts remain.

Message queries accept a `role` filter (`user` or `assistant`) and, within an explicit
Intent, `order: oldest` or `newest`. They list conversation messages, not interleaved
activity records. The shared contract applies to native, local and delegated readers;
cursors bind both filters so a continuation cannot silently change speakers or direction.
The contribution sequence is a storage position, not a speaker-specific ordinal.
First/nth-message lookups can therefore browse the relevant speaker oldest-first
without reading every newer activity entry. Global discovery remains keyset-ordered
by ID, not a promised chronology across unrelated conversations.

Run the optional real-PostgreSQL proof against a disposable server. The runner creates
and removes its own fresh database; it does not clear an existing customer's schemas:

```sh
INTENT_RETRIEVAL_TEST_DATABASE_URL='postgresql://test-user:test-password@127.0.0.1:5432/postgres' \
bun run --cwd services/intent-service test
INTENT_RETRIEVAL_TEST_DATABASE_URL='postgresql://test-user:test-password@127.0.0.1:5432/postgres' \
bun services/intent-service/bench/retrieval.ts
```

The integration proof installs the initial schema and checks ownership, search, and
full-message paging. The benchmark exercises recent, common, rare, absent and scoped
searches, plus oldest/newest speaker-filtered history and an absent speaker, at
10,000, 100,000 and 1,000,000 synthetic messages. It checks result bounds and fails if a query
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

The Linux Artifact Store read-pressure probe requires a freshly built test image
and an administrator connection to a disposable PostgreSQL cluster:

```sh
TEST_ARTIFACT_STORE_IMAGE=your-current-test-image \
TEST_TASK_DATABASE_URL=postgres://proof:password@127.0.0.1:5432/postgres \
bun deploy/e2e/artifact-store-memory.ts
```

It creates its own database and a read-only, capability-dropped server container
under the production 768 MiB memory cap. Sixteen concurrent clients issue 1,280
context/feed reads; cgroup memory samples and container state are retained under
`/tmp/aven-artifact-store-memory-*`. It requires the light read workload to remain
below 256 MiB, then removes only its generated database/container. This tests real
HTTP/PostgreSQL resource behavior, not LLM quality or worst-case upload capacity.

With the same test-image and disposable-database variables,
`bun deploy/e2e/artifact-store-pools.ts` checks simultaneous first access to two
generated customer databases. It runs three bursts of 64 actual HTTP reads, with
one allowed connection per generated role and one connection per pool. Every
response must belong to the correct database and succeed without a client retry.
Evidence is saved under `/tmp/aven-artifact-store-pools-*`; only its generated
databases, roles and container are removed. This does not establish limits for
multi-replica deployments or pool-cache churn beyond its two active environments.
Both resource probes also run in the Linux full-stack gate against that run's
fresh image and disposable cluster, before the native journey.

Skill Studio's compiler and service tests run in the customer-platform suite.
Its `studio.persistence.e2e.test.ts` is included in the Actor Runner persistence
stage of the full-stack gate and requires both its disposable PostgreSQL database
and production Artifact Store. The v2 journey proves a synthetic email → exact
nested Skill → committed brief path, output-to-activation-to-Skill provenance,
duplicate-delivery replay, connection catch-up after Runner restart, and draft
conflicts. It does not contact a mailbox or call a model.
The journey also confirms a recalled case, builds and resumes its refined draft,
and proves the exact case remains in the published Skill's Store provenance.

Persistence test files run sequentially because they share one Artifact Store
with its production two-upload admission limit. Tests still exercise concurrent
claims, dispatch, and execution within each file; fixture setup from unrelated
files must not compete for those same slots.
Ledger assertions select their exact fixture evidence and preserve unrelated
reviews; sequential execution does not imply an empty customer ledger.

The live Skill harness's `--intake` scenario also tests upload admission against
real PostgreSQL and Store processes: 40 rejected publication attempts and 40
committed replays use one reservation, conflicting bytes/commands fail, missing
catalog definitions prevent staging, and actual reservation exhaustion remains
HTTP 429 through the API coordinator. It restores its disposable catalog and expires
only its own test claims before continuing the live-Qwen Skill scenarios. It does
not mutate the interactive customer's database.

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
It clears an inherited `COMPOSE_PROJECT_NAME` so inventory checks and cleanup address
each prepared generation, not the outer test stack.
Run it separately only after building those images at the current checkout:

```sh
bun run test:runtime-install
```

## Full-stack E2E release gate

On a prepared Linux workstation:

```sh
bun run test:e2e:platform
```

The harness type-checks the browser/native test entry points, builds an optimized
Rust/Tauri application and every service image, starts
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

The native Studio journey seeds fictional manual processes in older Intent history,
then uses written input and accepted speech transcripts through the normal chat and
agent tool loop. It retrieves exact evidence, waits for a physical case confirmation,
builds and refines a Skill, publishes it and checks the saved productive result.
Scenarios cover a supplier-review checklist, a Friday email handover and an
unimplemented permit check that must remain an ideal node. The nested-invoice
persistence test composes reusable reading, extraction, validation and Markdown
checklist Skills; it verifies pinned child revisions and non-destructive patching.
These tests use controlled model responses. They prove UI/tool/runtime/storage
wiring, not live-Qwen reasoning quality, microphone transcription or general OCR
accuracy. They do not read or alter the developer's customer data.
The prose-only chat fixture cannot classify destinations: this lane explicitly
uses the visible manual destination controls after routing fails. It also checks
that speech interruption stops narration without cancelling the Intent's answer.
It does not qualify automatic routing or automatic feedback.

For real-model qualification of conversation routing, feedback and continuity, use
the separate live lane on the same prepared workstation:

```sh
TEST_DOCUMENT_PROVIDER_BASE_URL=http://trusted-qwen-host:8000/v1 \
TEST_DOCUMENT_PROVIDER_MODEL=exact-qwen-model-id \
TEST_DOCUMENT_PROVIDER_PROFILE=qwen-tools \
sh deploy/e2e/run.sh live
```

This builds a fresh native client and disposable stack with generated credentials,
then signs in through checkout, passkeys and native device authorization. Chat,
routing and feedback all use the explicitly configured Qwen provider; missing real
provider configuration stops the run instead of substituting fixture responses.
The scenario checks multilingual automatic feedback, a manual override and reason,
reload, new, existing and archived Intent navigation, bounded source context across Intents,
and feedback submitted while the target response is still running. A further case
retrieves the exact seventh human contribution outside the hydrated recent history,
with interleaved activity that must not count as conversation messages. The context
inspector must display every prepared message in order even when their openings
repeat, and its control must close normally. The task scenario creates two tasks
through English chat, reloads, reassigns one to an existing Intent through Spanish
chat, then reloads and opens the actual list through German chat. Stored identities,
revisions and unchanged fields must match, and both workspace rows must appear once.
It also sends
tokenizer-sized, synthetic long conversations through the signed-in native request
transport: an exact near-limit answer, input/output-reservation overflow, input-only
overflow and successful continuation after rejection. This supplies request history
directly through native IPC; it does not type the entire conversation in the UI or
prove token-aware history compaction. It writes
`real-qwen-native-evidence.json` in the Playwright result directory, including failed
observations. Each harness run prints its own `/tmp/aven-platform-proof.*` directory;
later runs do not overwrite failed evidence. The native reads use the actual session's token refresh path.
This lane skips controlled model scripts and the host recovery drill; it supplements,
not replaces, the full release gate. It does not qualify microphone transcription,
all Skill authoring or external credential use. The configured model endpoint must
be reachable from the disposable containers; this lane does not copy customer
service credentials. Use the isolated-display command below around this command
when a desktop is in use.

The harness overlays production container limits, capability removal, read-only roots,
temporary filesystems, and child-process reaping. Recovery uses a separate drill; the
local payment, inbox and LLM fixtures do not prove availability of external providers.

With a separate development frontend on `http://127.0.0.1:1457`, the focused progress
check uses actual Qwen through the gateway, shared chat engine, calculation Actor and
production Svelte component:

```sh
LIVE_LLM_BASE_URL=http://your-model-host:8000/v1 \
bun deploy/e2e/live-compact-progress.ts
```

It retains synthetic inputs, observed calls, source fingerprints and screenshots in
its printed temporary directory. It checks a compact collapsed heading, live elapsed
time, expanded model/tool chronology, result cards and any recovered tool errors.
`app/tests/tool-results-layout-ui.mjs` separately replays independently synthetic
real-Qwen calculation evidence in both production chat surfaces at three widths;
it checks wheel scrolling, parked reading positions, follow re-engagement and result
widths. Pass an existing evidence file as its argument; `UI_BROWSER=webkit` selects
WebKit. These focused browser proofs do not exercise native authentication or replace
the release gate. They must not use a customer history export.

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
candidate lineage, decision replay and scope denial. The native proof has five serial
stages: account setup, text/chat/voice, PDF finance, CSV finance, and environment
isolation/persistence/hosting. Each has its own
180-second budget and shares the account created through checkout. A failure skips
subsequent dependent stages; browser and native sessions are still cleaned up.
Service tokens refresh between stages while membership-denial checks retain the
same token within their stage. Financial waits fail immediately on terminal failure;
otherwise they allow 20 seconds per document and 10 seconds for saving a decision.
The summary invoice may honestly require review for missing itemized line-net
coverage. Amount arithmetic and identity must pass; missing rows must never be
invented to satisfy validation. Accepted relationships still require a physical click
and persisted evidence. Text-document graph waits are bounded to 20 seconds and wait
for terminal processing before comparison. Financial waits print stage transitions
and retry errors. Navigation waits for the production environment controls to become
available after publication, reconciliation, and review saving finish.

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

Actor Runner ships the pinned PDF.js standard-font assets beside its bundled service.
The headless decoder renders glyph outlines without installed system fonts. The
native gate runs a container rendering regression with all registered fonts removed
and checks visible pixels in an invoice using unembedded fonts. Extracted text or a
nonempty PNG alone cannot prove that the rendered text is present.

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
60 seconds, within each native stage's 180-second budget. CSV detection is
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
same inputs, comparing source bytes, graph structure, deterministic payloads and
resolved document kind rather than requiring identical model-written reasons. Expanded
provider corpus tests use an in-memory publication gateway. No automated settlement
or global assignment is claimed. See the
[reconciliation validation boundaries](../invoice-statement-reconciliation.md#current-executable-flow-and-validation-boundaries).

On filesystems that reject native file watches with `EINVAL`, use
`CHOKIDAR_USEPOLLING=true bun run test:e2e:platform`. This changes file watching only;
it does not skip any gate or alter the application under test.

On a Linux desktop in active use, give native tests their own display, as CI does.
With `xvfb`, `xauth`, and the normal native prerequisites available, run:

```sh
env -u WAYLAND_DISPLAY GDK_BACKEND=x11 \
  xvfb-run --auto-servernum --server-args='-screen 0 1600x1000x24' \
  bun run test:e2e:platform
```

This isolates window focus and pointer input from the interactive desktop. It still
uses the built Tauri application and physical WebDriver clicks, not synthetic DOM
click events. The polling watcher setting above can be combined with this command.

On Linux, the native test driver defaults to `E2E_TAURI_RENDERING=software`, applying
the WebKit DMA-BUF and compositing workarounds only to its child processes. This
keeps headless test rendering separate from normal desktop hardware selection.
For an accelerated-rendering smoke check, use `E2E_TAURI_RENDERING=auto` and unset
inherited `WEBKIT_DISABLE_DMABUF_RENDERER` and `WEBKIT_DISABLE_COMPOSITING_MODE` flags
on a GPU-capable display. Software-rendered E2E results do not prove GPU performance;
screenshot support still depends on the host's WebKit/WebDriver combination.

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

## Live Studio workday

Focused routing qualification uses the production gateway and real Qwen, with
independently invented multilingual cases and reply classifications:

```sh
LIVE_LLM_BASE_URL=http://trusted-qwen-host:8000/v1 bun deploy/e2e/live-input-decisions.ts
```

The route also distinguishes a topic opening from a request, without another model
round. The suite retains overlapping-scope, action-word title, actual-action and
follow-up contrasts, repeated three times. Inspect both the destination and scope;
a fast but unnecessarily split or overactive conversation is not a pass.
Cross-Intent task/file actions are contrasted with explicit conversation moves in
English, German, Spanish, French and Italian. Naming an action target must not move
the conversation, and that rule must not suppress a separately requested chat move.
Held-out contexts add Dutch, Portuguese and Russian, larger candidate sets, multiple
object destinations and a separately directed question. Setup-only and work requests
are stated separately when a purpose clause would be ambiguous. Failed attempts
retain the actual synthetic provider output, including decisions rejected by the
contract; do not copy customer routing content into this corpus.

The shared-engine recovery proof additionally requires an isolated PostgreSQL server:

```sh
LIVE_LLM_BASE_URL=http://trusted-qwen-host:8000/v1 \
TEST_CHAT_JOURNAL_DATABASE_URL=postgres://proof:password@127.0.0.1:5432/proof \
bun deploy/e2e/live-chat-journal.ts
```

Never point this at a customer database. The proof creates and drops its own randomly
named database. It uses actual Qwen-generated calls and database-backed synthetic
notes to exercise the production engine and fenced journal, including loss after a
committed write, receipt recovery, changed-input rejection and lease replacement.
A deliberately disconnected actual model stream retains a failed turn outcome on
replay without new model calls or effects; replay does not relabel failure as success.
The saved model durations and first-text measurements must match their original
PostgreSQL checkpoints, including calls replayed after a lost tool acknowledgement.
The complete saved answer, diagnostics and original timings must remain identical
on terminal replay. The overall response retains the first journal start and includes
work before recovery; it cannot restart the timer at the latest attempt. The native
background journey checks the same property after killing the actual worker process,
and compares its duration with the database checkpoint times. This measures wall time
since first execution, not initial queue time or total CPU/provider time.
Recovery by checking a saved receipt is labelled separately from the lost
execution's duration.
Tool checkpoints retain the exact model-generated command and result. The proof
attempts to substitute arguments after the actual write but before acknowledgement;
the journal must reject this and keep the unresolved checkpoint pending. Recovery
must then bind the original command to its original receipt, without another effect.
The proof also sends actual action-claim verification and an unlabelled model request
through the runner's strict portable-JSON progress check. Verification is labelled;
an unavailable optional phase is omitted, not serialized as `undefined`.
Notes in this test are a journal test port, not proof of the production Todos Actor.
Neither command replaces native routing, microphone/TTS, protected credentials or
unattended worker tests. Evidence records all attempts and source fingerprints under
`/tmp/aven-input-decisions-*` and `/tmp/aven-live-chat-journal-*` respectively. Stop any
disposable database container after the run; no persistent volume is needed.

`live-dispatched-chat.ts` retains the first actual request of each Studio turn in its
synthetic evidence. To compare a tool-name reminder without changing production or
executing any selected action:

```sh
LIVE_LLM_BASE_URL=http://trusted-qwen-host:8000/v1 \
LIVE_LLM_MODEL=actual-qwen-model-id \
bun deploy/e2e/live-tool-selection.ts /absolute/path/to/synthetic-dispatcher/evidence.json
```

The experiment alternates the captured request with an explicit callable-name list,
and includes independently written German/Portuguese discovery and French task
requests, three times each. It retains all 24 results, not just passing attempts.
The checks cover first-call selection and object-shaped arguments, not full argument
validation or successful execution. Inspect unnecessary calls as well as invented
names. An experiment finishing does not mean its candidate is qualified. Never use
a customer trace as this input.

`TOOL_SELECTION_EXPERIMENT=reasoning` instead compares reasoning enabled/disabled;
`TOOL_SELECTION_EXPERIMENT=registry-guidance` compares the historical global
`registry_list` instruction with its removal. The latter requires a captured
synthetic request that still contains that instruction. All variants explicitly
retain the live test host's effective token and reasoning settings. Early captured
fixtures omitted its defaults; an experiment that silently enables reasoning is not
evidence about non-reasoning first-call behavior. The shared prompt no longer names
that unconditionally available registry tool: each host's actual tool manifests own
discovery contracts.

The dispatcher also uses an independent reasoned model audit of actual saved cases,
separate from the application's unchanged answer reviewer. Calibrate that oracle
before accepting a prompt or output-mode change:

```sh
PLAN_ORACLE_VARIANT=reasoned-envelope \
LIVE_LLM_BASE_URL=http://trusted-qwen-host:8000/v1 \
LIVE_LLM_MODEL=actual-qwen-model-id \
bun deploy/e2e/live-case-qualification.ts /absolute/path/to/synthetic-cases/evidence.json /absolute/path/to/synthetic-held-out-cases/evidence.json
```

Both inputs must be retained synthetic dispatcher evidence with two saved proposals.
The experiment does not replay actions or modify saved artifacts. It audits actual
original/revised plans plus deliberately defective evaluation inputs twice, including
a held-out real generated plan that permits bypassing mandatory human review. Every
verdict and invalid output is retained. `completed: true` alone is not passing: every
case must have the expected verdict. Faster structured-output candidates previously
accepted the held-out bypass and are not enabled. The shared test helper places the
recorded request inside an explicit audit envelope; it does not ask the auditor to
perform the original task or invent additional requirements. Recovered tool errors
remain a failing interaction-quality gate in the dispatcher, but do not prevent
collecting independent later-stage evidence. State, effect and authority failures
still stop immediately.

The saved-task journey adds actual component provisioning, restricted PostgreSQL
roles, facade admission, signed identity/tenant/work grants, and real HTTP requests:

```sh
LIVE_LLM_BASE_URL=http://trusted-qwen-host:8000/v1 \
TEST_TASK_DATABASE_URL=postgres://proof:password@127.0.0.1:5432/postgres \
bun deploy/e2e/live-durable-tasks.ts
```

Use a disposable PostgreSQL **server**, not a customer cluster. The fixture needs
permission to create its randomly named databases and roles; it removes them in its
cleanup. It does not modify a pre-existing customer environment. Qwen creates,
updates and trials independently invented tasks through the shared Actor and engine.
Follow-ups rehydrate customer-local outbox history, including recent tool receipts;
they do not receive an extra test-only task-ID hint. Final answer publication and
FIFO release use the outbox transaction and its stable output contribution ID.
Productive model tool calls use exchanged work grants rather than a login token,
with actual control-directory, outbox, runner-lease and causal-contribution checks.
The exchange, worker-placement discovery and both execution checks cross signed HTTP boundaries. Malformed,
oversized, mixed login/work and caller-selected destination requests are rejected.
The proof checks receipt recovery after an acknowledgement loss, conflicting edits,
batch rollback, archive/restore, trial isolation, wrong owners/sessions, cross-Intent
references, service restart and database-role separation. Input admission crosses
the actual facade, a separate control database with a read-only authorization role,
and Intent Service. It checks replay, certificate/message binding, unavailable
component scope and rejection before storing a contribution. Evidence under
`/tmp/aven-live-durable-tasks-*` records answers, calls and source fingerprints. This
does not replace native integration, production outbox dispatch, full process-crash recovery, or
productive nested-Skill qualification.

To qualify large task receipts, current state and saved-history continuity, run:

```sh
LIVE_LLM_BASE_URL=http://trusted-qwen-host:8000/v1 \
TEST_TASK_DATABASE_URL=postgres://proof:password@127.0.0.1:5432/postgres \
bun deploy/e2e/live-receipt-continuity.ts
```

Use the disposable-server rules above. Real Qwen creates twenty-four fictional tasks,
lists their titles, updates their dates, archives one and answers a follow-up after
SQL history reload. The checks compare actual task state and reject duplicate writes.
Six additional audits use those actual receipts to contrast supported and unsupported
claims. A separate personal-task group contains thirty-six independently invented
long multilingual records. Qwen must exhaust the content-bounded pages, count all
tasks and a responsibility subset without changing anything. Every returned row
must remain identical in reviewer evidence; two further audits distinguish the
correct subset count from an unsupported count. Evidence, including failures, is
saved under `/tmp/aven-live-receipt-continuity-*`.
After another saved-history reload, a Spanish instruction moves only two named tasks
to an existing Intent. Their identities, dates, status and group must survive; source
and destination queries must agree with the saved revisions. Service-boundary checks
reject missing and foreign destinations even for a command without a conversation
cause. The original cause and immutable receipt remain available.
A French follow-up requests three new tasks with different initial states. Each
must be saved at its first revision with the requested status, without follow-up
updates, implicit archiving or changes to existing rows.
This exercises the shared foreground engine and authenticated task HTTP/SQL, not
native UI, speech or durable outbox recovery.

For smaller held-out destination-continuity conversations, run:

```sh
LIVE_LLM_BASE_URL=http://trusted-qwen-host:8000/v1 \
LIVE_LLM_MODEL=qwen-model-id \
TEST_TASK_DATABASE_URL=postgres://proof:password@127.0.0.1:5432/postgres \
bun deploy/e2e/live-intent-references.ts
```

Use the same disposable-server boundary. Each of two actual Qwen conversations
creates tasks, moves one to a named Intent, reloads its SQL history and adds a new
task “here.” English, German, French, Spanish and informal wording are interleaved.
Assertions check original identities and revisions, unchanged fields, exact
destination sets and no failed tools or answer repairs. Display names come from
bounded host references; the accepted conversation identity remains separate.
Evidence stays under `/tmp/aven-live-intent-references-*`. This is shared-engine,
Actor and signed HTTP/SQL proof, not native navigation or microphone qualification.

For actual native UI actions combined with calculations and answer verification:

```sh
bun deploy/e2e/live-native-receipts.ts /absolute/path/to/test/aven-os-app \
  /absolute/path/to/private-session.json synthetic-environment-uuid
```

Use an isolated native binary pointing at a test frontend on port 1457, the existing
synthetic device-sign-in fixture, and a healthy local facade configured for real Qwen.
The test must not use the customer's environment. It exercises the input widget,
actual list/board/activity Actors, calculation receipts, answer verification and saved
contributions. It records the exposed calculator contract, source fingerprints and
screenshots under `/tmp/aven-native-receipts-*`, then closes its owned native/browser
processes. Stop the separately owned test frontend afterward. This is a focused
software-rendered desktop check, not microphone, hardware graphics or a full release
qualification. Correctness and first-attempt quality are separate receipt fields:
one rejected pure calculation may recover, but any such retry fails the latter.
UI failures or repeated rejection fail the journey. On an active Linux desktop use
the separate-display procedure above; a screenshot timeout is not a passing visual
check. If the WebDriver screenshot endpoint stalls, `E2E_NATIVE_CAPTURE=xvfb` selects
a direct `xwd` capture of the isolated virtual framebuffer, decoded to PNG. This
option requires `xwd`, an `xvfb-run` authority file and a non-default test display;
it refuses to capture the customer's normal desktop. The evidence records which
capture path was used. A requested capture failure still fails the run.

For consecutive messages already waiting in a foreground conversation, run:

```sh
LIVE_LLM_BASE_URL=http://trusted-qwen-host:8000/v1 \
TEST_TASK_DATABASE_URL=postgres://proof:password@127.0.0.1:5432/postgres \
bun deploy/e2e/live-queued-continuity.ts
```

Use the same disposable-server rules above. This journey uses independently invented
split requests, corrections, withdrawals, independent outcomes, informal German,
mixed-language input and genuinely missing information. A gate delays an actual Qwen
request only long enough to admit the queued inputs; it replaces no response. Checks
cover original-message persistence, answer associations, exact saved task state and
no repeated mutation after reloading SQL history. Evidence retains all attempts under
`/tmp/aven-live-queued-continuity-*`. This is foreground engine/service proof, not native
speech/routing or durable outbox coalescing. Inspect the answers as well as the checks;
eventual correctness does not qualify speech latency.

Replay a passed journey's actual saved conversation in both production chat surfaces:

```sh
AVEN_STUDIO_UI_URL=http://127.0.0.1:1457 \
bun app/tests/queued-continuity-ui.mjs /absolute/path/to/evidence.json
```

The separate Vite test frontend must already be running. `UI_BROWSER=webkit` selects
Playwright WebKit instead of Chromium. The replay checks original messages, the shared
answer label, no horizontal overflow and a visible, draft-preserving input at desktop
and narrow widths. Stop the owned preview and disposable database when finished.

The dispatched-chat proof connects that same admitted outbox to the actual SQL
runner and shared Chat executor:

```sh
LIVE_LLM_BASE_URL=http://trusted-qwen-host:8000/v1 \
TEST_TASK_DATABASE_URL=postgres://proof:password@127.0.0.1:5432/postgres \
bun deploy/e2e/live-dispatched-chat.ts
```

It requires the same disposable-server permissions and cleanup boundary. The runner
and dispatcher are composed in-process; Task calls, admission, lifecycle recovery,
pinned conversation context and final publication use actual signed HTTP boundaries.
Model streams cross the actual service-authenticated facade and shared streaming
client. Negative checks reject absent/wrong service credentials, mixed login/work
headers, malformed JSON, invalid request shapes and oversized bodies before model
dispatch. The shared `ChatTurnHost` verifies the accepted input and authority and reconstructs
history, including routing decisions and anonymous speaker metadata. It does not
use a test-only prompt/history loader.
Real Qwen handles independent and FIFO-queued Intents, broad-topic
clarification, multilingual saved tasks and colloquial follow-ups. Deliberate faults
lose runner admission, wakeup, a committed task reply and final-answer publication
acknowledgement. Fresh runner instances recover without duplicate effects or answers.
Recovery scans past more than one page of unbound work and does not wait for a slow
Actor to finish before allowing another recovery sweep.
Archived-history scenarios require the model to use a later human correction rather
than an earlier assistant claim, and to page through long planning notes. They use the
shared retrieval Actor and actual delegated history HTTP requests, with no failed tool
attempts accepted. An interrupted observation is read again under fresh authority;
mutations still require original receipts. Reads never move the accepted Intent or
create unsolicited tasks.
The journey also exposes the restricted, execution-bound Studio authoring adapter
to Qwen. It requires an actual saved/published Markdown Skill, then a refinement of
that same draft with unchanged settings and immutable predecessor lineage. It loses
the actual rename reply before its tool checkpoint, replaces the worker, and requires
the original save receipt without another edit. A second draft in place of a requested
revision fails the test. Further turns create an intentional variant and a parent
that references the published child rather than copying its implementation. During
variant publication it loses the real Store acknowledgement before the draft head
is updated. Recovery must find the original commit, acknowledge that unchanged head
and send no second publication request. Operational completions must stay short and
leave internal IDs and schema mechanics in inspectable receipts.
The extended case scenarios lose both an original and a revised proposal's replies.
They require immutable lineage, missing steps still marked ideal, a real what-if
inspection, and no self-confirmation or executable publication. This authoring
boundary does not prove delegated child execution or native UI.

The supporting PostgreSQL transaction suite uses the same disposable-server URL and
creates and removes its own UUID-named database:

```sh
TEST_TASK_DATABASE_URL=postgres://proof:password@127.0.0.1:5432/postgres \
bun run --cwd services/actor-runner test tests/studio-draft-receipts.persistence.e2e.test.ts
```

It checks receipt-insertion rollback, competing deliveries, exact snapshots after
later edits, and execution fences. It has no model and is not a substitute for the
Qwen journey above. Never point either test at a customer database server.
The supervised dispatcher also admits a new Qwen task without a foreground pump,
past seventeen directory placements whose physical databases are unavailable.
Overlapping wakeups share a scan. Closing the supervisor stops its timer and new
admissions; a committed runner admission still finishes its durable outbox binding.
Progress is inspected before a delayed model returns. Model journal entries retain
the engine-owned phase (answer, checklist, verification or repair), full duration
and time to first nonempty public text/tool fragment. This does not measure first
audio or first accepted answer. Negative recovery checks use
expired-run snapshots around the records actually produced by Qwen; changed engines,
attempt limits and unregistered executors must not call the model or repeat effects.
Evidence under `/tmp/aven-live-dispatched-chat-*` includes all answers, review findings,
timing and source fingerprints. This is not proof of separate production processes,
deployment of the worker supervisor, native transport, microphone/TTS or protected mail.

The stopped-action case also inspects private settled receipts using the worker role.
It requires the exact original command and result, stable repeated inspection, and
rejection before settlement or under a changed subject, input, digest or generation.
The API role must remain unable to read the private journal. It also checks the
all-or-nothing replacement reader against actual settled receipts and rejects
duplicate or invalid ancestry. Active-message replacement is covered by the separate
background journey below; neither check exercises a native editor.

The server chat transport uses `POST /internal/v1/llm/v1/chat/completions`, under
the existing `LLM_GATEWAY_ACTOR_RUNNER_BEARER_TOKEN`. This is an internal model
transport, not authority to read customer records or execute tools. It accepts at
most two MiB, rejects browser/session/work headers and query parameters, and applies
the same model catalog, capability checks, work-lane limits and timing as native
chat. The caller must consume or cancel its stream; no automatic retry or model
fallback is installed. This endpoint does not itself enable background chat.

The facade exposes `POST /internal/v1/work/exchange` only when the distinct
`WORK_GRANT_EXCHANGE_BEARER_TOKEN` is configured. This credential belongs to the
facade and authorized worker hosts, never the desktop, model context or customer
records. It is separate from the LLM gateway credential. A valid one-turn work
certificate and exact work/turn/run/lease binding are also required. The facade
resolves Intent Service and Actor Runner from the current operator runtime directory
and probes each `POST /internal/v1/work/verify` endpoint using signed, read-only grants
and its configured downstream credential. Redirects and non-204 results fail closed;
each probe has a five-second deadline. No destination, database or identity is taken
from caller routing headers. Probes return no customer content, only a verified
authority deadline. A delegated grant expires no later than the current runner lease,
the parent certificate or sixty seconds. Work admission rejects expiry without the
interactive login clock grace; it cannot revoke an already admitted in-flight request.
The task proof checks this with a short real database lease and an HTTP request both
before and after the delegated grant expires. This transport does
not yet enable an unattended dispatcher, server tool-host completeness or native
turn execution. Generated local deployments do not enable it automatically yet.

Intent Service also provides `POST /internal/v1/work/turn` to those delegated
executors. Its closed commands are `context`, `finish`, `search` and `read`; the signed binding,
not the body, chooses the subject, turn and run. Context needs `intents:read`, and
publication needs both read and write. A completed/cancelled turn cannot reopen
context; a read grant cannot publish. Requests are capped at 512 KiB and context at
two MiB, retaining whole recent contributions and explicit omitted coverage. The
saved-task proof checks denied credentials, mixed login/work headers, caller-selected
turn/database fields, oversized input and read-only publication denial. No secret
or raw upstream error body is returned to the caller.
History search/read use the same owner-scoped indexed storage as the interactive
API. Intent previews return ten exact message excerpts of at most 700 Unicode code
points, with source IDs, feedback and continuation offsets, plus ten bounded activity
summaries. They do not load full tool payloads. Queries are limited to 500 characters,
search pages to fifty records (message pages to twenty), cursors to 2,048 characters,
and message read offsets to 100,000. The saved-task journey checks cross-owner hiding,
closed request schemas, invalid cursors, ended authority and Unicode-safe continuation.
Interactive clients use `GET /api/intents/{id}/preview` through the facade and the
native `intent_preview` command. The same journey checks that interactive and
delegated previews agree and reject cross-owner access; native rendering remains a
separate gate.

`GET /api/intents/{id}/turns` projects up to fifty owned queue entries, newest first,
with an owner/Intent/generation-bound continuation cursor. No prompt, work grant,
dispatch token, journal or raw error is returned. Accepted is an admission state, not
worker liveness. The conversation journey checks queued, independently completed,
accepted and published states through the real facade; database checks also cover
expiry, generation changes, terminal-result preservation, uncertain effects,
archive/deletion, pagination and cross-owner denial. This read-only projection does
not enable native background execution or permission renewal.

The dispatched-conversation journey also starts the real Rust Artifact Store and its
provisioner on disposable ports and installs the artifact component through the normal
customer provisioner. Build `aven-artifact-store` from the current worktree first;
the receipt fingerprints that binary. The shared knowledge Actor reads through fresh
delegated work authorization, not the test seeder's authority. The test seeds only
independently invented text files; their count is checked by real Qwen. Teardown stops
both owned Rust processes before dropping their generated database and roles.
The read adapter rechecks current work authorization on every same-workspace read.
The journey denies writes through that adapter, scope escape, ended authority,
revoked membership and paused execution; missing artifacts retain the Store's
redacted `RESOURCE_UNAVAILABLE` code. A separate host-only publisher obtains fresh
write authority and binds immutable publications to the admitted user. The journey
checks actual saved bytes, changed-material rejection, exact replay and recovery of
the original publication after its acknowledgement is lost. This boundary probe
does not yet expose Studio authoring as a background Chat tool.

The conversation journey additionally holds a real task acknowledgement across
archive/restore and across a user stop request. Both withdraw new work authority;
restoration cannot release an unsettled predecessor. The owner's stop endpoint is
`POST /api/intents/{id}/turns/{turnId}/stop`, with a closed body containing
`commandId` and `expectedControlRevision`. A response is an immutable receipt for
that command, not proof of remote cancellation. Unbound work is cancelled immediately;
bound work appears stopping and keeps FIFO until reconciliation. The journey checks
idempotent retries, denied foreign owners, closed requests, preserved saved actions,
no next model request and no revival of a cancelled request from history. The
supervisor releases the next message only after the executor has ended and its tool
outcome is journaled, recording an immutable stop-settlement receipt. A separately
lost acknowledgement keeps an uncertain-effect warning and the FIFO barrier. These
are server-component checks, not native Stop controls, renewal or settlement proof
for delegated child Skills.

The pre-lease edge is separate: `POST /internal/v1/work/dispatch` at the facade
exchanges the exact accepted certificate and pending outbox claim for a runner-only
admission grant. The Intent probe is `POST /internal/v1/work/dispatch/verify`;
the runner handler is `POST /internal/v1/work/admit`, with no body. Admission is
bounded by the claim deadline, parent certificate and thirty seconds. Its signed
dispatch binding cannot be used as an execution binding. The admission handler is
registered only with the configured background Chat host and its prerequisite.
Generated deployments leave this disabled. The saved-task and dispatcher proofs exercise this actual
HTTP transport, including expired claims, wrong turns and attempted body commands.

`POST /internal/v1/work/turn/lifecycle` in Intent Service is an internal coordination
edge, not another customer API. It requires the Intent service bearer and a signed
Intent placement for the configured `CUSTOMER_RUNTIME_ID` (default `primary`;
set the actual runtime ID in multi-runtime deployments). The physical database
generation and execution switch are checked even for cached pools. Its `state` and
`resume` commands accept only an exact subject/turn/run/input-revision/digest reference.
Requests are limited to two KiB. Unbound work stays waiting. A bound live turn may
return its original certificate on resume; the caller must still acquire its exact
runner lease and exchange current authority before any tool or context request.
Completed work returns only its immutable contribution ID and outcome, even after
the original certificate's expiry. No login, prompt, output rewrite or authority
extension is accepted. Negative live checks cover mismatched references, mixed
credentials, certificate retrieval without a runnable lease and completion after
authority expiry. This endpoint is wired into Intent Service; the opt-in worker
startup composition is described below. Native use remains gated.

`POST /internal/v1/work/turn/status` in Actor Runner is the corresponding read-only
supervision edge. It requires the runner service bearer and a signed Actor-component
placement for its `CUSTOMER_RUNTIME_ID`, plus the exact admitted subject, run, turn,
input revision and digest. It returns only active, waiting or terminal state,
settlement (`pending`, `settled` or `uncertain`) and an uncertainty marker on failed
runs, never the raw error, input or tool output. A security-barrier database view
exposes whether an unresolved tool checkpoint exists; the API role cannot read the
private journal. Requests are
limited to two KiB and cannot carry identity/work headers. The Intent supervisor
checks at most sixteen due runs per customer, with four status calls at a time,
and advances each due time by ten seconds. Run it as the separate `supervise` mode
of `IntentTurnWorker`; the `dispatch` loop must not wait for status lookups. A missing
or unavailable status remains unknown, not failed. Terminal unpublished work and
expired authority block their own FIFO queue without repeating effects. The generic
runner retry API refuses journaled conversations; an owning-Intent renewal and
reconciliation flow is still required before enabling this background composition.
The live dispatched-chat proof includes an actual Qwen task saved before an injected
answer-publication failure, status isolation, terminal/uncertain/cancelled states,
authority expiry, unavailable status and no duplicate task.

The same opt-in control exposes `POST /internal/v1/work/placements`. This endpoint
uses the requesting service's existing runtime/component bearer, **not** the exchange
bearer. The request names only that configured runtime, component, keyset cursor and
a limit of at most sixteen. It cannot choose a database or subject. The read-only
control-directory query excludes suspended, moving, retired or generation-mismatched
placements and returns sixty-second, separately typed signed certificates. Workers
verify their exact issuer/runtime/component before opening a restricted component
pool, which also checks the physical generation and execution switch. Placements
authorize queue discovery and the narrow lifecycle/status lookups only; they are
rejected as customer or work grants. The
dispatched-chat journey obtains its eligible queue IDs through this actual HTTP
discovery client before invoking its in-process dispatch host. The shared
`WorkGrantClient` verifies the returned component permission, runtime and exact
work/run/lease binding before use. Task writes acquire their two independent narrow
permissions concurrently, not as two serial control round-trips; no grant is cached
or substituted with a login if the control check fails.

The two service entrypoints have an opt-in background composition, currently under
qualification. Do not enable it for a customer until the native handoff, renewal UX,
document retrieval and delegated child execution have passed their combined gate.
Intent Service requires all four of `WORK_CONTROL_URL`,
`WORK_GRANT_EXCHANGE_BEARER_TOKEN`, `ACTOR_RUNNER_BASE_URL` and
`ACTOR_RUNNER_SERVICE_BEARER_TOKEN`. Actor Runner requires all five of
`WORK_CONTROL_URL`, `WORK_GRANT_EXCHANGE_BEARER_TOKEN`, `INTENT_SERVICE_BASE_URL`,
`INTENT_SERVICE_BEARER_TOKEN` and `CHAT_MODEL_ID`. Partial configuration fails startup;
omitting the complete set keeps the existing foreground path. Service destinations
are operator-controlled origins, never model input. The existing service credentials
must agree with the facade's runtime directory.

Actor Runner must use its built `build/index.js` entrypoint for background work.
Its build command defines the bundle marker; startup hashes the actual executable
bytes, Bun version, platform, architecture and configured model ID. Source-watch
startup refuses background mode because a mutable source entrypoint cannot pin the
engine for replay. Rebuilding with changed code deliberately prevents replay under
that different engine; it does not authorize retrying an uncertain write.

The production composition can be exercised without a client on an isolated
PostgreSQL server and actual Qwen endpoint:

```sh
bun run --cwd services/actor-runner build
LIVE_LLM_BASE_URL=http://trusted-qwen-host:8000/v1 \
LIVE_LLM_MODEL=actual-qwen-model-id \
TEST_TASK_DATABASE_URL=postgres://proof:password@127.0.0.1:5432/postgres \
bun deploy/e2e/live-background-chat.ts
```

Build the current Rust Artifact Store first, as for the dispatched-conversation
journey above. This journey uses the actual startup worker composition, signed HTTP
service boundaries, restricted component roles and real shared Actors, but its
services are still an isolated in-process fixture. It checks cold queue discovery,
an immutable queued edit ahead of a later follow-up (the original never executes),
independent Intents, FIFO tasks, shutdown/reconstruction, calculation and Studio
authoring. It holds an actual model request after a Task creation commits, admits an
edit, and requires the replacement to update that exact task after settlement rather
than create another one. A queued follow-up must run next. Editing the now-completed
message must preserve that follow-up's change and the original outcome. Set
`EDIT_VARIANT=multilingual` for a held-out French creation/edit, Italian follow-up
and Spanish completed-message edit. No model output or mutation receipt is substituted
by the timing gate. Retain failed receipts
as failures; completion of this journey alone does
not qualify Docker startup, native rendering, document retrieval or mail. Its temporary
database, roles and owned Rust processes are removed on exit; evidence remains under
`/tmp/aven-live-background-chat-*`. Never point it at customer storage.

To test the actual service entrypoints in separate containers, use the isolated
background lane. It is opt-in and does not enable background execution in the
ordinary local stack:

```sh
TEST_DOCUMENT_PROVIDER_BASE_URL=http://trusted-qwen-host:8000/v1 \
TEST_DOCUMENT_PROVIDER_MODEL=exact-qwen-model-id \
TEST_DOCUMENT_PROVIDER_PROFILE=qwen-tools \
sh deploy/e2e/run.sh background
```

The harness builds the service images and native executable, creates fresh signing
and exchange credentials, and provisions a fictional account through checkout and
passkeys. This lane admits work through the bundled shared client and authenticated
native IPC, not the ordinary composer. It verifies the native workspace guard and
closed operation paths, receipt lookup, an exact queued stop and idempotent admission.
It closes the client, authorizes a fresh device session for the same fictional
account, and checks that the queued requests, cancellation and receipts survive.
It stops the disposable Actor Runner, admits idempotent queued requests, and starts
the actual worker process. After observing saved tasks and a pending model request,
it kills that process and requires journal recovery under the original engine,
unchanged completed checkpoints and task receipts, and a FIFO follow-up that changes
only its requested task. A Spanish broad-topic request must clarify without creating
tasks. Both worker services then restart, preserving prior results and completing a
new German calculation. Another native close/reopen must show unchanged terminal
statuses. No model responses, execution clocks or database leases are
replaced. A missed interruption window fails instead of claiming recovery proof.
The native work bridge also reads bounded current-operation metadata from the
public owned-turn route. It rejects a mismatched workspace and caller-built paths,
shows an actual in-flight operation, and preserves terminal timings after reopening;
only the server's observation timestamp changes. This does not yet connect the
ordinary composer to background execution.
The restart check records the old/new network addresses and accepts only health
observations from the current container process. A post-restart native read failure
collects a separate authenticated read and SQL wait-state diagnostic, then permits
bounded read-only probes to establish whether recovery occurs. Any such initial
failure still fails the final gate; diagnostics do not turn a hanging read into a
pass. No admission, edit or other mutation is blindly retried. Native errors retain
their code even when a transport failure has no HTTP status.

The test writes `real-qwen-background-process-evidence.json`, including failed
observations, in the run's printed proof directory. The normal full and native/live
gates remain required for their separate claims. This lane does not qualify the
composer's admission/editing UX, permission renewal, document retrieval, delegated
child execution or mail;
those remain prerequisites before customer enablement. Teardown removes only the
disposable project and its volumes, not its evidence. E2E project overrides must use
the `aven-e2e-` prefix and only lowercase letters, digits and hyphens. Never give an
existing customer stack that prefix or use its database as a test fixture.

Recovery treats a method as safely recomputable only when its trusted manifest
declares both `mode: transform` and `idempotency: pure`. Its new timing is marked
`recomputed`, distinct from a recovery read or an original mutation receipt. A
generic transform or idempotent mutation cannot be replayed on that basis.

The companion contract checks cover complete historical tool/result pairs, omitted
results, secret-field redaction and saved-payload bounds. They are not substitutes
for the model journey; inspect that journey's failed calls and answers even when its
final database assertions pass.

Set `E2E_APP_ORIGIN` to a separately running test frontend to additionally exercise
the actual Tasks list and board through the signed HTTP fixture. It checks creation,
reload, mounted-view reset, a lost committed response with the same-command retry,
status changes and archive/restore at desktop and narrow widths. This browser proof
also renders the real-Qwen tool receipts while the final answer is still being
checked and after bounded transcript persistence. Task cards show affected task
titles, state, group and due date; trials explicitly say that nothing was saved.
Only five tasks appear per card, with a remaining count and a snapshot label, not
a claim about today's complete task list. This browser proof
uses the real service, but not Tauri transport or the facade. The checking-state
rendering replays the measured turn duration, not a newly mounted zero-time turn.
It keeps screenshots
and fingerprints alongside the model receipts. Stop the owned frontend afterward;
do not reuse a customer's interactive session as a fixture.

`check:customer-platform` includes the shared chat engine, Intent contracts and saved-task package.
Generic sandbox/Prolog examples under `app/tests/fixtures/sandbox-tasks` test the
portable view engine; they are not a second productive Tasks implementation.

The focused concurrent-Intent journey uses a completed fictional native workday's
account and environment, never a customer conversation:

```sh
E2E_APP_ORIGIN=http://127.0.0.1:1451 \
E2E_TAURI_APPLICATION=/absolute/path/to/test/aven-os-app \
bun deploy/e2e/live-parallel-intents.ts /absolute/path/to/completed/workday/evidence.json
```

Run a separate frontend with `VITE_AVEN_E2E=true` at that origin and build the test
client with `e2e-voice-proof` and the same Tauri `build.devUrl`. The native IPC origin
must match; navigating an ordinary client to a different test port is insufficient.
When copying a Linux test binary outside its build resources, set `ORT_DYLIB_PATH`
to the prepared `app/src-tauri/resources/onnxruntime/libonnxruntime.so` in that checkout.
Use the isolated native display and fictional-account session described below. The
script checks that the saved session subject matches the supplied synthetic evidence.

The journey sends written messages through the UI and an accepted speech transcript
through the production admission event. Actual Qwen responses prove simultaneous
Intent execution, FIFO follow-ups using the prior answer, context isolation,
narration interruption without cancellation, background unread status, new-Intent
routing of queued messages, per-Intent cancellation, and customer-database reload.
It also keeps a response running with another contribution already queued, then
requires an explicit new-Intent request to start independently before that queue
drains. Separate live-model checks cover multilingual, negated, quoted, hypothetical
and ordinary follow-up routing. Creation must have exactly one recorded receipt.
Messages stay in the input widget and are absent from both conversation history and
the customer database while a destination choice is pending. The native journey checks
confirmation, keeping the original Intent, a searchable alternate destination, and
editing an accepted spoken contribution without losing a newer typed draft. Another
Intent must keep accepting messages while a routing choice remains open, and a double
tap must not duplicate delivery. The alternate-destination test preserves both the
original contribution and the later human choice in the database, and rejects an
answer that treats the cancelled creation request as a missing capability. A reload
and follow-up check that the choice also reaches the next real-model request. Deleting
one test-created destination before assignment must leave the message in the input
widget, including after retry; it must not silently move to another Intent.
Test-created Intents have unique titles so earlier
test runs are not indistinguishable candidates. Duplicate real titles require a choice
rather than a guessed destination; the picker includes last activity and a short ID.
The journey also asks Qwen to count the synthetic document pool: the resulting card
must retain its stated purpose and distinguish file inventory from inspected contents
or extracted values. A file count is not proof of a complete search for a value.
Five live-model action-claim checks distinguish chat-only lists, acknowledgements
and negations from unexecuted external changes, including German input.
Evidence and a native screenshot are saved under `/tmp/aven-live-parallel-intents/`.
It does not test microphone recognition, audible playback, crash recovery of pending
messages, or the complete platform release gate. Inspect model answers and failed
tool attempts as well as the assertions; a passing journey does not erase retries.

Replay only the completed synthetic journey's actual routing decisions and query
receipts for a separate responsive UI check:

```sh
E2E_APP_ORIGIN=http://127.0.0.1:1451 \
node app/tests/input-routing-ui.mjs /absolute/path/to/live-parallel-intents/evidence.json
```

This renders the same components at 1280 and 390 pixels, checks destination controls
and preserved query purpose, and saves screenshots beside the source evidence. It
does not replace the native submission, model, authorization or persistence checks.

The focused knowledge and intake journeys extend the same isolated real-Qwen
runner below. After building the current Store binary:

```sh
LIVE_LLM_BASE_URL='http://trusted-qwen-host:8000/v1' bun deploy/e2e/live-llm-skills.ts --knowledge
LIVE_LLM_BASE_URL='http://trusted-qwen-host:8000/v1' bun deploy/e2e/live-llm-skills.ts --intake
```

The knowledge journey extracts fictional invoices using Qwen, publishes validated
observations with source lineage, and checks schema discovery, unknown-aware
exclusions, exact currency-separated sums, more-than-one-page inventory counts,
frozen snapshots, chat analysis and model-authored productive Skills. It does not
substitute document-model responses or claim that receipt sums establish debt.
Each delivered answer also receives a separate live-model audit against the actual
tool results, including the distinction between validation concerns and no validation.

The intake journey starts a second Store endpoint with the API's actual service
identity against its disposable database. It tests content denial, run/reference/blob
reuse denial, forged executor claims, customer-scope denial, concurrent promotion,
replay and exact source lineage. The real-Qwen nested travel Skills run afterward.
This is service integration proof, not a substitute for passkey/native-client proof.
Neither command resets the user's customer database.

The native workday harness below also accepts `LIVE_WORKDAY_STAGE=intake`. It uses
the same real passkey enrollment and a fresh fictional customer environment, uploads
three files through the production drop boundary, selects two invoices in the inbox,
creates one Intent through the visible controls, reloads to verify both source links,
and follows processing into a live-Qwen knowledge query. The third file remains
quarantined. The question checks each amount, their sum, and unknown payment status.
An incomplete invoice identity is retained as a review case, not a validated payable.
The same journey opens the native library, checks its whole-selection total, applies
a schema-derived currency filter with no matches, and removes it to restore the rows.
This exercises the native upload and UI
admission path, not the operating system's physical drag gesture. A model timeout is
a failed journey, not passing evidence for the full flow.

With the isolated UI preview described below, the rendering/interaction check accepts
the successful service `--intake` and `--knowledge` evidence files from
`live-llm-skills.ts`, not the native intake file:

```sh
AVEN_STUDIO_UI_URL=http://127.0.0.1:1457 bun app/tests/knowledge-inbox-ui.mjs /absolute/path/to/intake/evidence.json /absolute/path/to/knowledge/evidence.json
```

It uses actual Store receipts and Qwen answers for desktop/narrow-screen checks,
inbox selection, readable placement fields and chat availability. It does not submit
an upload or promotion through a substituted native bridge. Screenshots and receipts
are retained under `/tmp/aven-knowledge-inbox-ui/`.

The calculation journey extends the isolated live-Qwen Skill check:

```sh
cargo build --locked --manifest-path services/artifact-store/Cargo.toml -p aven-artifact-store-server
LIVE_LLM_BASE_URL='http://trusted-qwen-host:8000/v1' \
bun deploy/e2e/live-llm-skills.ts --calculations
```

It discovers the actual Qwen model at that trusted endpoint for the production chat
loop; source-extraction Skills use the configured local gateway. No model response
is substituted. It checks a capability question without unsolicited tools, large
decimal multiplication, major currency amounts, token quantities, Qwen-authored
reusable calculations, non-destructive variants, productive replay and English/German
source extraction → exact calculation → Markdown with the complete source chain.
Spanish rental costs and French counted quantities check the same multiplication
contract without telling the model which unit identifiers to select. Each simple
multiplication must complete with one calculation call and the correct result unit.
It also checks a six-file count with labeled inputs, quantity units, an explicit
result purpose, and no invented artifact references for files supplied only by name.
The existing travel-Skill scenarios run afterward. The harness owns a disposable
database and Store process and never resets the working customer database. Receipts
are saved under `/tmp/aven-live-llm-skills/`. This is a focused integration proof,
not a new native/authentication/full-stack release gate.

After a successful calculation journey, check the UI with its actual saved Qwen
receipts (not fabricated replies). Start an isolated preview and pass the printed
evidence path in a second terminal:

```sh
(cd app && AVENOS_DEV_INSTANCE=calculation-proof CHOKIDAR_USEPOLLING=true bunx vite --host 127.0.0.1 --port 1457 --strictPort)
AVEN_STUDIO_UI_URL=http://127.0.0.1:1457 bun app/tests/calculation-ui.mjs /absolute/path/to/evidence.json
```

This browser check renders the real conversation receipt and stored artifact on
desktop and narrow screens, copies the exact equation, edits the generated Skill's
settings and invokes the same Calculation Actor with them. Screenshots and assertions
are written beside the live evidence in `ui/`. It is rendering/interaction proof using
the live run's data, not another model conversation or a native application test.
It additionally renders the six labeled inputs with their source names and the
notice that exact arithmetic does not independently verify source selection.
Calculation cards can expand an explicitly referenced source field through the normal
authorized artifact read; the browser check replays the live run's actual Store
envelope to test that interaction without native authentication.

Tool progress shows milliseconds below one second (including `< 1 ms`), live elapsed
time for active calls, and separately measured total response time including model
generation and verification. New response durations persist in the Intent contribution;
old transcripts without that measurement show no invented total. Tool purposes use
the supplied calculation purpose or a readable description of the operation and
its available arguments, not another model-generated explanation.
An active foreground response shows its current model phase (generation, checklist,
verification or repair) separately from completed tool calls. Its timer includes
possible provider waiting. The local source-recording operation does not claim to be
the model's answer verification.

The isolated native progress probe uses a development binary bound to port 1457,
an app development server there, a private test display, and a valid synthetic
identity session containing `identity` and Playwright `browser` storage state:

```sh
bun deploy/e2e/live-native-chat-progress.ts /absolute/path/to/test/aven-os-app /absolute/path/to/private-session.json
NATIVE_PROOF=sources bun deploy/e2e/live-native-chat-progress.ts /absolute/path/to/test/aven-os-app /absolute/path/to/private-session.json
```

The first mode runs two real-Qwen calculations through normal native IPC and the
authenticated local API, checking visible model phases and advancing timers. The
second uses the production retrieval Actor, browser index and source paging with
invented text: all 23 title matches must be delivered, and three source pages must
be read without another permission request. Both mount the production progress
component in an isolated presentation and retain answers and screenshots under
`/tmp/aven-live-native-progress-*`. They do not prove customer ingestion, persistence,
the whole Intent UI or the full native release gate. The launcher cleans up its
test client; stop the owned development server and display afterward. Never supply
the interactive customer's session or documents.
Useful structured results share chat cards: calculations, knowledge selections,
saved Skill drafts/publications, editable case plans, hypothetical paths, run states,
and inspected document metadata. Case plans with ideal steps are explicitly not
executable Skills; users can refine the plan before those capabilities exist.
For small revisions, `studio_case_revise` accepts `changes` with a required immutable
`predecessorArtifactId`. Only named fields and existing step descriptions change;
evidence and untouched steps remain intact. The adapter reads the authorized
predecessor and uses the same validated publication path as a full proposal.
Structural edits still require a complete case. Neither path confirms a case or
executes its steps, and a revision requires fresh human confirmation.
Only the latest two cards are expanded by default. Other results and raw traces remain
available. Small structured previews are saved alongside bounded trace text so trace
truncation need not erase a card; the existing contribution byte budget still applies.
Call identities, terminal states and timings are reserved before optional details.
The latest 128 calls are retained in chronological order within a 48 KB trace budget.
Recent previews and failure details take priority when that budget fills; a long early
result must not erase the final failure or completion. This is bounded conversation
diagnostics, not the durable execution log.
An accepted run is explicitly not shown as completed, and a publication is not execution.
To check these cards and timing labels using recorded Qwen turns that include
calculation and Skill publication, run against the same isolated preview:

```sh
AVEN_STUDIO_UI_URL=http://127.0.0.1:1457 bun app/tests/tool-results-ui.mjs /absolute/path/to/evidence.json
```

This read-only browser replay also accepts a journey that later failed: it displays
the actual observed states, including failures, and does not certify that journey.
For the crowded-result regression, use a **passed**, synthetic calculation journey:

```sh
AVEN_STUDIO_UI_URL=http://127.0.0.1:1457 bun app/tests/tool-results-layout-ui.mjs /absolute/path/to/evidence.json
```

This replays at least fifteen actual Qwen-produced results in both production chat
surfaces, rather than mounting the cards inside an artificial scrolling container.
It checks wheel scrolling, reachability of every result, equal widths across result
types, keyboard collapse, and an unobstructed input with its draft preserved at
1864, 1280 and 390 pixels. Results stay in the history; the input owns no execution
output. Recorded calls from separate test turns are combined only for layout stress,
not presented as proof of one agent execution. Screenshots and measurements go to
`result-layout/` beside the source evidence. `UI_BROWSER=webkit` selects Playwright
WebKit when installed; neither browser mode substitutes for the native release gate.

After a completed native workday, run
`bun deploy/e2e/verify-live-chat-history.ts /absolute/path/to/workday/evidence.json`
to compare its actual Qwen replies with persisted Intent contributions, including
response duration and each retained tool's status and measured duration. It reads
only the fictional account's positively identified workday environment, using that
output root's private session file. It does not write customer data or generate
replacement replies.

Two focused real-Qwen checks cover composable model work and underspecified Intent
requests. Start the configured local stack first; the gateway catalog must identify
Qwen and support structured output. From the repository root:

```sh
cargo build --locked --manifest-path services/artifact-store/Cargo.toml -p aven-artifact-store-server
bun deploy/e2e/live-llm-skills.ts
bun deploy/e2e/live-intent-scope.ts /absolute/path/to/completed/workday/evidence.json
```

The Skill check uses the local runner's gateway credentials without printing them,
starts its own disposable PostgreSQL container and artifact store, and removes only
those test processes on exit. It exercises nested extraction, destination branches,
Markdown publication, attachment projection and replay without another model call.
It does not prove native rendering or unattended execution. Evidence is retained in
`/tmp/aven-live-llm-skills/`.

To include reusable bank CSV mapping and capability-grounding checks, use:

```sh
LIVE_LLM_BASE_URL='http://trusted-qwen-host:8000/v1' bun deploy/e2e/live-llm-skills.ts --csv-mapping
```

This adds real-Qwen column proposals for German UTF-16, USD and Japanese JPY exports,
productive Studio execution, source/mapping provenance, rejection of changed layouts,
and explicit human confirmation followed by statement validation and transaction
fan-out. Rejected model proposals produce no transactions; the harness allows up to
two correction turns using the actual rejection reason and retains every proposal.
A real chat proposes a case with a missing bank-portal connector as an ideal
node, then revises that saved plan in a follow-up without attempting executable
authoring or losing the gap. A real reviewer checks an unsupported action offer. Files are synthetic and
the customer database is untouched. This is focused service/chat integration proof,
not the full native/authentication release gate or a claim that every bank layout is
supported.

The mapped-artifact review also has a browser interaction check using those actual
Qwen/Store receipts (not fabricated model output). Start an isolated Vite preview as
shown for the calculation UI above, then run:

```sh
AVEN_STUDIO_UI_URL=http://127.0.0.1:1457 bun app/tests/csv-mapping-ui.mjs /absolute/path/to/evidence.json
```

It checks the compact row preview, expandable column mapping and provenance facts,
opt-in confirmation control and overflow on desktop and narrow screens.
Confirmation publication is covered by the live service journey;
this browser rendering check does not simulate native authentication or submit it.

The Intent document view uses the same real CSV receipts, including the original
synthetic file bytes retained by the live journey:

```sh
AVEN_STUDIO_UI_URL=http://127.0.0.1:1457 bun app/tests/intent-document-ui.mjs /absolute/path/to/evidence.json
```

It checks a source-only sidebar, lazy preview reads, type groups, source switching
without cross-document data, and desktop/narrow-screen layout. Native read IPC replays
actual receipts; authentication and upload are not exercised by this browser check.

For selected feature checks without the default travel-Skill scenarios, add
`--focused` with `--csv-mapping`, `--calculations`, or `--knowledge`, for example:

```sh
LIVE_LLM_BASE_URL='http://trusted-qwen-host:8000/v1' bun deploy/e2e/live-llm-skills.ts --csv-mapping --calculations --focused
```

The evidence explicitly records that base travel scenarios were skipped. This is
not a replacement for the complete native/authentication gate.

The Intent check requires the fictional workday session at
`/tmp/aven-live-studio-workday/private-session.json` and a completed evidence file.
It refuses the real development customer environment. It uses the production chat
loop and reviewer with Qwen, creates test Intents in that fictional account, and
checks persisted replies. Broad topics must create once and ask a concise question
without searching; concrete requests must still receive an answer. Test Intents
remain in the fictional account; receipts go to `/tmp/aven-live-intent-scope/`.

Intent creation receipts are retained for answer review. Naming a broad topic does
not authorize research, and a writer-created checklist cannot expand user scope.

The focused feedback journey uses the same fictional-account prerequisites and
native test frontend as the review-queue check below:

```sh
bun deploy/e2e/live-response-feedback.ts /absolute/path/to/completed/workday/evidence.json
```

It generates two real Qwen replies, copies both questions and replies from both chat
surfaces, and compares the actual system clipboard with each message's Markdown
source. On Linux this requires Python 3 with PyGObject and GTK 3 (`python3-gi` and
`gir1.2-gtk-3.0`) and a private X11 display. A denied clipboard write checks the inline
error and keyboard retry without submitting a chat message. It physically votes on one reply, edits a reason in place,
reloads the webview, and moves an unfinished reason between Intent history and the
Studio popup. A fault injection loses one acknowledgment after the real feedback
write commits; Retry must reuse the same command ID. The test reads only its synthetic
Intent's customer-database rows to prove linkage, history and absence of duplicate
events. Evidence is written under `/tmp/aven-live-response-feedback/`. This is a
focused native integration proof, not the complete platform release gate.
The test runs against the compiled native-test frontend as well as the development
server. It creates its fixture through the real native command and selects the
Intent and Studio through visible controls; it does not import source modules into
the webview.

Automatic feedback has a separate synthetic real-Qwen qualification:

The durable admission boundary has its own focused check:

```sh
LIVE_LLM_BASE_URL='http://model-host:8000/v1' \
LIVE_LLM_MODEL='qwen-model-id' \
TEST_TASK_DATABASE_URL='postgres://postgres:test@127.0.0.1:5432/postgres' \
bun deploy/e2e/live-admission-feedback.ts
```

Use a disposable PostgreSQL cluster. The test provisions and removes its own customer
database and restricted roles. A real Qwen answer is followed by French, Spanish,
German and Japanese feedback through signed HTTP admission and ordinary contribution
endpoints. It checks retained response scope after changing Intent, exact replay,
neutral assessment, manual clearing and a reaction saved before its target response.
The latter obtains its reserved reply identity from the owned queue projection and
must wait for that exact reply instead of annotating an older one.
Evidence is retained under `/tmp/aven-admission-feedback-*`. This is not a native UI
or unattended feedback-worker proof.

The broader classifier qualification remains separate:

```sh
LIVE_LLM_BASE_URL='http://model-host:8000/v1' \
INTENT_RETRIEVAL_TEST_DATABASE_URL='postgres://postgres:test@127.0.0.1:5432/postgres' \
bun deploy/e2e/live-input-feedback.ts
```

Use a disposable PostgreSQL cluster: the probe creates and removes its own database.
It tests fifty independently invented utterances twice by default, including eleven
languages, mixed-language speech-style text, positive/negative answer and delivery
evaluations, neutral consent, topic emotions, quoted opinions, task clarification and
manual priority against real Qwen. `FEEDBACK_REPETITIONS` accepts one to five. Model
outputs are not mocked. A failed attempt remains failed evidence. The corresponding
native journey uses a separately authorized synthetic account and its workspace:

`LIVE_LLM_BASE_URL=http://model-host:8000/v1 bun deploy/e2e/live-feedback-context.ts`
adds thirty-six held-out checks across three multi-turn conversations whose answers
are generated by Qwen. It checks older-response references, excluded versus evaluated
responses, destination changes and multilingual delivery/clarification controls.
Evidence is retained under `/tmp/aven-feedback-context-*`; this classifier check does
not substitute for persistence or UI proof.

```sh
bun deploy/e2e/live-native-input-feedback.ts /absolute/path/to/test/aven-os-app \
  /absolute/path/to/synthetic/private-session.json SYNTHETIC_ENVIRONMENT_ID
```

The test binary and frontend use port 1457, separate from the user's client. Compile
that exact native development origin; changing the URL afterward does not grant IPC
access. Set `ORT_DYLIB_PATH` to the bundled `libonnxruntime.so` when launching an
unpackaged Linux binary outside its normal resource directory. The
native journey exercises the normal input, router, saved messages, selected thumbs,
inline reason, manual override and full webview reload. It does not qualify audio
recognition or infer general sentiment accuracy from the bounded written corpus.
Evidence is saved under `/tmp/aven-input-feedback-*` and
`/tmp/aven-native-input-feedback-*`; the native journey retains synthetic conversation
receipts in that test workspace and closes its owned native/browser processes.

The recovered-input regression uses those same synthetic account prerequisites:

```sh
NATIVE_RECOVERY_ORIGIN=http://127.0.0.1:1457 \
bun deploy/e2e/live-native-input-recovery.ts /absolute/path/to/test/aven-os-app \
  /absolute/path/to/synthetic/private-session.json SYNTHETIC_ENVIRONMENT_ID
```

It obtains an actual Qwen destination suggestion, saves six independent synthetic
drafts in the native encrypted store, reloads, and operates the real discard, suggested
destination and edit buttons. It checks the exact admitted contribution, preservation
of the edited text, unrelated pending messages and durable removal after another
reload. It catches reactive UI objects leaking into the transport-neutral controller;
plain-object controller tests alone cannot establish that boundary. Evidence and
screenshots are retained under `/tmp/aven-native-input-recovery-*`. Set the origin to
`http://127.0.0.1:1451` and supply a binary compiled for that origin to qualify a frozen
frontend instead of the development server. The test does not import app source into
the webview or use the interactive customer's profile.

`deploy/e2e/live-feedback-recovery.ts` uses the same model/database variables plus
an isolated Vite frontend at port 1457. `UI_BROWSER=webkit` selects WebKit. It drives
production routing, feedback recovery and vote controls against real Qwen and SQL,
including a forced routing timeout, manual cross-Intent admission, a lost committed
acknowledgement, edits, reload and failed-assessment recovery. Native IPC is bridged
to those real services; this browser test does not replace the native journey.
It removes its synthetic database and closes its browser. Evidence is retained under
`/tmp/aven-feedback-recovery-*`.

With the same variables and isolated frontend, run
`bun deploy/e2e/live-pending-feedback.ts` for reactions to unfinished responses.
It uses real Qwen answers/assessments, production feedback capture and controls, and
a fresh SQL database. It checks first-response targeting, older/current contrast,
neutral follow-ups, a delayed missing-target lookup racing publication, browser
reload, manual edits and invalid pending-request authority. Its fault injection
delays persistence/transport, not model decisions. Evidence and a control screenshot
are retained under `/tmp/aven-pending-feedback-*`; the test removes its database and
browser. This is not the full native/admission journey. The broader repeated
multilingual corpus also includes consent, filler and unfinished speech; classifier
success does not mean speech endpointing is implemented.

`bun deploy/e2e/live-input-navigation.ts` uses the same real-model/database variables
and the isolated port-1457 frontend. It checks that explicit navigation follows
successful persistence, a manual screen change wins a race with admission, and a
new Intent receives a bounded origin excerpt for reference resolution. A subsequent
French continuation is rebuilt from SQL alone. It also reconstructs a pending input
after changing the displayed draft and verifies the real answer uses the original
captured excerpt, with its artifact identity and timezone retained. Its controlled
delay affects input persistence, not routing decisions. Evidence is retained in
`/tmp/aven-input-navigation-*`; the database and browser are removed afterward. This
browser/shared-engine check does not qualify native authentication or voice.

For logical document-page previews, with the same local gateway prerequisites as
the Studio journeys and an isolated port-1457 frontend, run
`bun deploy/e2e/live-llm-skills.ts --focused --page-preview`.
The real decoder/decomposer produces text sections, PDF pages and provenance in a disposable
Rust Artifact Store; Qwen produces a retained document description. At 390 and
1280 px the actual document viewer reads the exact stored source range or renders
the second page of a synthetic three-page PDF, recovers
an evidence-read failure and never requests a nonexistent logical-page blob. Its
native read bridge calls the live Store. Evidence and screenshots are retained in
the printed `aven-live-llm-skills` directory. This is not microphone,
native authorization or a full release proof.

The HTTP transport qualification uses real Qwen and a disposable authenticated HTTP
origin with independently invented inventory data:

```sh
LIVE_LLM_BASE_URL=http://trusted-qwen-host:8000/v1 bun deploy/e2e/live-http-boundary.ts
```

It checks an actual read, explicit stale/offline selection of those same bytes without
another network request, a credentialed origin-changing redirect that must not be
followed, a missing resource, a genuine zero value and an oversized response. The
structured result distinguishes an observed zero from an unavailable value.
The same captured bytes exercise denied request/artifact access, changed host policy,
binding revision, credential rotation, different trial scope and cancellation.
Each blocked selection must release no body, make no network request and produce
no invented quantity in the real model's receipt. Review the prose as well as the
structured assertions; correct fields alone do not qualify language or explanations.
It retains model requests,
observations, failures and source hashes under `/tmp/aven-live-http-boundary-*`, then
closes the origin. The credential is randomly generated in memory and absent from
model input and retained evidence. This does not qualify the future customer Vault,
protected executor, facade admission, Studio or native integration. TLS/address and
stream failure checks are in the package's real-socket test suite.

The companion conversation experiment uses the production chat loop and answer
auditor, with a test read port over actual HTTP observations:

```sh
LIVE_LLM_BASE_URL=http://trusted-qwen-host:8000/v1 bun deploy/e2e/live-http-conversation.ts
```

It checks multilingual counts, observed zero, missing data, an incomplete body,
access denial without a provider request, and credential rotation followed by a new,
independently authorized read. The host requires answer review for this tool. Review
and correction cannot rerun the acquisition. A separate real-model audit also checks
the final answer's language, evidence and presentation; inspect the recorded prose.
`HTTP_CONVERSATION_VARIETY=alternate` selects additional multilingual phrasings.
`HTTP_OPENING_VARIANT=candidate` replaces only the production five-word opening rule
inside this experiment with a brief result-first sentence. It does not change the
running application or weaken review. Evidence retains the variant, timings, calls,
observations and source hashes under `/tmp/aven-live-http-conversation-*`.
The server closes after success or failure. This remains a test host and memory
Vault, not a published HTTP Actor, persistent credential service or Studio proof.

The encrypted-storage companion uses real key generation, a restored JWE record,
the pinned HTTP transport and the production Qwen conversation/review loop:

```sh
LIVE_LLM_BASE_URL=http://trusted-qwen-host:8000/v1 bun deploy/e2e/live-credential-envelope.ts
```

It verifies an authenticated read after JSON serialization, blocks a substituted
customer context and a removed private key before any provider request, then reads
using a record re-sealed under a new key. Each model request is checked for secret
and original ciphertext disclosure. Evidence under `/tmp/aven-live-credential-envelope-*`
includes answers, observations and timings; inspect the prose, not only the assertions.
Keys and randomly generated synthetic credentials stay in memory, and the loopback
origin closes on success or failure. This is a test host, not SQL authorization,
deployed key management, a protected executor process, IMAP or Studio qualification.

Function-only database access has an isolated provisioner integration check:

```sh
PROVISIONER_TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:5432/postgres \
bun run --cwd services/platform-provisioner test
```

Use a disposable PostgreSQL cluster with database/role creation rights. The test
creates a fresh database and uniquely named roles, runs the actual provisioner, and
checks set-only/metadata functions, forbidden table access, overload isolation and
verification of the second runtime role after a grant is removed. Its teardown removes
only those generated objects. Without the URL, the database cases are skipped.

`LIVE_LLM_BASE_URL=http://model-host:8000/v1 bun deploy/e2e/live-routing-priority.ts`
checks routing priority under concurrent real requests with capacities one and three,
including bounded work fairness. Evidence under `/tmp/aven-routing-priority-*` records
actual dispatch order and queue/provider timings. This is API-process admission proof,
not preemption within an external model server or acoustic latency qualification.

Exact historical-message retrieval has a separate real-Qwen/SQL regression:

```sh
LIVE_LLM_BASE_URL='http://model-host:8000/v1' \
INTENT_RETRIEVAL_TEST_DATABASE_URL='postgres://postgres:test@127.0.0.1:5432/postgres' \
bun deploy/e2e/live-history-retrieval.ts
```

This also requires a disposable PostgreSQL cluster and creates/removes its own
database. It seeds independently invented human/assistant messages and interleaved
activity, then asks for first, nth and recent messages in varied languages through
the production retrieval Actor, conversation engine, gateway and Qwen. A newer message
in another synthetic Intent checks that "here" does not silently become a global
selection. Each scenario has a four-minute cancellation ceiling, not a UX latency
target; a timeout remains a failed result. Additional cases check recall from recent
dialogue, complete carried excerpts and accepted destinations without unnecessary
retrieval; a shortened excerpt must still be read in full. Latest-message questions
vary English, German and Spanish wording. The probe requires the exact expected
source text and quotation for missing history (source-identified exact Intent or
message-search excerpts also qualify), records timings, traces and source fingerprints, and saves
failures under `/tmp/aven-live-history-retrieval-*`. `LIVE_HISTORY_CASES` can select
comma-separated scenario names for a focused rerun; that result does not qualify
the excluded cases.
The long-recent-message case puts the requested fact after the prompt's per-message
excerpt limit. It requires an actual read of the original message's relevant passage,
not every unrelated preceding page or a plausible answer from the shortened prefix.
Inspect the final answers as well: a correct quotation accompanied by an unjustified
claim that the requested position is unknowable is not a successful interaction.
This in-process service integration test does not qualify native UI, authentication,
acoustic speech, arbitrary-sized history or latency under load.

Context capacity has two separate real-Qwen probes:

```sh
LIVE_LLM_BASE_URL=http://model-host:8000/v1 bun deploy/e2e/live-context-boundaries.ts
LIVE_LLM_BASE_URL=http://model-host:8000/v1 bun deploy/e2e/live-conversation-capacity.ts
```

Both require the trusted provider's `/models` capacity and `/tokenize` endpoints;
missing tokenizer support fails rather than substituting a character estimate.
The first sizes independently invented alternating-message conversations near 98%
and directly below the actual context limit, with space reserved for output, then
deliberately exceeds it, both with input alone and with an output reservation that
does not fit. Early facts, mid-conversation and multilingual recent
corrections, and draft-versus-sent state have exact assertions. Actual usage must
agree with the tokenizer. Overflow must be reported as `LLM_CONTEXT_LIMIT`, never
silently truncated, and a fresh request must succeed through the same single-permit
gateway. The edge and both overflow cases also exercise the production streaming
request and decoder, including actual token usage and first-text latency; a separate
streaming continuation must succeed. The provider wait is bounded to ten minutes per request; this is a capacity
test, not a speech-latency target. Evidence, including failures, remains under
`/tmp/aven-live-context-boundaries-*`.

The second uses production ChatCore at the 23/24/25-message recent-history boundary
and with a 120-message restored conversation whose unabridged token count exceeds
the provider limit. Requests must remain bounded, preserve a recent correction and
receive actual prompt/completion-token totals through the streamed usage frame.
It then supplies an oversized host context after a real calculator receipt, queues
a smaller request, and requires a visible failure, intact original input and receipt,
no repeated calculation, and successful queued continuation. Evidence remains under
`/tmp/aven-live-conversation-capacity-*`. This observes the persistence callback; it
does not qualify database recovery, the durable worker, acoustic input or native UI.
It also interrupts a real generation and requires the next response to retain only
its own model timings and usage. Successful, overflowing and interrupted requests
are checked through the same bounded transcript serializer used for saved replies.
The two probes measure different boundaries: bounded restoration alone is not proof
that generation works at the provider limit, and provider capacity alone does not
prove conversation continuity.

To grow a conversation through actual model replies rather than restoring a
prepared assistant transcript, also run:

```sh
LIVE_LLM_BASE_URL=http://model-host:8000/v1 bun deploy/e2e/live-growing-conversation.ts
```

This complementary provider-capacity probe makes twenty-eight sequential real-Qwen
exchanges, gradually reaching 98% of the provider window. Independently invented
inventory notes add volume; multilingual corrections change a few tracked planning
facts. Every assistant message is a real completion. After a disk transcript reload
halfway through, the test continues to the context edge, rejects an oversized draft,
and continues with all accepted messages retained and a smaller output reservation.
It checks actual tokenizer/usage agreement, unchanged draft-versus-dispatched state,
and release of the gateway's sole permit after overflow. Evidence, including failures,
stays under `/tmp/aven-live-growing-conversation-*`. This can send several million
input tokens; use an authorized trusted provider. It exercises the production gateway
and decoder, not ChatCore's bounded recent-history selection, SQL or native recovery.

The durable worker path has a separate evolving-conversation check:

```sh
LIVE_LLM_BASE_URL='http://model-host:8000/v1' \
LIVE_LLM_MODEL='qwen-model-id' \
TEST_TASK_DATABASE_URL='postgres://postgres:test@127.0.0.1:5432/postgres' \
bun deploy/e2e/live-long-durable-conversation.ts
```

It provisions and removes a synthetic customer database with restricted roles.
Thirty real-Qwen answers go through signed input admission, SQL dispatch and the
production background conversation engine. The worker is reconstructed halfway
through twenty-six planning exchanges. A final question must retrieve an earlier
correction no longer present in the bounded model context, preserve the current
Intent, and avoid substituting another project's decision or creating unwanted tasks.
The test rejects failed tool calls even when recovered; evidence and failures remain
under `/tmp/aven-long-durable-conversation-*`. Confirmed destinations are supplied
by the test; it does not qualify automatic UI selection, speech, native process
recovery or provider-edge capacity. The preceding capacity tests cover that last boundary.

The Intent Service's PostgreSQL suite also checks ownership, concurrent feedback
edits, clearing, unchanged response text, retained merge provenance and feedback
projection beyond the history-page limit. Set `INTENT_RETRIEVAL_TEST_DATABASE_URL`
to an administrator connection on a disposable PostgreSQL cluster and run
`bun run --cwd services/intent-service test`. The suite creates and removes its own
uniquely named database; never point it at a production cluster.

To exercise conditional Intent-write recovery with the real model, run:

```sh
LIVE_LLM_BASE_URL=http://trusted-qwen-host:8000/v1 \
TEST_TASK_DATABASE_URL=postgres://proof:password@127.0.0.1:5432/postgres \
bun deploy/e2e/live-intent-conflict-recovery.ts
```

The probe provisions its own customer components and signed HTTP services. An actual
new contribution invalidates the observed revision before Qwen requests an archive
or restore. English and Spanish cases require a definite rejection, one refreshed
read, a model-directed corrected command, exactly one successful state change and
unchanged notes. It exercises the shared client rejection adapter using the native
error envelope derived from the real HTTP reply. It is not native UI proof and does
not authorize retries after lost acknowledgements. Evidence, including failures,
remains under `/tmp/aven-live-intent-conflict-*`.

The focused native review-queue regression reuses a completed fictional workday's
account and environment. It imports a fictional flight PDF and asks Qwen five written
questions through the normal native gateway, including current date/time and a
short confirmation that must continue the agreed itinerary. It checks that citations succeed
without failed retries, then exercises a crowded queue using synthetic review cards.
Those cards test layout and physical decisions; no model response is substituted.
It does not confirm real reconciliation proposals or touch the user's workspace.

Use a frontend started with `VITE_AVEN_E2E=true` and a native debug build whose
`devUrl` matches `E2E_APP_ORIGIN` exactly. This focused harness uses Vite's source
module loader for its layout fixtures, so use a development server rather than a
compiled preview. Give the native test an isolated display as described above.

```sh
E2E_APP_ORIGIN='http://127.0.0.1:1451' \
E2E_TAURI_APPLICATION='/absolute/path/to/test/aven-os-app' \
bun deploy/e2e/live-review-queue.ts /absolute/path/to/completed/workday/evidence.json
```

The corresponding quote, attention-filter, clock and context regressions run with
`bun test app/tests/research-quotes.test.ts app/tests/reconciliation-review.test.ts app/tests/current-time.test.ts app/tests/conversation-context.test.ts`.
Run `AVEN_STUDIO_UI_URL='http://127.0.0.1:1451' bun app/tests/review-queue-ui.mjs`
against that frontend for desktop, phone and short-window geometry, visible controls
and draft preservation. Its review cards are synthetic; it does not substitute a chat
response. Browser screenshots are `/tmp/aven-review-expanded-<width>.png` and
`/tmp/aven-review-collapsed-<width>.png`.

Native evidence goes under `/tmp/aven-live-review-queue/`. Optional
`E2E_CAPTURE_SCREENSHOTS=true` also requests WebKit screenshots; the default verifies
native layout geometry without depending on compositor capture support. The saved
fictional browser session must still be valid and belong to the supplied workday.
This focused result is not another complete Studio workday.

`deploy/e2e/live-studio-workday.ts` is the live-model integration scenario under
development. It must complete all assertions before its output is a passing proof.
It uses the running local identity, API, customer database, Actor Runner and Artifact
Store. No chat or document-model response is substituted. A separate live Qwen call
audits the financial answers and generated reports; that evaluator can also err, so
retain and inspect its reasoning with the source evidence.

Use a Linux native debug build configured for the local identity/API and a matching
frontend. Prefer a compiled preview for the longer workday so source edits cannot
reload the client mid-turn. Restart that preview after each frontend rebuild: its
asset index is captured at startup. The harness checks served script assets before
creating test data and rejects a stale preview. The accepted-transcript variant requires the
`e2e-voice-proof` native feature and `VITE_AVEN_E2E=true`; keep that build separate
from the interactive client. Set `E2E_APP_ORIGIN` to its frontend origin. The normal
microphone and speech recognizer are outside this transcript-boundary proof.

From the repository root, with the local stack and native display available:

```sh
LIVE_LLM_BASE_URL='http://trusted-model-host:8000/v1' \
LIVE_LLM_MODEL='exact-qwen-model-id' \
E2E_TAURI_APPLICATION='/absolute/path/to/test/aven-os-app' \
E2E_TAURI_DRIVER='/absolute/path/to/tauri-driver' \
E2E_APP_ORIGIN='http://127.0.0.1:1449' \
bun deploy/e2e/live-studio-workday.ts
```

The harness creates a fictional account and customer environment; it never clears
the user's workspace. The first run enrolls a real virtual passkey through the
identity UI. An enrollment limit is honored using `X-Retry-After`, not disabled.
Subsequent runs reuse that authenticated test browser session while provisioning a
fresh isolated environment. Refreshed cookies are saved after each run; an expired
browser session causes fresh fictional-account enrollment, never a cookie-expiry or
authentication bypass. The session is stored with owner-only permissions at
`/tmp/aven-live-studio-workday/private-session.json`; treat it as a credential and
never commit or publish it. Account-specific `private-session-<subject-id>.json`
copies allow diagnosis of earlier fictional runs and have the same restrictions.
`LIVE_WORKDAY_OUTPUT` overrides the containing directory.
Evidence goes in a separate timestamped subdirectory for each run. Native actions,
content and layout geometry are always checked. Set `E2E_CAPTURE_SCREENSHOTS=true`
to additionally require WebKit screenshots in that directory; some software-rendered
hosts cannot complete compositor snapshots even when native interaction works.
The receipt records whether screenshots were requested. A requested capture that
times out still fails the run; disabling captures does not skip functional assertions.

The scenario covers historical ad hoc analytics, a confirmed manual case, nested
Skill authoring, productive Markdown output, an explicitly enabled growing index,
arrival delivery, pause/resume, image ingestion, a separately published variant,
Markdown patch provenance and reload persistence. It also checks the library-to-Studio
handoff, nested preview, rejected raw-upload producer selection, recovery of an
uncertain admission, and a proposed ideal-node what-if that must not execute.
Reuse and variant creation must preserve the original draft head, publication and
definition, not merely the hash of an already immutable artifact. A separately
requested initial report is not counted as proof of a later automatic arrival. Full-document
ingestion and generated reports use the configured live model.

The invoice fixture has two pages, with a delivery project only on the later page;
the report must include that project without counting the invoice twice. The agent
can inspect an accepted execution with `studio_run_status`, which waits at most 30
seconds and returns exact named output IDs and its activation artifact for inspecting
the original inputs. The native status transport allows 40 seconds so a healthy
long poll is not mistaken for a network failure; ordinary Studio requests retain a
20-second deadline. `runRevision` versions the execution record, not the saved Skill.
Artifact pagination snapshots are frozen
and must not be used to discover results committed after that snapshot.

An import may complete text processing while financial validation requests human
review. The workday accepts that state only when every processing stage succeeded,
assembled text is available, and the retained warning is financial coverage. It does
not treat those records as validated payables or relax the separate live report and
amount checks. Variants must retain an exact origin-Skill edge in publication lineage.

The `LIVE_WORKDAY_STAGE=documents` development shortcut skips financial questions and
must not be reported as a complete workday pass. A successful run records
`completedAt` and `passed: true`; an error, timeout or absent completion remains a failed test.
Each real-model chat turn has a ten-minute test deadline, including the bounded
tool rounds and answer verification. Per-turn elapsed times and failed tool attempts
remain in the evidence; passing is not a claim of interactive-speed authoring.
Native key entry has a separate, length-aware deadline of 30–120 seconds because
WebKit synthesizes individual key events for long Skill settings. A timed-out key
entry is never retried automatically; it may already have entered a partial value.

After a complete workday, exercise the exact Qwen-authored payables variant with
the three retained source texts and only its adjustable title:

```sh
LIVE_LLM_BASE_URL='http://trusted-model-host:8000/v1' \
LIVE_LLM_MODEL='exact-qwen-model-id' \
bun deploy/e2e/live-studio-variant.ts /absolute/path/to/completed/workday/evidence.json
```

It uses the retained fictional sign-in and the local stack's live model. It checks
the exact published variant, saved output, source quotation ranges and activation
lineage, without changing drafts or connections. It persists the admission identity
before sending, so an uncertain retry cannot create a second run. The sibling
`.variant-run.json` contains the actual report and a separate live-model review of
its cross-source comparison, amounts and qualified payment claims. Retain and inspect
that review too: structural and quotation checks alone do not prove every
interpretation in its prose, and a model evaluator is not a correctness guarantee.

With `E2E_NATIVE_VARIANT=true` and the matching `E2E_APP_ORIGIN`, the same check
opens an isolated native client, signs into that fictional environment and sends
Studio commands through the real desktop transport. It writes a separate
`.native-variant-run.json`, including status-call durations. This exercises the native
long-poll timeout with a real model-backed run; only a recorded wait longer than
20 seconds proves the previously failing timeout boundary was crossed.

After fixing an observed report quotation/coverage failure, the focused recovery
scenario retries that actual failed activation in its fictional customer environment:

```sh
bun deploy/e2e/live-studio-report-recovery.ts /absolute/path/to/failed/workday/evidence.json
```

It uses the retained private test sign-in and the running local stack's real model.
It requires a previously failed two-source index, checks its resulting Markdown and
source evidence, and verifies that retry and connection replay create no duplicate
run or connection. Its sibling `.report-recovery.json` is a focused recovery proof,
not a replacement for completing the native workday. `--verify` rechecks that saved
recovery against actual Store bytes without executing the report again. Each retained
UTF-8 range must reproduce a quotation in the saved Markdown.

`--connection` instead concurrently replays the exact successful connection command
authored by Qwen in that evidence. It checks stable connection/artifact identity,
preserves a later pause, and requires unchanged run and connection counts. It does
not execute the report again or substitute a model response. The sibling
`.connection-replay.json` is a focused retry check, not a full-workday result.

For the observed multipage answer-correction regression, pass `--repair-scope` to
`deploy/e2e/live-studio-review.ts` with its failed evidence path and the live model
variables. It uses the original prompt, source reads and actual review feedback,
requires the corrected answer to retain the second-page allocation, runs three live
reviews, and rejects an added false execution claim. The report is saved beside the
evidence as `.scope-repair.json` and `.review.json`; no tool action is replayed.

To isolate answer-review failures without repeating already committed actions, replay
the saved fictional workday evidence through the live model:

```sh
LIVE_LLM_BASE_URL='http://trusted-model-host:8000/v1' \
LIVE_LLM_MODEL='exact-qwen-model-id' \
bun deploy/e2e/live-studio-review.ts /absolute/path/to/workday/evidence.json
```

This requires an actual successful publication in evidence marked `synthetic`.
It generates a fresh answer from the observed tool results, checks the action-only
review contract and bounded answer repair, and requires rejection of an added false
claim of execution and automation. It writes a sibling `.review.json` result. No
Actor is invoked during replay; it is a verifier regression, not a substitute for
productive native execution or the full workday.

`--receipt` replays the enable-connection turn; `--resume` replays its later catch-up.
Both generate a fresh operational receipt from actual tool observations, run three
live reviews, and require rejection of an added claim that originals were deleted
and payments settled. No actions are repeated. These modes check concise reporting
and the retained run-to-output link; inspect the saved prose as well as the verdict.

Pass `--factual` with the failed historical-finance workday evidence to replay its
actual answer and retrieved notes. This requires the reviewer to reject the observed
wrong-language and unsupported current-overdue claims, then accept a repaired answer.
Both modes assess request-wide language, time scope, outcome and presentation before
the exact source-checklist indices. An action-only checklist may be empty; successful
execution and publication are still checked against actual tool receipts.

`--case` replays the latest saved case proposal with its actual evidence and catalog
observations. `--followup` replays the historical-finance follow-up and requires three
passing reviews of the corrected answer: a review must not invent extra requirements
such as unrequested receipt dates. Both retain the false-execution rejection check.
Replay requires an actual captured draft and mirrors the single verifier-only retry
for malformed or interrupted reviews; a missing draft is not a passing test.
`--document` replays the observed invoice answer that repeated a generated summary's
false absence claim despite a printed due date. It must reject that answer before
accepting a source-grounded correction; generated summaries are not source evidence.
`--observed` replays the first rejected finance draft from a captured native turn
through the same isolated correction messages used in production. It requires
initial rejection and an accepted correction within two repairs.
Per-turn workday evidence includes elapsed time and review diagnostics. A replay that
passes does not erase the failed native run from which its evidence came.
`--run` replays the productive document-register turn and reconstructs an omitted
checklist with the live model. It reviews the actual saved run evidence without
executing the Skill again and must reject invented automatic processing.
`--followup-author` generates a fresh historical-finance answer from retained source
pages with the old tool conversation omitted, then requires three passing live reviews.
`--delivered-followup` replays the actual delivered second answer from a failed
date-classification regression. It requires rejection of the incorrect overdue or
period-bucket claims before accepting a freshly generated correction; no actions
are replayed and correct grand totals cannot excuse incorrect incidental prose.
`--coverage` replays the last correctly qualified answer from the historical-case
regression and requires three passing reviews without rewriting it. Checklist topics
are questions to investigate, not claims that must be true: an answer that accurately
states the unresolved historical link must pass. Invented execution must still fail.
`--last` replays the last captured turn, including its latest corrected draft and
successful source checklist. To exercise the authenticated local API instead of the
provider directly, set `LIVE_USE_LOCAL_FACADE=1`,
`LIVE_LLM_BASE_URL=http://localhost:13000/api/llm/v1` and the configured catalog model
ID. This requires the harness's private test-session file and only accepts that local
API address; it never prints the session or bearer token.

`deploy/e2e/live-model-stream.ts` cuts an actual live-model stream before completion,
requires the production decoder to reject it, then requires a fresh live completion
to finish normally. Run it with the same `LIVE_LLM_BASE_URL` and `LIVE_LLM_MODEL`.
It injects a transport interruption, not a model response; native IPC delivery is
covered by the combined workday, not by this direct transport check.
The production chat additionally gets a transient `LLM_TRANSPORT`/503 after a
real calculation. It must retry only the model request once, preserve the completed
calculation receipt and finish without executing that tool again. Its one-second
backoff can be stopped. Authorization failures, malformed requests and repeated
unavailability remain visible failures; there is no unbounded retry loop.
It also interrupts a real provider response inside the production gateway and checks
that the explicit `LLM_STREAM_INTERRUPTED` event reaches the decoder, releases the
single concurrency permit and allows a fresh completion. Upstream read failures end
with this event rather than a broken HTTP body. Native read-failure diagnostics retain
byte count, elapsed time and time since the last chunk, without the response contents.
An optional workday evidence path replays an actually observed leading reasoning
envelope at every character boundary and requires the visible answer to remain
unchanged. The same command still exercises a fresh live interruption and completion.

`deploy/e2e/live-balance-review.ts` uses the same real-Qwen environment to exercise
the shared author/reviewer distinction between total open, due and overdue balances.
It must reject both a due subtotal mislabeled as total open and an invoice due on
the snapshot date mislabeled overdue, then accept correctly separated buckets.
The source ledger is independently invented. This focused review proof does not
replace the historical analysis in the native workday.

`deploy/e2e/live-review-contract.ts` broadens that qualification to fifteen invented
source scenarios, each with an independently specified correct and incorrect answer.
It tests currencies, payment state, historical versus current balances, source versus
summary, missing links, interval gaps, lineage, incomplete search, absent capabilities,
embedded instructions and multi-source coverage. Run it with `LIVE_LLM_BASE_URL` and
optionally `LIVE_LLM_MODEL`; `REVIEW_REPETITIONS=2` repeats every pair (maximum five).
The additional coverage contrasts separate readable continuation, an exhausted
capability query with an unrelated old index gap, and genuinely incomplete stored
text. `REVIEW_CASE_FILTER` selects scenario names for a focused run; such a run is
not the full qualification.
It uses the production reviewer prompt/options and strict parsing, without retrying
or silently discarding a failing sample. Evidence goes to
`/tmp/aven-live-review-contract-*` with source fingerprints, timings and every attempt.
This calibrates answer review, not document extraction or complete native workflows.

To qualify answer-only repair against a retained synthetic failed dispatched-chat
journey, run:

```sh
LIVE_LLM_BASE_URL=http://trusted-qwen-host:8000/v1 \
LIVE_LLM_MODEL=actual-qwen-model-id \
bun deploy/e2e/live-action-receipt-review.ts /absolute/path/to/synthetic/evidence.json
```

The input must retain the failed turn's complete worker journal and the actual
review/repair generations. The check rejects the unsupported success claim, supplies
the original impossible-action correction to a fresh tool-less repair, and verifies
that the result truthfully reports partial completion. It never replays actions or
uses customer history. An accepted partial receipt is not proof that the original
task was completed. Separate evidence is saved under `/tmp/aven-live-action-receipt-*`.

`deploy/e2e/live-task-review.ts /absolute/path/to/evidence.json` uses the actual
receipts of a passed, synthetic `live-durable-tasks.ts` journey to check eight
pre-labelled answers about committed work, completion versus archival, language and
trial isolation. It saves separate evidence under `/tmp/aven-live-task-review-*`;
actions are not replayed. Both qualifications accept `REVIEW_VARIANT=candidate-fast`
only for comparison with a non-reasoning, JSON-constrained candidate. That candidate
passed an initial source sweep but accepted a wrong time classification on repetition;
it is not enabled in the engine. Keep failed evidence; an initial pass is not proof
of equivalent quality or a reason to lower the acceptance threshold.

`deploy/e2e/live-receipt-review-options.ts /absolute/path/to/evidence.json` compares
the production reasoned reviewer with that candidate on a passed synthetic
`live-receipt-continuity.ts` journey. It audits fourteen supported/unsupported task
claims under each configuration, alternating their order. The same complete receipt
evidence is used; no action is replayed. Results under
`/tmp/aven-live-receipt-review-options-*` retain accuracy, timings, usage and input
fingerprints. Task-receipt results alone cannot qualify financial/source review or
change production policy.

To check whether long saved plans retain their mandatory conditions during review:

```sh
LIVE_LLM_BASE_URL=http://trusted-qwen-host:8000/v1 \
LIVE_LLM_MODEL=actual-qwen-model-id \
bun deploy/e2e/live-case-review.ts /absolute/path/to/synthetic/evidence.json
```

The input is a retained synthetic dispatched-chat failure containing its original
case proposals, semantic audits and complete worker journal. The first proposal
must have passed and its revision must have failed the stored-plan check. Real Qwen
reviews a supported receipt, the original incorrect success claim and an explicitly
partial receipt twice each. The supported draft avoids an unrelated unsupported
workspace-absence claim in the original answer. No saved state changes or actions are replayed; this is
auditor calibration, not proof of successful case authoring. Results are saved under
`/tmp/aven-live-case-review-*`. The full dispatched journey separately exercises
fresh plans, revisions and acknowledgement-loss recovery, with mandatory-review
and warning-only cases in English, German, French and Spanish. Its checks require
both saved-state correctness and truthful completion text. At most one corrective
successor may follow recovery; every predecessor, source and retained step identity
must stay unchanged. The final audit reads the actual final version, not a stale
first save. Extra versions, forks and repeated publication effects remain failures.

For calibration only, `REVIEW_VARIANT=candidate-fast` uses the non-reasoning
JSON-constrained variant, while `REVIEW_VARIANT=candidate-case` uses shorter case-only
instructions with reasoning. The latter accepts only a case receipt without source
checklist items. Both candidates failed current mandatory-review calibration and
are not production settings. Every scheduled sample records its result, including
parse errors and exhausted generations; the command exits nonzero if any sample
fails. Do not discard failures or report a later pass as the same run.

`deploy/e2e/live-answer-audit.ts /absolute/path/to/workday/evidence.json` checks the
independent workday oracle against a retained qualified answer and two deliberately
incorrect variants. The selected synthetic workday must end with the historical
maturity answer. Qualified missing evidence must pass; invented settlement and an
incorrect total must fail. It is reviewer calibration, not a replacement passing
verdict for the original journey.

`deploy/e2e/live-model-http-idle.ts` uses the same live-model environment variables.
It forwards actual Qwen bytes through a loopback HTTP server and inserts a 12-second
transport gap. The first run must receive model data and then fail under the former
ten-second HTTP idle limit; the second must complete with the model request exempt
from that idle limit. This tests transport timing, not a substituted model answer.
The production facade grants the exemption only after authentication and bounded body
receipt. The configured model deadline includes permit waiting and provider execution;
ordinary requests and incomplete uploads retain their HTTP idle protection.

## CI scheduling and caches

Platform verification runs five independent jobs concurrently: static checks and builds,
unit/infrastructure tests, migration/recovery drills, the native/browser journey, and
host rollout with fresh fleet recovery. The last two jobs consume the same verified
release manifest and run independently; neither waits for the other to finish.
The fleet recovery job allows 60 minutes, including encrypted image archives and
cleanup, to accommodate hosted-runner disk variation. Its synthetic startup fixture
prints failing subprocess diagnostics. On a shared workstation, run native and fleet
proofs sequentially if Docker reports exhausted address pools; leave other projects’
networks intact. It exits as soon as it finishes.
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
