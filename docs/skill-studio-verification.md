# Skill Studio verification

Status: bounded implementation under verification; the complete gate must pass before release.

Studio starts from a concrete case, turns its procedure into an editable Skill,
and keeps the case, exact Skill versions, inputs and outputs linked. This document
states implemented behavior and the boundaries of its tests. The
[experience specification](skill-studio-experience.md) owns the interaction goals;
the [shared runtime specification](skill-studio-shared-runtime.md) owns the wider
completion contract.

## Product behavior

### Schema-first analysis and intake

Chat, reusable Skills and the artifact library now share a bounded semantic read
projection of documents, invoices, statements, transactions and line items. The
Knowledge Actor can describe the complete schema without opening files, return
source-linked examples, or summarize an entire snapshot selection. Missing values
do not satisfy negative filters; sums retain currency boundaries and unknown-amount
counts. These are recorded observations, not inferred ownership or proof of debt.
The library exposes a property filter and selection overview using the same query.
Knowledge receipts retain integer minor units and also expose exact typed major-unit
money using the declared currency's scale. Unknown amounts or unrecognized currency
scales stay unknown; a model must not relabel cents as euros or assume every currency
has two fractional digits. The library and Knowledge Actor share this scale logic.
Structured query and calculation receipts go directly to answer verification; they
are not primary-source quotations. Source checklists remain for questions answered
from retained document or message text, without forcing file reads merely to quote
a computed total.

Exact arithmetic is one shared Calculation Actor, not a second chat-only engine.
Its decimal-string results, explicit units and rounding details are inspectable in
chat and as Skill output artifacts. Long and structured Skill settings occupy a
full-width field instead of a narrow cell; short fields remain compact.
Preview, publication and runtime admission reject model operations when a containing
Skill disables model access. This includes pinned children and their branches;
enabling a parent does not silently enable a restrictive child. Runtime still checks
the effective intersected policy before invoking the Actor.

Unassigned uploads appear in the pinned inbox until explicitly assigned to an
existing or new Intent. A batch can share one Intent without overwriting its earlier
files; reload restores every source and its processing status. The inbox does not
read document contents or invoke a model. Its service-enforced quarantine and
promotion boundary is described in the [system map](customer-database-system-map.md).
Automatic routing, arbitrary relationship inference and query-change triggers are
not implemented by this first slice.

### First real-case authoring slice

The bottom-center input is available in Intents, Studio and the artifact library.
Each Intent owns an independent agent conversation. Submitting text or accepted
speech clears the input immediately. Further messages to that Intent queue in order;
other Intents can run concurrently. Progress, tool results and replies appear in
the owning history, with working and unread indicators in the Intent list.

Before a contribution joins a work queue, a bounded, tool-free model call identifies
explicit requests for a new Intent. This admission lane does not wait for the
currently selected agent or its queued work. Creation uses the existing Intent
Actor, records its actual receipt in the new conversation, and starts a separate
runner. Immediately following contributions follow that destination unless the user
selects a different Intent. Negated, quoted and hypothetical creation requests remain
in the current conversation. Ambiguous input is not treated as permission to create
a new Intent. Admission failure leaves a visible unsent message instead of silently
executing in the wrong context. It can still wait for shared model capacity.

The no-tool action guard treats action-like words as candidates for a bounded
semantic check, not proof that an external change was claimed. Writing a list in
chat, acknowledging a preference, and saying that nothing was created preserve the
original answer. A confirmed claim of an unexecuted external action still receives
the existing single correction opportunity; the check itself cannot invoke tools.

Each submission captures its Intent and bounded screen context. Switching views
does not redirect submitted work or let background completion steal focus. A routing
tool can explicitly move the initiating exchange and its queued follow-ups to a new
Intent. Routing into an already busy Intent is rejected; opening that Intent and
submitting there queues the message instead. Screen context and recalled material
remain untrusted evidence, not authorization to execute.

Barge-in and the voice button silence narration without cancelling agents. The
history's Stop control cancels only that Intent's current response; queued messages
remain eligible to run. Stopping cannot undo a tool action already committed.
Merging or deleting busy Intents is rejected. Customer-environment switching is
blocked while any conversation is working or saving.

This is client-owned concurrency, not a durable server agent scheduler. Settled
exchanges are saved independently per Intent in the customer database. Queued and
unfinished exchanges are held in memory: closing or reloading the client does not
resume them. Gateway capacity and shared Actor mailboxes still bound concurrency.

The Intent activity view uses its existing history and inline composer; the chat
button reveals that view on narrow screens too. A popup is used only where the
current view has no conversation history, including Studio, the library and an
Intent's board or artifact preview. Returning to activity removes the popup while
preserving the draft and conversation. Clicks, typing and speech use the same rule.
The native rail opens a searchable workspace picker rather than compressing every
customer environment into a vertical row of indistinguishable initials. Selection
still uses the existing ownership/readiness and in-flight-write guards.

Background reconciliation uses a collapsed workspace review queue, not a stack of
confirmations on every document. One comparison opens at a time; its body scrolls
without hiding the decision buttons. Later closes it without deciding. Starting
chat collapses it, and the draft survives reopening it. The processing selector is
included in the narrow-screen dock's reserved height rather than covering a review.

Each model request receives device date/time in UTC and the local IANA timezone.
The author, factual checklist, independent verifier and answer repair share bounded,
role-labeled recent conversation context (up to 12 messages and 16,000 characters).
A short confirmation can refer to the previous offer without turning into a new PDF
question. User-confirmed preferences remain user inputs; earlier assistant claims
are not promoted to factual evidence. Historical dates stay historical, and a chat
itinerary is not itself authorization to create stored tasks or calendar entries.

Research can select a supplied passage reference instead of retyping extracted text.
The checklist stores the exact source passage, and the independent review still
checks its interpretation. Literal quotations remain available for smaller excerpts;
formatting-only whitespace differences resolve to the original source bytes. Short
codes are valid, but changed words, punctuation, source identities and cross-page
stitching are rejected.

Both history surfaces show live tool-call status with expandable inputs and results.
Saved assistant replies also have up/down controls and an optional inline reason.
Clicking the selected vote clears it; changing a reason creates a new feedback
revision without changing the answer. Unsaved reason text follows the response
between Intent history and the popup. Saving failures remain visible with retry and
reload controls. Feedback stays in the customer database and is not a new agent turn.
The Intent sidebar lists original documents and user-facing results, not processing
pages or extracted facts. Opening a source exposes only that source's derived
artifacts, grouped by type with bounded useful previews loaded on demand. Refresh
retries failed preview reads in open groups. Artifact preview selection compares exact IDs, so
two pages or extracted-text records with the same title remain independently usable.
File status distinguishes a completed result needing review from a pending run or
a processing failure; the detailed processing evidence remains available.
Completed, failed and interrupted calls remain on the in-memory reply, including
when no final answer was produced. The compact summary expands into a bounded,
scrollable trace; common credential fields are redacted in the display. This is
bounded diagnostic history persisted with the conversation, not a replacement for
durable execution provenance. Assistant Markdown is rendered without executable
HTML, remote images or active URLs. Opening a workspace does not enable the microphone.
The native stream ends with an ordered channel marker, not merely completion of
the separate command promise. Malformed or truncated model frames cannot execute
partial calls. One unfinished model round may be retried with completed tool results
retained; it does not replay those actions. Both conversation surfaces show the retry.
Native transport-read failures use the same bounded recovery path. A stalled model
round cancels its stream before cleanup; Stop does not wait for the remote response.
Service-error envelopes are presented as their readable message in chat and Studio,
while codes, retryability and transport metrics remain diagnostics. Authenticated,
fully received model requests use the gateway deadline rather than the HTTP server's
short idle timer; a quiet reasoning interval cannot by itself truncate the response.
Leading provider reasoning envelopes are withheld across stream fragments; ordinary
answer text and quoted markup after the answer begins remain unchanged.

The agent searches older Intents, exact messages and indexed documents through
`workspace_search` and `workspace_read`. Studio does not own a second retrieval
index. Document recall combines all retained assembly chunks within a 1 MiB bound,
records chunk offsets and reports partial extraction as incomplete. This does not
establish complete recall of an arbitrarily large workspace.
Reads use the document runtime's assembled output references, not the retired
server-owned processing-status route. A document whose runtime has not been
restored is explicitly unavailable for text recall. Startup restores source links
before resuming the loaded page of document Intents; older, unhydrated documents
still need their processing view restored before their text can be read.

Cases are immutable `studio.case@1` artifacts containing evidence, interpretation,
steps and uncertainties. Corrections retain their predecessor and reset confirmation.
The person confirms an exact revision; the agent has no confirmation tool.
An agent proposal opens populated in the case panel when there are no unsaved human
edits. A newer selection or edits made while it loads prevent automatic replacement;
the explicit review action remains available. Opening the proposal is not confirmation.
Confirmation creates a new immutable artifact. Screen context carries its status
and exact ID; authoring rejects a proposal ID where a confirmed case is required.
An existing draft can explicitly link the confirmed revision without losing its edits.
The server checks that it descends from the draft's previous case; unrelated cases
cannot replace its origin. Published drafts retain their original case association.
Artifact evidence is resolved in scope and retained as causal inputs/references.
Message quotes are attributed snapshots, not a durable verification certificate or
proof that an Actor executed the historical procedure.
The agent receives the complete closed case schema, including every required field
of ideal steps. Invalid definitions return authoring errors, not a service-outage
message. Exact derived text and structured artifact IDs are readable through the
same workspace evidence tools; their producer's interpretation is not promoted to
independent source evidence.
Several derived artifacts do not establish several original documents or repeated
historical executions. Answer review retains inspected producer/input identities
and keeps present processing evidence separate from attributed recollection.
The review also receives the saved case payload, not just its publication receipt.
Catalog observations retain compact port contracts and availability separately from
the full authoring schemas, so a broad catalog read does not evict the first installed
operations before a case is assessed.
Exact document reads omit generated classification summaries. Review receives the
stored source text and its representation coverage, not an earlier model's summary
as corroborating evidence. Financial-review warnings do not by themselves make
successfully assembled text incomplete; this does not certify visual readability.

An ideal step names missing behavior, expected outputs and acceptance criteria.
Structural what-if runs nothing and saves no result artifacts. It is not simulated
execution with synthetic data. A case with ideal steps cannot become an executable
Skill until those steps are replaced and the case is confirmed again.

Building a confirmed case creates or resumes its revision-checked draft. Refinements
retain the original case reference. They do not claim that newly added steps happened
in the historical case. A revised case has its own derived draft.

Agent authoring uses `studio_author` with a saved draft ID, its current revision and
a typed action. The agent does not reconstruct whole program definitions between
calls. The adapter uses the same authorized catalog, shared composer, semantic edits
and server-side compare-and-swap save as the visual client. A batch of typed edits
validates its final graph and saves atomically, allowing a step and its wires to be
changed together. A conflict requires rereading the shared draft; a rejected edit
does not advance its revision. Known operations can be composed in one bounded batch.
Batch failures identify the failed edit and retain the original draft. Removing an
absent input reports the remaining inputs and explains that composition may already
have removed it; it does not silently accept a stale edit.
Model context retains the newest full draft snapshot and compact receipts for
superseded edits. The persisted conversation and execution provenance are not rewritten.
Answer review retains bounded action arguments, small result receipts, artifact
metadata and publication revisions. Studio state is retained as scoped, explicitly
partial snapshots of drafts, connections and runs; those snapshots are not global
inventory or permanent assertions. Run observations retain bounded output identities,
activation references and timestamps, so review does not lose the link between a
successful run and its report. Operational replies describe changes and actual results
without treating input documents as requests for a full content recap.
This lets the agent distinguish an enabled
connection from a completed run without treating its own earlier prose as proof.
Publication and execution remain separate operations. Model answer review treats a
case proposal, saved draft, published Skill and completed run as different outcomes;
document quotations cannot establish that an action was executed.
`studio_run_status` reads one owned Studio run and can wait up to 30 seconds for its
completion. It returns named output IDs, progress and failure details without
searching a frozen artifact snapshot or exposing the run's authentication context.
Unconfirmed manual run and connection commands remain locally scoped to the customer
and account across navigation and restart. They are cleared only after acknowledgment
or rejection before admission. Checking repeats the frozen command and identity;
it does not infer permission for a different execution.
Known input and connection rejections return a distinct admission-rejected code,
so the UI can release the pending command and let the user correct it. Unknown
outcomes, expired authentication and identity conflicts keep their frozen command
until resolved. Signing in again must not turn an uncertain retry into a new run.
Activity shows waiting arrivals beside their connection and surfaces admission
errors there, even when no run has yet been created. Growing collections keep later
snapshots waiting until earlier runs succeed; a failed run does not silently drop
its arrival from the next index.
Connection control receipts explain the admission boundary: pause retains the cursor
but does not cancel admitted work; resume considers matching arrivals since that
cursor during authenticated synchronization. First activation starts at the current
arrival boundary, without implicit historical backfill. None of these receipts claims
that a resulting run has completed.
Tool-only authoring turns are reviewed too, using bounded snapshots of inspected
programs, including their public settings and step bindings. Structural preview
results retain their distinct meaning: a passing preview
checks the definition, not a productive execution. Loop failure modes are retained
as declared contracts, not evidence that a particular run succeeded. Empty factual checklists
remain empty during action review; observed outcomes are assessed separately, not
assigned invented source-check indices. A flow that introduces unrequested manual preparation does not fulfill
a request for a complete procedure merely because its definition was published.

### Composition and execution

- Every permitted Actor remains discoverable in a categorized operation tree.
  Complete trusted installations, not manifests alone, determine authorability.
  Catalog search prefers exact phrases and falls back to ranked words, so a request
  such as “extract text PDF” can find operations whose descriptions use a different
  word order. Search results do not imply an executable route without the required
  inputs and permissions.
  Installed server operations include email brief creation, 19 document Actors
  (21 methods), Markdown write/patch and source reporting.
- The document adapter calls the existing decoder and ingest handlers. It requires
  exact source lineage, matching page/text/layout inputs and candidate/validation
  relationships; it does not guess a convenient sibling artifact.
- Named artifact ports auto-connect by exact schema/type/cardinality. Required
  inputs and bounded settings become controls. Pickers distinguish duplicate names
  by sender, date and short reference; nested settings use expandable rows.
  Saved selections resolve by exact artifact ID even when absent from the recent
  sidebar or first picker page. Unavailable selections remain visible as errors,
  rather than silently becoming empty inputs.
  Publication rejects public settings that do not bind to any operation or child,
  so the form cannot silently ask for an ineffective title or other setting.
  Reuse and advanced planning controls remain collapsed initially.
- While outputs still follow the last composed step, adding a step advances the
  public outputs to that step. Explicitly customized outputs are preserved. Authors
  can expose a step output by name without copying its type descriptor.
- Collection composition maps a pinned child Skill over a compatible many-valued
  port, retaining item lineage and sealed result collections. The current authoring
  helper requires a child without public parameters; bind its settings first.
  Replacing a single-item step with a collection child preserves its step identity
  and downstream connections, removes only its orphaned item input, and validates
  the final graph. Incompatible downstream cardinality remains an authoring error.
  Each flow step can reveal its named connections and settings. Reusable children
  open inline as pinned, read-only subflows; decisions show separate branches. The
  agent receives the inspected step as part of screen context.
- Exact nested Skill artifacts pin their interface and revision. Updating a reusable
  child does not change published parents. A parent variant explicitly references
  the new child and retains its predecessor.
- The shared interpreter supports invocation, exact children, serial fail-fast
  `forEach`, presence checks and scalar observation branches. Observation conditions
  name a JSON pointer and explicit scalar `equals` value; they do not execute code.
  Parent budgets constrain all descendants and model permissions are intersected.
- Output artifacts and sealed port-membership records commit atomically. The runner
  reads ordered structural references through the Store's scoped references resource;
  artifact envelopes do not contain those edges. Empty collections remain explicit.
  Replay uses stable invocation publication IDs and does not repeat a committed call.
- Markdown writing creates a text/markdown file. Patching requires each search to
  match exactly once, applies edits atomically and creates a new artifact linked to
  the original. Ambiguous/missing matches fail without a replacement output.
- Source reporting uses a live model to describe one to 32 extracted text artifacts.
  Every source must appear exactly once, with nonempty quotations found verbatim in
  that source. The model selects numbered source passages; the renderer inserts
  their original text rather than asking the model to retype quotations.
  Up to eight separate cross-source findings carry exact quotations from their
  supporting sources. They can flag matching references and contradictions; they
  are narrative findings, not a structured ledger or a settlement decision. The
  renderer supplies artifact identities rather than asking the model to reproduce them.
  Invalid
  coverage or passage selections get one bounded correction attempt, then fail
  without publishing a report. UTF-8 evidence ranges, causal inputs and model
  receipts for all completed attempts are retained.
  This checks coverage and quotation identity, not semantic entailment of every
  summary sentence. Incomplete sources remain labeled. Assembly publication metadata
  identifies text parts from one document; each report entry carries its coverage,
  and multiple parts must not be counted as independent invoices. Extraction
  completeness does not by itself establish full original-document coverage.
  Per-source and total byte
  limits reject oversized input rather than silently truncating it.
- Draft CAS, publish, inspect, semantic editing and execution are shared by UI and
  agent tools. Artifact-library previews render definitions without invoking them.
  The library has a Skills tab; previews offer opening, reuse and run preparation in
  Studio. Cards include a timestamp and short artifact reference to distinguish
  identically named immutable revisions.
  Preview schema parsing constructs plain validated values rather than cloning
  reactive UI objects. Text and numeric settings remain readable in the library,
  just as they are in server-side execution.
  Copying a published Skill records its exact artifact as the draft’s immutable
  origin. Publication carries an immutable `origin` causal input in addition to the
  case, children and any previous publication of that draft. UI edits of a saved
  Skill and agent-created variants use the same server-validated origin boundary.
  Activity exposes all named run outputs in a collapsed section, rather than hiding
  outputs after the first artifact in a multi-result flow.
- Future-artifact connections pin an exact Skill and retain causal sources. Dispatch
  occurs during freshly authorized client/agent synchronization. The native workspace
  checks every seven seconds across Intents, Studio, the library and settings; closing
  Studio does not stop delivery. A single in-flight pass bounds concurrent polling,
  and environment switches discard stale projections. Failed checks surface a retry
  control without interrupting chat. Connections with retained errors expose a direct
  route to Activity across workspace screens. This is not unattended execution after the client
  closes. Cycle checks include
  internal and control artifacts, not just public outputs. Companion inputs use the
  same single, optional and collection bindings as manual runs, with each member
  retained in provenance. Connections explicitly choose one arrival or a growing
  collection. Growing collections freeze the selected initial items and every
  subsequent matching arrival into an ordered input snapshot for each run. Later
  snapshots wait for earlier runs to succeed. A failed, cancelled or waiting-for-input
  run keeps its connection marked as needing attention, even after it leaves the
  recent-runs list; the help action includes that exact run ID. Limits stop admission without advancing
  past omitted arrivals. Backlog allocation is serialized per subject across connections,
  so concurrent clients cannot each consume the same remaining capacity.
  Connection creation performs its database work on the same connection that owns
  the subject lock; simultaneous retries do not need a second pool slot to finish.
  Connection changes wait without holding a pool slot. Queue allocation and run
  admission try the same lock and defer a busy cursor without advancing it. Pause
  uses that lock too, so it cannot deadlock admission or rewind a concurrently
  advanced cursor. An unlock failure discards the connection rather than returning
  a possibly locked session to the pool.
  An optional exact procedure-key filter distinguishes completed
  document assemblies from intermediate page extractions. The visual “same processing
  step” choice uses `procedureVersion: "*"` across device, server and Skill execution;
  agent tools can also pin an exact implementation version when explicitly requested.
  The input artifact type and version still match exactly. Original uploads without
  a producing run do not match that filter and do not block the publication cursor.
  Each result is immutable;
  there is no mutable file silently replaced in place.

`invocationStatus: not-evaluated` in an unbound discovery catalog is not a server-health failure.
The caller must supply inputs and obtain fresh invocation authorization.

### Model-generated documents

The installed LLM operation accepts bounded extracted text, text files, and earlier
model results. It emits `ai.completion` with a model receipt and input lineage.
Source-only extraction and explicitly requested model knowledge are separate modes;
neither claims live web research. A bounded response schema can produce fields for
conditional branches. An `input-field` parameter binding reads only one explicitly
bound artifact payload, such as `/text` for Markdown writing.
Structured output is validated before publication. A contract failure names the
field and its expected bound without echoing document contents; it is reported as
invalid model output, not an invalid user form. It creates no completion artifact.

Markdown creation alone does not attach the result to an Intent. The separate
Intent-documents operation resolves the original upload declaration and records an
immutable `intent.attachment` referencing the original and generated document through
producer inputs. The client restores these links on load and after completed Studio
runs without replacing the conversation. This operation currently supports uploaded
file Intents, not arbitrary chat-only Intents. Generated text is marked as generated
when read back; it is not independent evidence for its own claims.

The private native model transport advertises no composable methods. The installed
LLM operation owns the artifact contract and runs through the same admission,
execution, policy and publication path as other server Actors.

## Fail-closed boundaries

- Solver `achieve`, decision-producing human `review`, and partial-result collection execution
  are not implemented. Preview reports the unavailable feature and publication is
  blocked. A low-level financial Actor does not replace a human payment approval.
- Empty-output review barriers use the shared SQL runner's exact review requests and
  verified interactive decisions. An isolated real-Qwen journey covers two sequential
  barriers, a runner restart, denial without downstream execution, and approval followed
  by one model step. It does not qualify the new native review card or external
  credential-use policy. Only successful gates enter the run's decision evidence.
- Client-only/event-driven Actors without an installed runtime adapter remain
  inspectable but cannot be represented as executable server operations.
- Unattended IMAP/HTTP supervision, credential leases, related-artifact joins and
  cross-device execution remain separate milestones.
- What-if is structural inspection. There is no general temporary execution store;
  normal productive runs retain artifacts and provenance.
- Definitions do not confer authority for external effects. Current authorization,
  cancellation, exact types and declared budgets are checked during execution.
- The Store type changes target fresh WIP databases, with no compatibility reader or
  migration layer. Verification uses disposable data, not an automatic customer reset.

## Executable evidence

| Proof | Coverage |
| --- | --- |
| `libs/aven-actors/tests/studio-v2.test.ts` | Closed grammar, named ports, typed branches, child interfaces |
| `libs/aven-actors/tests/studio-program.test.ts` | Ordered/empty loops, shared budgets, policy intersection, cancellation, wrong result types and scalar conditions |
| Shared composer/edit tests and `app/tests/studio-actor.test.ts` | Agent analysis, creation, auto-wiring and semantic modification through the actual Studio Actor |
| Case, recall and stored-source tests | Immutable confirmation, exact evidence, paging, full assembly text and incomplete-source reporting |
| `services/actor-runner/tests/studio-document-runtime.test.ts` | Existing document handlers, real PDF decoding, nested invoice review and immutable Markdown patching with a wire Store fixture |
| `services/actor-runner/tests/studio.persistence.e2e.test.ts` | Real PostgreSQL/Rust Store: case-derived nested execution, delivery/replay/restart, child revision variants, Markdown lineage and draft isolation |
| `services/actor-runner/tests/artifact-store-port.persistence.e2e.test.ts` | Real scoped reference reads, ordered membership, empty/missing distinctions and scope denial |
| Runtime safety and validation tests | Cancellation, execution-time authorization, exact types, transitive children and fail-closed controls |
| `app/tests/studio-ui.mjs` | Real Svelte controls with simulated native IPC: categorized discovery, responsive layout, compose/publish/run, trace, connections, reuse and case what-if |
| `app/tests/conversation-surface-ui.mjs` | Desktop/mobile native history versus popup routing, speech drafts, and live/failed tool-call details with display redaction |
| `app/tests/review-queue-ui.mjs` | Collapsed background reviews, one scrollable comparison, visible decisions, pagination, Later, preserved chat drafts and responsive dock spacing |
| `deploy/e2e/live-review-queue.ts` | Native client and real Qwen: PDF quotations, retained-evidence follow-up, current date/time, short-confirmation continuity and review-queue interaction |
| `app/tests/document-restoration-ui.mjs` | Delayed source discovery before runtime restoration; the processing watcher must not call the retired facade status route |
| `app/tests/tool-progress.test.ts` | Live call lifecycle, failure retention, cancellation between calls, session isolation, and explicit budget rejection |
| `app/tests/chat-failure-recovery.test.ts`, `turn-payload.test.ts`, and `conversation-surface-ui.mjs` | Malformed-call recovery, bounded verifier retry without duplicated writes, failed-turn follow-up context, bounded persisted diagnostics, and no stale thinking bubble in desktop/mobile chat |
| `app/tests/artifact-skill-preview.mjs` | Artifact-library preview and exact-ID handoff |
| `deploy/e2e/studio-agent-journey.ts` | Native signed-in UI and real customer services: old manual Intent → written/spoken-transcript request → exact evidence → physical confirmation → agent build/refinement → productive output |
| Store built-in tests | Registered Skill, activation and subscription payload/reference contracts |
| `deploy/e2e/live-studio-workday.ts` | Real Qwen, native client and customer services: historical finance, confirmed manual case, nested authoring, growing Markdown index, arrivals, pause/resume, image invoice, behavioral variant, immutable patch, reload, library preview, admission recovery and ideal-node inspection |
| `deploy/e2e/live-studio-variant.ts` | Productive execution of that exact Qwen-authored variant with its baked-in focus, three retained sources, live model receipt and exact source quotation ranges |
| `deploy/e2e/live-knowledge-scenarios.ts` | Real Qwen extraction and requests over 112 fictional documents: schema discovery, complete-selection totals, mixed currencies, unknown values, negative filters and agent-authored deterministic summary Skill |
| `deploy/e2e/live-calculation-scenarios.ts` | Real Qwen requests, exact decimal/unit checks, agent-authored and refined calculation Skill, and model extraction → calculation → Markdown lineage |
| `deploy/e2e/live-intake-scenarios.ts` | Real customer services and Store: quarantine read/input/reference denial, scoped promotion, concurrent replay and conflicting destination rejection |
| Native workday intake mode and `app/tests/knowledge-inbox-ui.mjs` | Batch admission into one Intent, reload of every source, real-Qwen structured analysis, native library filters and responsive rendering of retained live receipts |
| `app/tests/calculation-ui.mjs` | Real-Qwen calculation receipts in chat, exact clipboard text, persisted artifact preview and editable settings at desktop and narrow widths |

The native scenarios use fictional Nordton supplier checks, Atlas email handovers
and Clara's unresolved permit check. Model decisions are controlled fixtures, while
the chat loop, tools, authorization, confirmation controls, persistence and execution
are production implementations. Spoken input begins at the accepted listener
transcript: it does not qualify microphones or speech recognition. The invoice tests
use controlled document-model responses with the real PDF decoder; they do not
measure live OCR accuracy. A live-model evaluation remains separate from these
deterministic regression proofs.

The live workday is that separate evaluation. Its sources are fictional, but model
answers, tool decisions, document extraction and report generation are real calls
to the configured Qwen server. Written and accepted-transcript requests use the
native application; no model reply is substituted. A successful run must reach
`completedAt` after every scenario, including the visual handoff and recovery checks.
Assertions inspect actual artifacts and lineage as well as live model judgments;
inspect the saved answers for incorrect incidental claims even when totals match.
The behavioral-variant check requires an embedded differing focus, not merely a new
name. A failed or partial run remains diagnostic evidence, not a combined pass.

## Current verification — 2026-09-18

The focused native concurrent-Intent journey passed with live Qwen and independently
invented seed-stall, lamp-workshop and pottery-planner conversations. Two agents ran
at once, a follow-up reused its prior answer, narration interruption preserved both
runners, and stopping one did not cancel the other. A separate new-Intent request
started while the origin response was still running and an earlier follow-up was
still queued. Exactly one creation receipt was retained. Routing, conversation
ownership and settled history survived customer-database reload. Six additional
real-model admission checks covered explicit English/German requests, negation,
hypotheticals, quoted examples and ordinary follow-ups. Five further live-model
checks distinguish chat-only writing, acknowledgements and negations from false
external-action claims. The final run and inspected native screenshot are at
`/tmp/aven-live-parallel-intents/2026-09-18T20-10-27.990Z/`. An earlier run's
screenshot timeout remains recorded as a failed run. This proves the focused
journey, not the complete release gate or crash recovery of pending contributions.

Evidence is accepted only from isolated, independently invented scenarios. Earlier
disposable evidence containing customer-derived examples was removed; it is not
proof for the current tree. The two affected unpublished commits were subsequently
sanitized as well, including their test examples and calculation prompts. Published
history, local recovery objects and provider logs were not erased. The customer's
identity, documents and conversations remain separate and unchanged.

After the history cleanup, 27 focused regression tests and the documentation gate
passed. A fresh isolated real-Qwen calculation journey also passed: arithmetic,
agent-created and reused Skills, a non-destructive variant, labeled totals and two
source-extraction → calculation → Markdown runs with provenance. One authoring call
was rejected and recovered; the receipt retains that failure. Evidence is in
`/tmp/aven-live-llm-skills/2026-09-18T17-27-09.420Z/evidence.json`. The gateway alias
is named `deepseek/deepseek-v4-flash-0731`, but the checked upstream and direct
calculation model both identify `qwen3.8-flash-next`. This focused rerun does not
constitute a new full native workday or release gate.

The current focused runs use `qwen3.8-flash-next`. The local gateway's public
model IDs are role aliases; the harness records and checks the actual upstream
Qwen model rather than mistaking the alias for a different provider.

### Completed focused checks

- Calculation: real agent arithmetic with labeled operands, purpose, units and
  exact results; agent-created and refined Skills; source extraction through
  calculation into Markdown with retained provenance.
- CSV mapping: Qwen maps independently invented files, the deterministic Actor
  validates and imports them after human confirmation, and layout drift is rejected.
  The agent also saves and revises a hypothetical plan without pretending that
  missing portal capabilities are implemented. Small revisions retain evidence,
  step identities and the predecessor link.
- Knowledge: seven Qwen-extracted fictional invoice observations and 105 other
  documents. All six agent turns passed: schema-only discovery, complete 112-item
  counts, separate currency sums, unknown-aware exclusions, the distinction between
  recorded totals and debt, and creation/publication/productive execution of a
  deterministic summary Skill. No automatic connection was requested or created.
- Intake and nested model work: quarantine access/input/reference denial,
  concurrent promotion, 40 failed staging attempts and 40 committed replays,
  catalog readiness, real quota exhaustion and expiry all pass against actual
  services. The same lane then runs four real-Qwen nested travel cases, including
  excluded destinations and a missing travel date that must not be replaced by an
  invoice date. The successful case writes and attaches its source-linked dossier.
- Native inbox: a separate fictional account uploads three files, assigns two to
  one Intent through the visible controls, leaves the third quarantined and restores
  both source links after reload. Qwen answers from structured observations without
  turning unknown payment amounts into zero. The library's selection summaries and
  filters pass. A separate API read-back verifies the saved answer, tool states and
  measured response/tool durations, rather than relying on the in-memory screen.
- Model recovery: an actual provider request is interrupted after a real calculation.
  The production chat retries only that model request, executes the calculation once,
  and finishes with the original receipt. Truncated streams and repeated failures
  retain their explicit failure boundary.
- Financial review: Qwen rejects a due subtotal mislabeled as total open and a
  due-today invoice mislabeled overdue, then accepts correctly separated buckets.
- Browser interaction: actual retained Qwen/Store receipts render in desktop and
  narrow layouts. The checks cover useful result cards, latest-two disclosure,
  millisecond and overall duration, calculation source labels, source-only document
  lists, grouped derived previews and retry after a failed preview read.
- Native feedback: two fresh Qwen replies are copied from both Intent history and
  Studio; the actual X11 clipboard matches the original message Markdown. Voting,
  inline reason editing, reload and an unfinished reason's surface handoff pass.
  A deliberately lost acknowledgement retries the same write identity; the test
  database contains exactly six intended feedback events, with no duplicate write.
  Final evidence: `/tmp/aven-live-response-feedback/2026-09-18T16-45-13.941Z/evidence.json`.

The knowledge audit receives earlier actual tool receipts when an answer reuses
a result from the same conversation; earlier assistant prose is not evidence.
The independent workday reviewer is separately checked to accept an explicitly
qualified missing-evidence statement while rejecting invented settlement and
incorrect totals. These corrections fix false alarms in the test oracle without
overriding or discarding a failed verdict.
The passing knowledge journey used 15 tool calls and the case-plan journey used
nine, all successful. This does not imply that every other model call is error-free:
an earlier travel attempt was safely rejected for invalid structured output. Its
receipt is retained as a failure, and subsequent runs capture the actual model
output as well as the receipt so that such failures remain diagnosable.

### Combined native journey

The full native workday completed successfully: 15 written or accepted-transcript
turns, 113 observed tool calls and nine independent Qwen judgments. It took about
41 minutes, including real extraction, report generation and answer review. This
proves the tested journey, not low-latency replies. The interface now separates
per-tool duration from the complete response time, including model and review time.

The journey starts with historical supplier analysis and due-date follow-ups, finds
a repeated manual procedure in older Intent history, obtains confirmation, and
publishes exact nested child/parent Skills. It then runs a multipage PDF through
the resulting Skill, publishes a growing Markdown index, enables arrivals with
explicit consent, and retains earlier sources when later documents arrive. An
image-only invoice exercises Qwen vision. Pause blocks new admissions; resume
processes the retained backlog. A specialized payables variant preserves its source
Skill, leaves the originals unchanged and embeds its differing instructions.
A separate native follow-up executes that exact published variant and verifies
the report, three-source lineage, quotation ranges and actual model receipt.

The workday also proves an immutable Markdown patch, restored connections and
Skills after reload without duplicate runs, library-to-Studio handoff, readable
settings, nested preview, recovery after a lost admission acknowledgment, and
actionable rejection of invalid inputs. A final proposed portal extension keeps
its missing capabilities explicit as ideal nodes; it is neither published nor run.

One of the 113 tool calls encountered an outdated connection revision. The guard
rejected it; the agent refreshed the state and paused successfully. This is retained
in the evidence, not relabeled as a first-attempt success. A separate API read-back
verified all 15 saved replies, tool outcomes and measured durations. Floating-point
timings are compared within one nanosecond across the JSON/Rust/PostgreSQL boundary.

The combined evidence is the local run
`/tmp/aven-live-studio-workday/2026-09-18T15-56-04.233Z/evidence.json`, with
`persistent-chat-proof.json` and `evidence.json.native-variant-run.json` beside it.
Failed earlier attempts remain diagnostic evidence, not combined passes. They
exposed transient model unavailability and confusion between open and due balances;
the bounded recovery and shared author/reviewer checks above address those failures.

The final application regression run has 338 passing tests and no failures;
Svelte/TypeScript checks report no errors or warnings. Shared Actor tests pass
94 cases, API tests 58, Actor Runner tests 71 and document-ingest tests 143. Runner
and ingest suites retain respectively 15 and 28 explicitly skipped optional lanes;
the real-Qwen journeys above provide separate live evidence, not replacements for
those skipped release configurations. Documentation and deployment-script checks
also pass. The current API, Runner, Store and desktop were refreshed without
resetting customer data or identity. Native follow-ups passed against those services.

### Limits

These are bounded feature proofs, not a claim that every model choice is correct
or that the complete platform release gate passed. Browser receipt replay is not
a new native authentication test. Accepted-transcript commands do not qualify a
physical microphone or speech recognizer. Arrival dispatch currently requires an
authenticated open workspace; unattended workers and arbitrary inferred relations
remain outside this implementation. Reports are source-linked narrative artifacts,
not an authoritative accounting ledger.

The [build and test handbook](operations/build-and-test.md) owns the commands and
full release gate. It also describes how to retain failures, rerun the live lanes
and keep customer diagnosis separate from the synthetic test corpus.
