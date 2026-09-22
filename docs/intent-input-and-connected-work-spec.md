# Responsive conversations and connected work

Status: implementation in progress, grounded in the 19 September 2026
review. The release gates below are not yet satisfied. UX is the primary
acceptance criterion; safety, evidence and durability are part of UX, not exceptions
to it. There is no compatibility requirement.

Current progress: the bounded router and reply classifier, gateway timing, encrypted
native pending-input storage, and atomic Intent admission have been implemented.
The existing chat engine is now a shared package with a thin Svelte adapter. Its
fenced operation journal and saved-task component have passed isolated real-Qwen
proofs, including signed service admission and restricted task/Intent roles. Focused
native task-list, board and activity checks pass; the complete release gate remains
open. The dispatcher and SQL runner now execute the
shared engine in an isolated real-Qwen composition, including recovery after lost
task and answer acknowledgements. Production server dispatch, protected connections and
unattended Sources are not yet enabled. Component tests
and isolated model proofs do not establish completion of the native release gate.

Current delivery priority after the compact progress/scrolling correction is the
testable credential, HTTP and IMAP path in section 7. Two additional UX requirements
remain explicit rather than being treated as completed: edit/delete controls for
queued contributions (including the dispatch race and retained effect receipts in
the replacement contract), and content-first document details. The latter should
lead with the summary, extracted values and supported content; file inspection,
classification traces, page splits and text positions belong in a secondary
processing-details disclosure, not the primary list of recognized information.

The compact progress change has a focused browser checkpoint, not a new customer
bundle: one collapsed current-step/total-time heading; expanded model/tool chronology
with each result at its tool; optional per-step usage/raw details; bottom-following
that parks on upward scrolling and resumes at the bottom. Independently synthetic
recorded Qwen results pass inline/popup layout and wheel/growth/re-engagement checks
at 390, 1280 and 1864 pixels in Chromium and WebKit. Fresh German and English Qwen
calculations pass live compactness, timing, chronological result placement and
retained failure visibility at `/tmp/aven-compact-progress-ChzTF1/evidence.json`.
The focused App checkpoint has 436 passing unit tests and no Svelte/type errors.
This does not establish native release, acoustic behavior, mail integration or
queued-message editing. The running customer executable remains the earlier frozen
checkpoint until a separately verified bundle is installed.

The next credential increment adds separate operator key-file loaders to the
existing encryption package, not a publicly usable connection. Thirty-one actual
cryptography/file checks pass, including unsafe-file rejection and explicit synthetic
key loss/restore. `/tmp/aven-live-credential-envelope-tZ9N2o/evidence.json` qualifies
four real-Qwen conversations (English, German, Italian, Spanish) with encrypted
record reload, reconstructed file-backed keys, cross-environment refusal, removed
key refusal and rewrapping through an authenticated local HTTP test service. The
test checks that secrets and ciphertext never enter model requests or retained
evidence. Temporary private keys are removed afterwards. SQL credential storage,
per-use authorization/claims, isolated executors, external escrow recovery, UI,
IMAP and Studio integration remain unqualified; this test-host boundary must not
be described as a deployed Vault.

## 1. What will change

People should be able to speak, see that Aven understood, and continue working
without managing its internal processes. Work belongs in an Intent; the global
input is where a contribution is understood and assigned, not another execution
window.

The proposed experience is:

1. **Say or type something.** The input immediately shows the captured words. A
   short model call identifies the topic and destination. A normal follow-up goes
   to the selected Intent. A proposed move asks one short question with equivalent
   spoken and clickable choices. An explicit request for a new Intent does not
   wait for another Intent's work.
2. **See where it went, then continue.** Only successful admission adds the message
   to an Intent. The input becomes available immediately. Work, results and errors
   appear in that Intent. Interrupting narration stops audio, not the work.
3. **Get a useful result with evidence.** Answers stay concise. Tables, calculations,
   documents and saved procedures appear as useful cards with a purpose, scope and
   working source links. Previous assistant prose cannot become evidence for itself.
4. **Keep work across interruptions.** A pending input survives reload privately;
   an admitted contribution, queued work, created task and completed operation have
   durable identities and recoverable outcomes. A retry does not repeat a write.
5. **Connect mail and APIs deliberately.** A connection form keeps credentials out
   of chat. Agents and Skills use the same installed Actors and protected executors.
   Historical mail import and new-mail monitoring share capture and provenance.
   Unassigned arrivals enter the restricted upload inbox.
6. **Measure the waiting.** Separate time to acknowledgement, useful result and
   completion; distinguish model waiting, execution and checking. Use those measures
   together with correctness and feedback to prioritize improvements.

Implement in that order, with instrumentation starting first. Do not postpone the
input/grounding fixes until the mail platform is finished. Do not present a monitor
as active until its server-side supervision and delegated authority exist.

This is a delta to the [Studio experience](skill-studio-experience.md),
[Skill model](skill-studio.md), [shared runtime](skill-studio-shared-runtime.md),
[semantic collections](semantic-artifact-collections.md), and
[customer-data boundary](customer-database-platform.md). Those documents retain
their ownership. This proposal supplies the implementation decisions and release
gates for the next work, not a second runtime or operations handbook.

### Additional product requirements and their implementation boundaries

The written product feedback supersedes incomplete speech capture. These are planned
requirements, not claims about the running client. They extend the shared framework;
they do not displace the input, feedback and connected-work sequence above.

**One additional workspace, created in the client.** After the initial purchase and
passkey setup, the environment selector offers a plus action for one additional name
and private customer environment. The platform, not the client, atomically consumes
this account-level entitlement and reserves a globally unique name. Concurrent clicks
or two devices must converge on one operation; a provisioning retry resumes that
environment rather than consuming another entitlement. Failure must not leave an
invisible reservation, and deleting an environment must not replenish the entitlement
implicitly. Keep the allowance in entitlement policy, not a permanent two-database
assumption in identity, routing or storage. Further purchases remain a later external
commerce flow. The existing multiple-owned-environment model is the base; the in-app
additional-environment grant is not implemented yet.

App distribution needs a separate payment-policy review. Apple's rules concern
in-app purchase, not simply Apple Pay; multiplatform access, enterprise use and free
companion apps have different conditions and regional exceptions. External checkout
alone does not establish App Store compliance. Do not introduce a paid-upgrade link
in the client until the applicable distribution rules have been checked against
[Apple's payment guidelines](https://developer.apple.com/app-store/review/guidelines/#business).

**Resumable setup templates.** Ask private/business purpose, jurisdiction and legal
form, with skip and later completion. Instantiate an ordinary setup Intent from a
versioned template: applicability questions, requested document roles, typed property
schemas, evidence requirements and installed operations. Store its template version
and per-item state (`unknown`, `needed`, `provided`, `needs-review`, `not-applicable`),
not another workflow engine. New template versions propose a diff; they must not
overwrite user answers or declare an existing setup invalid without explanation.

The first German business template should gather existing records, not purport to
incorporate a business or certify legal compliance. Start with these conditional
document families:

| Applicability | Ask for, when available | Extract and present |
| --- | --- | --- |
| GmbH/UG formation and subsequent changes | Articles, shareholder list, separate director appointment if applicable, register evidence; in-kind contribution records only when relevant | Legal name/form, seat, address, register identity, representation, ownership and effective dates, each linked to its source |
| A trade subject to notification | Trade notification/confirmation and later change records | Activity, establishment and effective date; do not treat this as a universal requirement for every self-employed person |
| Tax registration | Relevant submitted registration questionnaire and authority-issued tax identifiers/notices | Distinguish tax number, VAT identifier and business identifier; preserve issuer, country and scope rather than one generic number |
| Entities subject to beneficial-ownership reporting | Existing register confirmation and supporting ownership/control records | Effective ownership/control observations and unresolved conflicts; never infer completeness from a shareholder list alone |

These branches follow [GmbHG §8](https://www.gesetze-im-internet.de/gmbhg/__8.html),
[GewO §14](https://www.gesetze-im-internet.de/gewo/__14.html),
[ELSTER's legal-form-specific registration forms](https://www.elster.de/eportal/formulare-leistungen/alleformulare)
and [GwG §20](https://www.gesetze-im-internet.de/gwg_2017/__20.html). This is an initial
document-organization template, not an exhaustive legal checklist. Regulated-sector
permits, local differences and later jurisdictions require separately maintained
applicability rules and domain review. Record source and review date with each rule.
Do not ask for identity documents or all personal beneficial-owner details by default.

Documents follow inbox admission, authorized extraction and typed knowledge/lineage.
An extraction is an observation, not a confirmed legal fact. Show conflicting or
superseded values with effective dates; request confirmation before promoting disputed
master data. Completion means the selected setup items have explicit dispositions,
not that Aven has established legal compliance. The same template mechanism can later
organize a move, project or household without embedding German business logic in chat.

**An artifact-to-artifact JavaScript Actor.** Reuse the inspected QuickJS foundation
in `libs/aven-actors/src/sandbox.ts` (WASM, JSON-only crossings, 32 MiB heap and bounded
evaluation). The native QuickJS plugin also contains bounded fixture execution, but
its entrypoints and limits differ; do not call the two implementations equivalent.
Qualify one shared WASM execution contract in an isolated browser Worker and server
worker/process before offering the Actor in Studio. The current synchronous VM path
must not block the UI, and an outer deadline must cover serialization and teardown as
well as VM execution. Native/mobile availability is a separate gate.

First version is a pure bounded transform: immutable script/version digest, declared
input artifact occurrences with schemas and byte limits, plain copied data, and
schema-validated output artifacts. No network, filesystem, credentials, package
installation, dynamic imports or general host `cap` callbacks. The trusted runner
fetches authorized inputs and publishes outputs through existing ports, retaining
code/runtime version and input lineage. Large inputs fail with a clear limit or use
an explicitly chunked composition; never silently truncate them. Bound output bytes,
depth, execution time and concurrency; reject non-JSON values. Clock/randomness must
be absent or supplied as explicit inputs before calling a transform deterministic.
Generated code is still untrusted and is not automatically safe for the upload inbox.
Ideal nodes can propose this Actor only when installed and tested against the stated
acceptance cases. Prefer an existing specialized Actor; keep the path from tested
LLM procedure to script to maintained library without parallel Skill semantics.

**Two UI trust levels.** Model-shaped tables, charts and process forms use validated
declarative view specifications and typed actions. They cannot mount arbitrary DOM,
styles, scripts, privileged input types or network handlers. Credential entry,
permissions, destructive confirmations and recording controls are system-owned views
in reserved application chrome, outside generated content's layout/focus authority.
Generated content cannot cover, dismiss, relabel or synthesize confirmation for them.
Use a stable system indicator and keyboard-accessible review drawer; a color alone
is not an anti-spoofing boundary. Extend the shared review/continuation contract with
typed secret-entry and capability-grant forms. Ordinary form values can be disclosed
under the declared process policy; credential fields go directly to protected storage
and return only completion/binding metadata, never the submitted values. Section 7
defines credential use and public documentation fetching.

**Scoped host files.** Add an explicit device capability for selected files or a
selected directory, separate read/list/write permissions, bounded traversal and
lifetime, with a system picker and inspectable/revocable grant. Start read-only;
write/overwrite needs its own preview and policy. Normalize paths, prevent symlink
and path-swap escapes at use time, and bind the grant to device, environment and
scope. Never infer home-directory access from an uploaded document. Explain why a
narrow scope is insufficient and offer one bounded expansion rather than repeated
micro-prompts. A server job cannot treat a sleeping desktop's files as server-local:
copy authorized inputs into the Store or explicitly wait for the device. Feedback
can guide better requests; it cannot grant or expand filesystem authority.

**Continuous transcription as an explicit mode.** A voice request can start a
session after microphone/model-disclosure authority is established. A persistent
system control shows recording, paused, interrupted or stopped. In recording state,
recognized speech becomes timestamped transcript segments, never router input or
agent commands—even if someone says to stop, send data or change Intent. Only the
pause/stop buttons leave recording state. Pause keeps the control and transcript
open and restores ordinary conversation, including questions over captured segments;
resume may be requested by voice while paused or by the record button. Stop finalizes
the transcript and closes the control. Start/pause/resume/stop are idempotent events
under the same session identity. Retain text segments durably; audio retention is a
separate opt-in, not assumed. Device failure, workspace switch or process termination
marks an interruption; recovery must never silently reactivate the microphone. This
long-lived system control shares the review host but is not a one-shot approval that
disappears after the first click. Speech endpointing remains a separate work item.

**Inspectable context.** Show a compact per-Intent usage indicator, distinguishing
estimated assembled tokens, last provider-reported usage and the model's limit.
Offer a searchable view of the actual versioned request context: source contribution
identities, instructions, retained receipts, selected sources and explicit omissions.
Name which request/phase it represents; current draft context and a submitted snapshot
are not the same. Read from the shared context builder instead of reconstructing from
visible chat. Never expose credentials or hidden provider reasoning, and do not copy
full contexts into performance telemetry. Message feedback reuses the original
response identity and controls; non-message records need a distinct annotation type,
not fabricated chat responses. A thumbs-down does not silently remove evidence or
change system instructions. Bound retention and load full content on demand.

Implementation order within these additions: trusted review/secret entry with S4;
context inspection alongside observability; workspace entitlement/setup and the pure
transform Actor as independent later slices; then scoped files and continuous
transcription after their permission/recovery gates. Each slice needs real-Qwen
positive and adverse journeys with independently invented data. No task is considered
implemented merely because the agent saved a Todo describing it.

## 2. Evidence, confidence and priorities

### Review method

The review used current source at `628380e9` **plus the existing uncommitted work**,
read-only customer Intent/feedback inspection, existing test source and retained
receipts, and new isolated real-Qwen/native runs. A Git commit alone does not identify
the tested dirty tree. Implementation must fingerprint relevant files and executable
builds in every new test receipt.

Seven recent conversations and their recorded actions were inspected, including a
fresh read of the most recently requested supplier investigation. Feedback was joined
to its exact answer and request. The initial feedback sample contains eleven events
on five responses: edits to a reason are not independent ratings. Latest ratings on
those responses were four negative and one positive. Long pasted material and some
long answers were inspected through bounded excerpts, not claimed to have been read
in full. Raw customer content, names, identifiers and distinctive combinations are
excluded from this document and the synthetic probes.

In the initial sample, fourteen of seventy-one agent answers were recorded failures.
Among thirty-four answers retaining total duration, the median was about 87 seconds
and the maximum about 446 seconds. This is a mixed-build historical diagnostic sample,
not a current benchmark, a representative population estimate or a proposed SLA.

| Evidence | Finding | Required decision |
| --- | --- | --- |
| E1: conversations and feedback | Users wanted an actual view, document link, saved result or reusable procedure; explanations and inventory counts often substituted for the deliverable. A concise practical checklist received positive feedback. | Preserve outcome and accumulated constraints. Prefer the appropriate existing result surface, not more narration. |
| E2: latest supplier investigation | Earlier assistant supplier claims were repeated despite empty matching queries. A later turn invented a filter field and cursor, then failed after fourteen calls. | Receipts, schema-bound fields, opaque cursors and provenance must survive turns. Correct an unsupported claim; do not launder it through chat-history search. |
| E3: current native probe | A real-Qwen-created task existed before webview reload and disappeared afterward. | Durable task operations are a release blocker, not a wording fix. |
| E4: current native probe | A spoken accepted transcript saying yes to a pending destination decision became a second waiting item. Reload removed both pending items. | Confirmation must address the active input decision; pending inputs need private recovery. |
| E5: rerun native parallel journey | Eighteen checks passed, including independent work, queued follow-up, explicit new Intent, destination overrides, double-tap protection and stored routing metadata. | Keep these working boundaries. Do not rewrite concurrency from scratch. |
| E6: current routing probe | Eighteen real calls selected the expected destinations in 342–1090 ms, median about 460 ms. Two localized new-topic reasons falsely said creation had already happened. | Retain a small router; application-owned status wording must distinguish proposed, admitted and completed. These timings exclude ASR/TTS and loaded-system qualification. |
| E7: proposed confirmation probes | Rich free-form contracts exhausted token budgets, chose the wrong language, or emitted irrelevant destination fields. A smaller reply classifier improved semantics, but two of twelve requests timed out at fifteen seconds during concurrent model work. | Narrow schemas, explicit locale, host-owned target IDs, deadline/recovery controls and interactive scheduling. Prompt changes alone are insufficient. |
| E8: source and real stream test | Interrupted streams are rejected; completed calculator work is not repeated after a model transport failure. Historical provider HTTP 400 bodies are discarded. | Preserve recovery. Add redacted diagnostic categories before guessing the cause of historical provider rejection. |
| E9: HTTP tests and credential-worktree review | Actual loopback HTTP works with an in-memory Vault and supplied authority context. Protected credential storage, protocol isolation and durable publication are not established by that test. | Build and test the missing boundaries before enabling customer credentials. |
| E10: focused real-Qwen knowledge journey | Six conversational checks and productive Skill execution passed, but the schema answer was a wall of technical details. The final external test-judge request consumed 122,327 prompt tokens. | A correctness pass is not a UX pass. Keep concise result surfaces and budget the test judge's evidence separately; that judge measurement is not a production-verifier measurement. |

The exact cause of the historical HTTP 400 responses is **not established**. Excessive
context, provider output settings and malformed requests are hypotheses, not findings.
The original supplier list also cannot be verified from its truncated retained
receipt. Later empty results do not prove historical absence, and a quoted old answer
does not prove that it was true.

### What the existing tests actually guarantee

| Test / evidence family | Retain its guarantee | Missing proof to add |
| --- | --- | --- |
| `live-parallel-intents.ts`, rerun in this review | Real native client, passkey-approved synthetic account, real Qwen, independent threads, queued follow-ups and confirmed routing persistence | Spoken replies to routing questions; pending-input reload; several outstanding decisions; durable execution after client closure; loaded routing latency |
| `input-routing-ui.mjs`, rerun at 390 and 1280 px | Existing components render real model receipts without horizontal overflow; picker controls are reachable by the scripted interaction | Whole input conversation, keyboard/large-text behavior, genuine ASR/TTS and human comprehension. The component overlay is not the native journey. |
| `live-model-stream.ts`, rerun | Real stream cutoff, terminal failure, permit release, recovery without repeating a completed calculation | Context-limit diagnosis, provider rejection classification, simultaneous load and process-restart recovery |
| `live-llm-skills.ts --knowledge --focused` | Real extraction, Store queries, typed money, snapshot pagination, exclusions, uncertainty and model-authored productive Skill | Native input/rendering; faulty prior prose after restart; large receipt recovery; all-value occurrence views |
| Prior completed `live-studio-workday.ts` receipt | Retained evidence for nested Skills, manual case reconstruction, Markdown output, arrivals, pause/resume, variants and provenance | Not rerun in this review; not proof of protected IMAP, credentials, unattended operation or acceptable latency |
| Prior `live-response-feedback.ts` receipt | Vote/reason controls, clipboard, reload and idempotency evidence | Feedback-driven generalization and new input UI regression |
| Selected app contract tests: 23 passed | Timing formatting, previews, feedback, admission metadata, interruption and verifier failure boundaries | These are deterministic contract tests, not substitutes for real-model product evidence |
| HTTP package: 16 passed with actual loopback networking | Request validation, matching, conditional exchange and local acquisition contracts | Real credentials component, guarded network service, tenant isolation, revocation, leak prevention and mail |

An old scope journey that gives the agent `intent_create` is not a test of the new
input-owned routing boundary. Rewrite that journey when replacing the boundary; do
not retain two routing authorities merely to keep an old test green.

## 3. Input UX and admission contract

### One input, one visible decision

The composer has one text/voice entry surface and a compact destination chip. It is
available in every view. It shows captured input, a brief topic acknowledgement, and
at most one active routing question. Further pending inputs appear behind a count,
not a vertical wall of cards. Opening one never changes or discards another.

Processing, tool calls, long answers and progress remain in the assigned Intent.
On surfaces without native history, a conversation panel may show the owning Intent's
history; it is not a second chat or a processing area inside the composer. The input
acknowledgement is about understanding/routing, not an unverified substantive answer.

Current-context messages require no habitual confirmation. For a proposed different
Intent, show its title and one sentence explaining the fit, with three short actions:
the suggested target, keep here, choose another/new. Say one yes/no question whose
yes has exactly one meaning. A picker adds recent activity or a short summary when
titles collide. Do not expose UUIDs as the primary disambiguation.

Explicit, unambiguous destination instructions count as user choice: a requested new
Intent can be admitted directly after the routing check, without another ceremonial
confirmation. An inferred new topic or suggested different existing Intent requires
confirmation. Quotes, negation, examples and references to another Intent as evidence
are not requests to move. Creating a broad discussion Intent does not authorize
research, task creation or Skill execution inside it.

After admission, show a short destination receipt with an open action and free the
input immediately. Do not force navigation for background work. If the user explicitly
asked to open a new Intent, select it after acknowledgement unless they have since
navigated or started another input. Following messages inherit that accepted target
only in the same input context; a deliberate later selection takes precedence.

### State and identities

The proposed input state is:

```text
draft → checking → ready-to-admit → assigning → assigned
             ↘ awaiting-choice ↗
          failure → edit / retry / manual choice / discard
```

Before `assigned`, nothing is a contribution in any Intent. Store recoverable input
locally in the native application's private, encrypted draft store, not in customer
chat history. Web clients use a session-only fallback until an equivalent private
store exists; they must say when recovery is unavailable. Audio is not retained by
default. An explicitly discarded input and its local transcript are removed.

Each pending input owns:

- `inputId`, `revision`, original text/transcript, locale and optional speaker;
- customer environment and generation, capture time and timezone;
- default Intent and selection epoch captured on submit;
- typed screen references: selected artifact, case, draft revision or view selection;
- current proposal, `decisionId`/revision, and dependency on another unresolved input,
  if any; never a promise-chain position as its only relationship;
- admission attempt identity and state, without access tokens.

A model response is usable only for the exact input revision, decision revision,
environment generation and request it was computed for. Editing cancels old routing;
late responses cannot overwrite newer words or choices. Switching customer environments
suspends local inputs in their original environment; it does not retarget them.
Reload restores them as unassigned and rechecks access before resuming.

### Two narrow model decisions, no routing agent loop

Use a bounded tool-free route call for a new contribution. Extend the current contract
with a short **topic**, not free-form claims that work was completed. Supply UI locale
and explicit user language preference; a one-word yes does not change language. The
host renders localized status and exact target labels. Keep original text for execution;
the topic is not a rewritten user request.

The same call classifies `requestKind` as `topic-opening` or `request`. The host
records the resulting response mode with the accepted input, included in its material
digest. A topic opening permits one scope question, with no tool schemas or execution;
the next actual request is a normal turn. A title containing an action verb is still
only a title, while a separately requested result is work. Short questions and
follow-ups are not topic openings. A manual choice after routing is unavailable may
leave this classification absent; there is no second scope-classification model round.

Use a separate narrow reply classification **only while a routing question is active**:
`accept-suggested | keep-current | amend | independent | cancel | ignore | clarify`.
The host supplies and owns `decisionId` and available target IDs. The model does not
return those IDs again for yes/no. A clear amendment reruns the normal route check with
the original contribution and the explicit correction. An independent request becomes
its own pending input while the old decision remains unresolved. Ambiguity asks which
message the person means; it does not consume either as consent.

These contracts must have runtime discriminated validation. Do not accept malformed,
truncated, late or unknown-target output. A prompt-only experiment is not a qualified
router; E7 shows why. Manual clicking invokes the same host decision transition,
without another model interpretation. If the model is unavailable, keep the words and
offer manual routing/retry; never silently send to a guessed destination.

Candidate retrieval is metadata-first, permission-scoped and bounded. Keep the selected
Intent and relevant recent dialogue, then recent/search-ranked candidates. Do not read
all documents for routing. More than the current fifty-candidate limit requires indexed
retrieval plus a searchable picker, not an unbounded prompt. Duplicate names never
establish unique identity. Missing candidates do not prove that no suitable Intent exists.

### Queueing and voice

An unresolved choice blocks only dependent follow-ups, not unrelated inputs. New
contributions can be classified while an earlier choice is pending. Keep actual agent
execution FIFO within each Intent and independent across Intents. A new explicit Intent
must bypass both an executing turn and queued turns in the current Intent.

**Foreground continuity implementation:** before the next answer begins, the shared
engine takes a bounded, contiguous group of already-admitted waiting messages with
the same Intent, captured context and anonymous speaker. Each message keeps its
original text and identity. The model reads them in order before acting, so a later
continuation, correction or withdrawal can change the requested outcome. One answer
records the message IDs it addresses and is labelled accordingly in the conversation.
The bound is sixteen messages and 32,000 characters, with an oversized first message
processed alone; no new waiting interval or model router is introduced. An existing
run is not rewritten or interrupted. Separate unrelated requests in a group still
need their respective outcomes, not an invented combined task.

This implements the user's immediate priority—coherent outcomes even when speech
arrives in separate messages—not speech endpoint detection. It is not durable outbox
coalescing: each dispatched background turn still has its own immutable admission and
work authority. Extending grouping there requires an explicit authorized group claim,
not silently running later inputs under an earlier input's grant. An input still in
the routing widget cannot yet affect an already-running answer.

**Planned queued-message controls:** every waiting message offers compact, accessible
Edit and Delete actions beside that message in both chat presentations. Edit opens
an in-place text field with Save and Cancel; it does not occupy the global composer.
Opening the editor does not stop work; cancelling the edit leaves
the original untouched. On Save, check the authoritative execution state, not the
state captured when editing began. If the message has not been sent to the model,
replace its pending work with the edited message in the same queue position. If it
has already been sent, cancel that message's run and schedule the edited replacement
ahead of its later queued follow-ups. Other Intents and unrelated runs remain untouched.

Make replacement one revision-checked, idempotent command. Keep admitted text and
receipts immutable: record a linked replacement contribution with a new input and
turn identity, and mark the old request as superseded. The normal chat shows the edited
version with accessible history, not two apparently independent requests. Concurrent
edits must not silently overwrite each other, and a lost Save reply must not create
another replacement. Before admission, edits remain local input revisions instead.

Use the existing cancellation and per-Intent execution fences: prevent further calls
and final-answer publication from the superseded run, and wait for in-flight effects
to settle before starting its replacement. Editing does not undo completed actions;
retain their receipts and supply them to the replacement so it does not blindly repeat
them. An uncertain effect blocks replacement execution pending reconciliation. If
completion wins the Save race, retain that outcome and process the edit as its linked
replacement, without claiming cancellation or cancelling a newer run. Show saving,
stopping or blocked state in place; preserve the edit if saving fails.

Delete uses the same authoritative stop command and execution fence, not removal
from a client-side array. An unstarted message leaves the execution queue and is
collapsed to a small cancelled marker; its admitted record remains available in
history. If dispatch wins the race, stop that exact run and show its actual stopping
or stopped state. If completion wins, retain the answer and receipts instead of
claiming that the work never ran. Do not cancel a later run or another Intent, and
do not undo completed effects. Keep the message and an inline retry available if
the request fails; an uncertain reply is reconciled using the original command
identity rather than issuing a new action. Clearing a queued request is not erasure
of the customer's conversation history.

Qualification must exercise both chat presentations with independently synthetic
real-Qwen conversations: edit and delete while an earlier answer runs; dispatch
during an open editor; Save after completion; cancellation of an executing effect;
duplicate clicks and lost acknowledgements; reload and environment changes;
unchanged work in another Intent; and preservation of unsaved edits on failure.
Assert the actual model input and saved work records, not only the visible text.
The unchanged and deleted versions must never be dispatched after a successful
pre-dispatch edit or deletion. Preserve keyboard access and a compact narrow-screen
layout. These controls remain pending until the normal composer uses the shared
durable admission/control path; do not introduce a second foreground replacement
mechanism to make buttons appear functional.

Only final accepted speech is submitted; interim ASR hypotheses remain editable input.

The durable replacement slice handles pending, started and completed work through the
same signed admission command: new input identity, expected predecessor control
revision, immutable original text, same Intent and an explicit FIFO position separate
from contribution chronology. Exact retries return their receipt. Competing edits,
cross-Intent/owner substitutions and invalidated dispatch reservations are checked in
real PostgreSQL. A started predecessor loses authority immediately; its replacement
waits for executor and effect settlement. An edit to a terminal turn joins the end of
the queue, preserving any newer running work and the earlier outcome.

The worker follows immutable, digest-checked same-Intent replacement ancestry and
reads private settled tool receipts under its restricted database role. The writer
and answer reviewer both receive these as historical actions, separate from new calls
and current state. The edited wording is the corrected outcome for the same work, not
an independent second creation. A known resource is updated by identity; subsequent
uncontradicted changes survive. Ambiguity or an irreversible effect requires an honest
partial result or a user decision, not invented rollback or automatic compensation.

Inspection is all-or-nothing: at most sixteen ancestors and sixty-four receipts within
192,000 UTF-8 bytes. Invalid, uncertain or oversized ancestry fails closed without
starting another model action. These are current safety bounds, not a truncation or
automatic summarization policy. Native Save/Cancel controls, preservation of edit
drafts and the combined client handoff remain unqualified; do not expose this backend
slice as the complete editing experience.

**Deferred, separate voice-design work:** a finalized transcription segment or silence
does not establish that the person has finished their contribution. Thinking pauses
must leave unfinished speech in the input widget, where subsequent speech can extend
or correct it, rather than admitting separate messages into an Intent. Completion
assessment should inform routing and submission; sentence punctuation alone is not a
completion rule. Short replies can be complete, and a complete sentence can still be
part of an unfinished request. The design must balance premature submission against
response latency, provide an explicit send control, and be tested with real audio
covering pauses, self-corrections and short replies. No completion algorithm, timeout
or additional model call is selected here; implementation is explicitly deferred.

As part of that deferred work, the router should restore a missing question mark in
voice input when the spoken contribution is clearly a question; the person need not
say “question mark.” This is punctuation-only cleanup, not a rewrite of their words
or meaning, and remains editable in the input widget before admission. Do not alter
typed input or duplicate punctuation already supplied by transcription. An inferred
question mark must never itself trigger submission. Include ambiguous utterances,
mixed statements and questions, and questions followed by a thinking pause in the
real-audio checks; leave uncertain punctuation unchanged.

Maintain one spoken routing question at a time. Barge-in cancels narration promptly,
then interprets the final reply against the active decision. A speech fragment such as
an explicit report of background audio is not work authorization. Do not claim that a
model can reliably identify the speaker or all accidental audio without additional
evidence. Microphone/listening state must remain visible and controllable.

Mute narration and stop work are separate controls. Stop work names one Intent/turn;
it leaves other threads running. Audio ownership cannot be stolen by a late answer
from an older or background thread. Screen-reader announcements must not compete with
TTS, repeat on every render, or expose private background answers unexpectedly.

### Durable admission

Add one Intent-service transaction that validates authority and target, creates a new
Intent if requested, appends the exact human contribution, and records a runnable turn
outbox entry. Acknowledgement returns `inputId`, `contributionId`, `intentId`, `turnId`
and committed sequence. Only then does the input remove its local pending item.

Use `(subject, inputId)` bound to its accepted revision and canonical material digest for idempotency.
Lost response: resolve/retry that exact admission and return the original receipt.
Changed text or target after dispatch: resolve its outcome first; never reuse the key
for different material or automatically send a second version. Cancellation during
assignment resolves whether admission committed; it cannot promise an unsent message
while its transaction may have succeeded. A wrong admitted destination is an explicit
correction with history, not silent transcript rewriting.

The outbox belongs to `aven_intents`; its dispatcher admits the stable `turnId` into
Actor Runner. No cross-service SQL transaction or new global queue is required.
At-least-once outbox dispatch is safe through runner admission idempotency. Lost
admission acknowledgements, two clients and worker restart must produce one logical
turn, not one turn per connection.

One captured input ID can be admitted only once, including across revisions. Revisions
allow editing before admission, not a second submission after an uncertain result.
The receipt binds the accepted revision and complete material. Another revision
conflicts rather than appearing absent. A later correction uses a new input ID and
contribution; the planned queued-message replacement command links these explicitly
and preserves queue order without mutating the original admission. Archiving, merging
or deleting an Intent withdraws its authority
atomically. Unbound delivery is cancelled; a bound run holds FIFO until its effects
are reconciled. Restoration neither revives that work nor removes this barrier.
This does not undo completed effects.

## 4. Durable work and trustworthy answers

### One engine, separate state projections

Extract the portable turn engine from `chat.svelte.ts`; keep Svelte as the UI adapter.
Run that same engine behind the shared Actor runtime for admitted server work. Do not
implement a second headless prompt/tool loop. `ChatThreads` becomes a per-Intent
projection/controller, not the only holder of queued work or completed receipts.

Persist a checkpoint before/after each tool boundary and at waiting, completion and
failure boundaries: admitted input, conversation watermark, exact tool invocation IDs,
receipts, current step, budgets, cancellation revision and output contribution ID.
Use a fenced per-Intent execution lease so two workers/clients cannot execute the same
turn; lease expiry does not authorize replaying an uncertain side effect. Dependent
turns read the preceding committed outcome, including an honest failure or question.

Implementation detail: record model I/O and operation receipts in an ordered journal,
then reconstruct the same engine from that journal. Completed model responses are
replayed locally, not regenerated; completed operations return their saved receipts,
not another execution. This preserves the existing review/repair state machine without
a second loop or a serialization format for every private engine field. Pin the engine
digest, tool contracts, prior conversation watermark and turn clock. A changed replay
request fails closed. A model interrupted before its response is checkpointed can be
generated again because none of its requested tools has been dispatched. An operation
interrupted after dispatch requires an exact effect receipt or explicit reconciliation.
Declared read-only observations can instead be read again under fresh authority;
their timing must be identified as the new read, not the unknown original duration.
Every journal write is guarded by the current run lease; failed persistence prevents
further calls and publication. The journal is customer data, never ordinary telemetry.

The final outcome needs its own checkpoint, not just reconstructed model/tool state:
otherwise recomputed timings change the publication digest after a lost acknowledgement.
The implementation retains that exact answer and timing. A lost effect reply resolves
from its operation receipt; its measured receipt-check time is not labelled as the
original execution duration. An installed journal executor may resume an expired run
only with the exact pinned engine digest and at most three total attempts. Other
Actors and changed engines retain the uncertain-effect stop. If final publication
already committed, the runner closes from that exact receipt without reading another
conversation context or calling the model. None of these recovery paths authorizes
another tool action from an expired, cancelled or completed turn.

Implemented model timing distinguishes answer generation, checklist construction,
verification and repair, retaining full duration and time to the first nonempty
public text/tool fragment. These timings are not first-audio or first-accepted-answer
measurements. A repeated live-Qwen reviewer comparison found a false acceptance in
the faster non-reasoning candidate despite an initial complete pass. Keep the
reasoning-enabled reviewer, its explicit auditor role and strict per-item checks;
do not exchange accuracy for a shorter apparent completion time. The focused source
and saved-task qualifications are specified in the build/test handbook.

One-turn delegated authority uses a distinct signed work certificate, never a stored
identity token. It binds the input ID/revision and material digest to the subject,
environment, database, routing generation and an explicit upper bound of component
actions. Its maximum lifetime is one hour, including queue time. The executor
exchanges it for short-lived component grants only after checking current entitlement,
component readiness, generation, the turn's cancellation state and the current run
lease. Each grant binds the work/turn/run/lease and expires within sixty seconds,
the parent certificate's lifetime and the verified current lease deadline. Work
admission allows no clock grace after either certificate expires. A request already
admitted may finish; this is not cancellation of an in-flight external effect.
The work boundary does not fabricate an
identity; mixing login and execution headers is invalid. A certificate is
not accepted as a login or ordinary tenant grant and cannot authorize a Source.
Expiration preserves the admitted message and pauses its work with a reauthorization
action; it must not resend the contribution. Child Skills cannot extend the parent's
action set or lifetime. Facade signing, Intent-service verification/storage and the
guarded exchange library are implemented. The task journey exercises actual
delegated permissions against the same Task handler. Exchange and execution checks
now cross signed, bounded HTTP requests in isolated real-Qwen journeys. Background
dispatch and pause UI must pass the combined release proof before desktop work uses
this path. Runner admission precedes outbox acknowledgement: an admitted run waits
without model calls or effects until its exact durable outbox binding exists. A
lost acknowledgement is resolved with the stable turn key, not a new lease-derived key.

Restart discovery uses a separate, sixty-second signed worker placement containing
only runtime, component, environment, database and generation. There is no synthetic
customer identity or saved session credential. The facade authenticates the requesting
service against that runtime's operator-owned destination; keyset pages contain only
active component placements. A worker verifies the signature and exact runtime before
opening its restricted component pool. The pool and queue check physical generation
and execution state even when a connection is cached. The Intent query returns at
most sixteen eligible queue IDs/owner scopes. It does not authorize their execution:
each still needs the accepted work certificate and live turn/run checks above. This
discovery transport and bounded delivery supervisor are implemented. Each sweep
advances one directory page, interleaves customer queues and admits at most four
deliveries concurrently. An unavailable database does not hold the next page; only
directory failure backs off the complete loop. Shutdown aborts further delivery and
drains the current bindings without leaving a timer. Signed runner admission and
lifecycle transport are implemented. Intent Service and Actor Runner now have opt-in
startup compositions using those same loops. The complete native handoff, document
retrieval and delegated child execution still gate enabling them for customers.

Pre-lease admission has its own short-lived dispatch binding. The facade checks
the exact pending outbox claim, accepted certificate and current placement before
issuing an Actor Runner admission grant. The runner accepts no body and constructs
only the installed chat command. A dispatch grant is not an execution grant: it
cannot read conversation context, call a tool or publish an answer.

Pinned context and final publication now cross a closed internal Intent-service HTTP
endpoint using the same execution-bound grants. It accepts no body-selected subject,
turn, run, environment or watermark. Publication requires write permission, and context
omits the work certificate. Bounded history drops only whole older contributions and
reports incomplete coverage. The narrow lifecycle endpoint separately uses the
Intent service credential and signed current-runtime placement. An exact admitted
subject/turn/run/input reference may read state or recover its original certificate;
it never returns conversation content. A certificate alone is insufficient for
execution: the normal exchange still checks the current runner lease and access.
Completed work returns only its saved receipt even if its original authority expired.
`ChatTurnHost` shares these checks, history reconstruction and publication between
the real-model proof and the opt-in service composition. A separate supervision loop now
uses a content-free runner-status endpoint to block expired authority or terminal
work without a saved answer. It never interprets an unavailable service as a failed
run, repeats an effect, or overwrites a completed answer. Generic runner retry refuses
journaled conversations. Startup qualification, user-facing status/renewal controls, full tool
coverage and native handoff still gate production enablement.

An authenticated, bounded per-Intent queue projection is implemented independently
of execution. It distinguishes queued from accepted work and returns the saved
answer link only after publication. It exposes neither work certificates nor journal
content. Expired authority is visible without waiting for supervision; an existing
uncertain-effect warning remains the primary reason. Reading this projection does
not renew, retry or cancel work. Native background controls remain a separate gate.

The authenticated stop endpoint now records a revision-checked, immutable command
receipt alongside the conversation and withdraws further turn authority. Queued work
is cancelled without executing; bound work reports stopping without releasing FIFO
or overwriting an uncertain-effect warning. A completed answer wins a concurrent
stop. Current model and tool calls may settle, but each following call rechecks
authority. Cancelled/blocked/failed requests remain in history with a host-owned
disposition, not as unfinished requests to execute later. The supervisor now examines
terminal runner state, the executor movement fence and unresolved tool checkpoints.
A known settled stop gets an immutable system receipt and releases FIFO; a missing
tool acknowledgement instead retains an uncertain-effect warning. That warning is
not cleared by a later generic status sample. Receipt reconciliation, child-Skill
lifetime, renewal and native controls must still pass before enabling the full path.

The host-only artifact publisher now rechecks fresh write authority on every request,
binds publications to the accepted user and workspace, and distinguishes a lost write
acknowledgement from rejection. Exact immutable replay and original-receipt lookup
are proved against the real Store. A restricted background Studio adapter now uses
the existing Studio Actor, compiler, revision-checked drafts and publisher. Every
subrequest checks fresh delegated authority and the physical execution lease. It
offers authoring and publication, but not execution, Source controls or self-confirmation
of a proposed case. Draft saves now commit their exact revision snapshot with a
host-bound invocation receipt and recover it without redispatching the edit. Receipts
are worker-only and immutable; later draft edits cannot change the recovered result.
Skill-publication recovery now reads the exact immutable Store commit and repairs
the published head only if the requested draft revision is still current. A missing
receipt remains uncertain and a later draft is never overwritten. Case-proposal
recovery reuses the same Actor's predecessor-relative edit logic with a read-only
lookup transport. Its real-model interruption scenarios now pass for a new case and
later refinement, preserving the original evidence and mandatory human-review gate.
Child lifetime, service-composition qualification and native handoff remain prerequisites for the
full production/native path.

The shared Studio Actor distinguishes a local rejection from a possibly committed
effect. It tracks whether a write actually crossed its request boundary; malformed
authoring or case input, cancelled preflight, and failed reads before a save return a
settled error that the model can correct. After write dispatch, only an explicit
trusted rejection or the original durable receipt can settle the outcome. HTTP status
or error wording alone cannot authorize a retry. The shared retrieval adapter likewise
retains the call's optional purpose for display without passing it as a storage filter.

The shared Actor tool host now provides Tasks and delegated indexed history without
a second tool-name-specific execution loop. History uses the same owner-scoped Store
as interactive requests, including archived messages and feedback. Bounded Intent
previews retain exact message identities for quotations; a search snippet alone is
not a retained citation. Continuing long text uses Unicode code-point offsets on both
hosts. These observations never change the accepted destination, and assistant-source
roles remain visible rather than turning an old assertion into corroboration.
Message searches now return a code-point `readOffset` for their exact displayed
passage. If headline generation changed markup, the preview falls back to the original
first page rather than inventing an offset. Search alone remains non-citable. A quote
outside retained pages names the missing page boundary instead of claiming the whole
source was already read. Prior-turn research checklists and temporary quote handles
stay in the saved trace, but are omitted from the next question's model context;
ordinary action receipts remain.

Reuse runner admission/recovery and private review continuations. Device-only work
becomes a durable waiting-for-device step; it does not make the entire agent depend
on an open UI. Persist scoped authorization decisions/delegations, not reusable user
tokens. Expired authority pauses with a reauthorization action. Credential and external
effect rules in section 7 still apply to work initiated by a normal chat turn.

For Todos, replace browser-only mutation state with one server-backed Actor domain
store under a registered productivity component and scoped API role. A task has a
stable ID, revision, owner/environment, optional owning Intent, title, status, due
fields and causal contribution/operation. Create/update/archive are idempotent and
revision-checked; list/board are projections of that same state. Use one operation
contract from chat, Studio and UI, with explicit trial storage. The memory-only
ConfigActor path must not remain a second authoritative task list. Validate registration,
provisioning and restore with the customer component catalog before enabling it.

### Receipts, not truncated prose

The earlier 1,500-character saved result could be consumed almost entirely by a
repeated notice. The foreground engine now retains structured results up to 8,000
characters independently of display truncation. Large task pages and effect receipts
use a projection validated by the existing task schemas, preserving identities,
revisions, values and scope. Omitted rows and metadata remain explicit. Answer review
also retains ordinary UI/Actor receipts without a name allowlist and supplies bounded
historical observations separately from current actions. Research checklists never
become independent receipts. This fixes bounded continuity, not arbitrary-size receipt
retrieval. Complete the design with a bounded preview plus an authorized receipt
reference. Store the complete bounded operation result in customer-owned
storage with producer, input, query/snapshot and coverage information. Keep schema and
policy explanations once per request/context, not as a prefix repeated on every row
query. Large collections remain paginated; never put the entire database into a receipt
or prompt merely to preserve a result.

An initial `OperationReceipt` contains invocation ID, operation/version, status,
purpose, input/result references, snapshot identity, coverage, timing and any effect
receipt. Mutation receipts distinguish requested, admitted, completed and uncertain.
Actual data pages/results remain reachable under authorization. Tool argument/result
display is a projection; no consumer should reconstruct executable state by parsing a
truncated string. Context compaction retains exact receipt handles and active constraints.

For continuation after an error, recover those receipts before claiming prior work.
If the old receipt does not exist, say the earlier claim is unverified and re-query
only what is needed. A citation to an assistant message establishes what was said,
not a supplier, amount, event or completed action. Keep source kind, author role,
extraction/generation status and revision through retrieval and answer review.

### Schema-bound queries and result surfaces

Build query fields from the collection schema. Return machine-readable validation
issues with allowed fields and a schema handle; never invite open-ended guessing.
Return opaque continuation handles bound to query, environment, Store epoch and
snapshot. An agent's fabricated/stale cursor fails without silently restarting or
changing the query. A generic next-page operation consumes the handle so the model
does not synthesize pagination internals.

Use existing library/query/semantic viewers for a typed `ResultView` descriptor:
purpose/title, source receipt, collection/schema, selected columns, filter/sort,
snapshot, coverage, and authorized source/representation links. First surface types:
query table, calculation, document, task and Skill/run. Unknown schema gets a compact
inspectable fallback. No arbitrary model-supplied HTML, JavaScript or remote embeds.

Tables search/sort/page at the server over the declared selection; they do not pretend
that the visible page is the whole dataset. Distinguish documents, extracted occurrences
and normalized values/entities. “All values” requires a schema-backed occurrence view
and a coverage statement; an inventory count is not a result. Incomplete extraction
or indexing remains visible. Normalization must retain the original value, locale,
validation and field/source evidence. Missing or masked data is not a full identifier.

For each card, show what the operation answers, what its numbers mean, and its useful
result before technical detail. Calculations retain operand meaning, units, exact
selection, exclusions and source links. Document inventory appears prominently only
when requested or as a clearly labelled intermediate in expandable activity. Keep
unrelated diagnostic results out of the main answer area. Existing source-document
grouping and derived-data drilldown remain; do not restore a rail full of intermediates.

“Saved” requires a successful durable receipt and an open action. “Here is a table”
requires an actual table descriptor, not just a Markdown promise. “This Skill works”
requires a successful relevant run, not merely structural validation. Unsupported
operations become explicit ideal nodes or investigation work, not a misleading offer
to perform them after permission.

### Grounding and failure recovery

Keep deterministic checks for arithmetic/units, schema, target identity, evidence
references, actual execution state and budget. Use model review for meaning and
request coverage, with bounded evidence selected from exact receipts. Avoid a model
checklist round when only deterministic operation outcomes need reporting. Do not
remove review globally to improve latency; compare against seeded bad answers,
source ambiguity and held-out scenarios first.

One small review repair may run against the same evidence; it must not reopen or
repeat actions. Exhaustion leaves successful results visible with an honest incomplete
answer state and a continuation action. A factual substantive answer must not be read
aloud as verified before its applicable checks pass. The fast input acknowledgement
does not contain such factual claims and need not wait for this review.

Classify model failures at the gateway: cancellation, timeout, capacity, transport,
context limit, invalid request, incomplete generation and unclassified provider failure.
Retain request/response correlation, model/profile, token/byte counts and bounded
allowlisted error fields. Do not retain raw provider bodies that may echo prompts or
credentials. Retry transient availability once within the turn budget; retry verified
context exhaustion only after bounded compaction preserving tool-call/result pairs.
Do not blindly retry every 400 or label a hypothesis as its cause.

The user sees the useful result already obtained, the specific remaining obstacle and
one next action. No raw JSON toast, endless spinner, generic wall of apology, or
request to confirm a fact the user has already supplied. A broad new Intent begins
with one scope question, not opportunistic research across the workspace.

## 5. From repeated work to a Skill

Retain the case-first Studio foundation. Reconstruct a procedure from the user's
confirmed case, tool receipts, source occurrences and outcomes, including work spread
over older Intents. A prior model plan is not evidence that a manual action happened.
Show a compact case summary and examples for confirmation, then an editable flow.

Use the same installed Actor contracts for interactive calls, Skill nodes, solver
plans and agent authoring. A child Skill is one folded node with named ports and
version pinning. Show input → meaningful steps → result; advanced bindings, evidence
and raw definitions remain progressive detail. A hypothetical missing node is visibly
different and blocks productive activation until implemented or explicitly replaced.

Three actions have distinct semantics: inspect/what-if has no effects; an isolated
trial has explicit limits and no production subscription emissions; productive execution
stores normal results. Network/model use in a trial can still cost money or disclose
data and therefore requires the same relevant authority as productive work. Do not
call it safe merely because its artifacts are temporary.

Skillification retains the original example as a regression case, plus exclusions,
unknowns and more difficult variants. Changing a nested child creates a new pinned
version; it does not silently change active parents. A new variant previews overlap
with existing applicability conditions. Never enable two conflicting subscriptions
simply because both Skills match an arrival. Keep exact revisions, applicability,
source lineage and activation evidence inspectable by both people and agents.

The target remains gradual replacement of soft/model steps by specific Actors with
the same contracts and case tests. Do not implement an arbitrary script/WASM host as
part of this slice; leave executable offer/version identity and data contracts open
to such later implementations.

## 6. Performance as part of the product contract

### Measure distinct moments

Use propagated trace context and linked spans across input, API, model gateway,
Intent service, runner, Store and device. Durations use monotonic clocks within each
process; wall-clock timestamps support correlation, not subtraction across machines.
Trace IDs are correlation only, never authorization. The
[OpenTelemetry trace model](https://opentelemetry.io/docs/concepts/signals/traces/)
provides the foundation; map model-specific fields through a small adapter because
the [GenAI conventions](https://github.com/open-telemetry/semantic-conventions-genai)
are evolving.

| Span/milestone | What it separates |
| --- | --- |
| Speech endpoint, ASR final, input received | Microphone/recognition latency from routing |
| Candidate lookup, route queue/start/finish, decision rendered, acknowledgement audio start | Model computation from waiting and perceptible feedback |
| Human decision, admission commit, receipt rendered, input released | Human time from system time; optimistic display from durable acceptance |
| Per-Intent queue, turn lease, context assembly, model queue, first token, last token | Scheduling, retrieval and generation |
| Tool admission/start/finish, review wait/decision, publication and result render | Fast tool execution versus slow total response; server result versus usable UI |
| Verification/repair, first usable result, final answer, TTS queue/start/end/interruption | Time to value, review overhead, complete answer and spoken experience |

Include operation/model/profile versions, run phase, success/error category, retry
count, input/output/cached token counts when supplied, bytes/rows/pages and bounded
resource counters. Missing measurements are unknown, not zero. Cost is either provider
reported or an explicitly estimated amount using a versioned tariff; a local model's
cost is not zero just because no tariff is configured. Never invent compute-cost data.

No content, filenames, document titles, mailbox addresses, full URLs, prompts, secrets
or raw tool arguments in ordinary telemetry. Customer-owned detailed receipts remain
under customer access. Use bounded-cardinality labels; IDs can correlate restricted
traces, not become metric dimensions. Default to complete lightweight journey milestones
and failures, sampled detailed spans, configurable retention. Initial proposed defaults:
seven days detailed traces, thirty days aggregated metrics, independent from the
customer's content retention. Final deployment retention needs explicit operational
review; telemetry failure must never block admission or work.

Implemented response-level inspection now retains up to 32 content-free model
observations with the saved reply: phase, terminal state, monotonic elapsed time,
first content-delta time, and provider-reported input/output tokens when available.
The expandable “Modellzeit & Tokens” control is shared by both conversation views.
Missing usage remains unknown, including cancelled or rejected requests. The first
model text may be an unverified draft or a review result, not audible or usable
answer onset. Repeated input tokens are not context occupancy or cost. Full
versioned-context inspection and cross-service timing correlation remain planned.

### Initial UX budgets, to qualify rather than assume

- Local capture/press feedback: p95 at most 100 ms; typed controls stay responsive.
- Valid route plus visible understanding: p95 at most 1.5 seconds unloaded, 3 seconds
  with two background turns and an ingest job. Speech acknowledgement onset target:
  at most 2 seconds after final transcript when TTS is ready.
- At 3 seconds show a concise delay state; at 5 seconds expose retry/manual destination
  without losing input. Expired replies cannot silently assign it later.
- Admission acknowledgement after choice: p95 at most 1 second on the local stack.
  Narration interruption: target at most 200 ms. These are proposed product gates,
  not measurements established by the current probes.
- Simple task/query cases must show their useful committed result as soon as it is
  available, independently of final explanatory text. Compare first-result and complete
  answer p50/p95 against a recorded baseline; no blanket completion promise for OCR,
  mailbox backfill or complex research.

Use a trusted interactive route/reply lane at the gateway. The facade derives lane
and bounds from a dedicated authenticated endpoint; callers cannot label arbitrary
long requests interactive. Reserve limited capacity, fairly schedule other requests
and cap per-customer waiting. When model capacity is one, do not promise preemption
of an in-flight provider request: reserve a separate configured capacity or present
the bounded delay/manual path. Priority in one process does not reserve upstream GPU
capacity; loaded measurements decide whether this deployment can meet the budgets.

Report retries and failed attempts, not only eventual successes. Optimize measured
queue/context/checking overhead before adding another model or speculative execution.
Use feedback as diagnostic evidence, not an automatic authorization or global prompt
patch. Evaluate correctness, time, token use and human correction rate together.

## 7. Credentials, HTTP and mail through the shared framework

### Integration boundary and deliberate scope

Adopt the reviewed design from the `credential-capability-design` worktree, including
its uncommitted corrections to `docs/http-resource-actors.md`, the new
`docs/imap-mailbox-actors.md`, and `review-evidence/credential-capability-review.md`.
The inspected base was `8310bc3f`; re-diff those specific files before integration,
since another worktree is not a frozen release. Do not blindly merge its older runtime
or dependency tree. Update the owning HTTP/IMAP papers when implementation starts.

The first complete external slice includes authenticated HTTP reads, bounded historical
mail query/capture, deterministic MIME materialization and an explicitly enabled
new-mail Source. HTTP write requests are a subsequent bounded slice in this plan,
not falsely advertised by a GET/HEAD implementation. SMTP sending, mailbox mutation,
general crawling, full flag/deletion synchronization and arbitrary network scripts are
out of scope. Old .eml uploads use the same raw-message/MIME path without IMAP authority.

### Credential lifecycle and request authority

Register `ceo.aven:component:data:credentials@1`, schema `aven_credentials`, through the
existing customer component/provisioning system. Separate administration, metadata,
HTTP-use and IMAP-use roles. Entry is set-only through an authenticated connection
form. Chat sees an opaque authorized binding reference and label, never secret values.
No password entry, reveal operation or connection transcript belongs in a tool result.

For the explicitly requested local prototype, a separately configured plaintext
storage adapter is permitted in the customer database. The trusted form must state
that database administrators, backups and host access can expose these secrets.
Restrict the value column to set-only ingress and protected-use roles; metadata and
ordinary Actor roles cannot read it. This does not provide encryption at rest or
protection from the database operator. Prefer revocable, narrowly scoped test/service
tokens, never collect a master account password merely for convenience, and keep
secret values out of logs, model context, artifacts and general read endpoints.

Keep storage encoding/version behind the same secret-storage interface. The non-local
release gate remains authenticated envelope encryption with a per-secret data key:
ingress can wrap with a public key; only the protected executor/key service unwraps.
Private wrapping material stays outside customer database backups; encryption context
binds environment, record and version. Prove rotation, revocation, restore and a
one-time rewrap/re-entry procedure before that release. Select a reviewed implementation
at the security spike, not a home-grown cipher. Plaintext mode must be an explicit
local-only deployment choice, never a silent fallback after encryption fails. The
local exception does not relax executor isolation or use-capability checks.

The application policy authority, not an Actor or model, grants exact use: customer
generation, principal, Actor/version and invocation ancestry, protocol/operation,
canonical request digest, binding/secret/policy revision, destination scope, mode,
review/delegation, audience, expiry and aggregate budgets. Discovery is not authority.
Use claims are consumed durably immediately before dispatch, after waiting for capacity.
Rotate/revoke and claim order are serialized. Revocation blocks later claims; a command
already dispatched may finish. Verify current session/delegation status on admission
and claim or document a bounded revocation window; existing signature/expiry verification
does not establish immediate logout revocation.

Implement fixed protected HTTP and IMAP executors, separately authorized. They do not
load customer/Actor code or expose general secret resolution. Ordinary server Actors
call typed request ports; device placement forwards through the same boundary. Request
redaction, response release and audit happen there. An upstream server can echo a secret
inside its response, so provider admission and response-release policy are necessary;
generic redaction cannot promise secrecy against an arbitrary malicious provider.

### One review mechanism

Extend the shared runner's typed review-request, reviewer-attributed decision and
continuation mechanism. Do not add protocol-specific approval queues. Decisions bind
exact subject/request revision, permitted attempts, expiry, retention, processing and
model disclosure. Editing a request invalidates the decision. Duplicate replies are
idempotent; wrong reviewer/environment, stale decisions and revoked grants fail closed.

System-owned views render these reviews outside model-shaped content (section 1).
The UI shows account/service label, purpose, scope and data destination first. Details
contain technical limits. A finite import can be reviewed as a bounded selection;
unknown future messages require a separate explicit monitoring delegation. Reopening
a credential form or switching environment cannot transplant authorization.

### HTTP

Register request, capture, response-selection/inspection and materialization through
the normal schema bindings and Actor factories. Extend the generic publication port
to support bounded blob streams and actual evidence locators; payload-only digests
and empty evidence are not sufficient. Preserve request → observed response → selected
representation → derived file/value, including reuse and conditional responses.

Public API documentation can be fetched without a credential binding through the
same guarded HTTP port. Public does not mean unrestricted network authority: SSRF,
size, redirect and timeout checks still apply, and retrieved instructions remain
untrusted. The agent extracts a request proposal, identifies missing authentication,
and opens the trusted connection form. Only after a scoped capability exists can a
controlled test request run. A documentation page cannot grant credentials, approve
an effect, or change the policy for its example URL.

Version one allows GET/HEAD with exact origin/path policy and protected credential
injection. Network access uses validated DNS results pinned to the actual connection,
TLS hostname verification, denied private/metadata destinations by default, bounded
redirects and independent checks per hop. Do not forward authentication across origins.
Use explicit operator-configured loopback test exceptions, never a request-controlled
escape flag. Bound response, decompression, time and redirect bytes. These requirements
follow the [OWASP SSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html).

Partition reusable responses by environment, authorized subject/policy, credential and
binding revisions, request/representation selection and relevant Vary headers. An
offline reuse is labelled reuse/staleness, not a new observation. A 304 retains both
the conditional request and selected prior response as causal inputs. HTTP status and
validators follow [HTTP semantics](https://www.rfc-editor.org/rfc/rfc9110.html); a
successful connection is not proof that application data is correct.

Authenticated API writes use a distinct effect capability: allowed method, exact target,
typed/bounded body, preview, approval, provider idempotency/reconciliation policy and
redacted request digest. A timeout after send is uncertain, not permission to retry.
POST must not be smuggled into a nominally read-only fetch Actor. Start with a controlled
synthetic endpoint demonstrating this contract before any real write integration.

### Historical mail capture

Use `mail.imap-query`, query-result, selected-message-request/result, raw
`mail.message` and `mail.message-parts`, with explicit qualified-schema/Store mappings
from the reviewed mail paper. Query metadata and body read are separate authorities.
No “find invoices” promise from filename/sender alone: classification happens after
authorized capture.

Remote identity is account + mailbox + UIDVALIDITY + UID, not Message-ID or sequence
number. Freeze an upper UID fence at query start and scan bounded numeric windows.
Report complete/truncated/incomplete **within that declared scan**, not a transactional
mailbox snapshot. Read selected messages under EXAMINE/BODY.PEEK, without setting Seen.
Missing messages are explicit unavailable results; a different message is not a
substitute. Use TLS and a closed command allowlist, with per-command claims and limits.
These choices follow [IMAP identifier and fetch semantics](https://www.rfc-editor.org/rfc/rfc9051.html).

Commit raw message bytes before MIME processing. A deterministic, network-disabled
MIME Actor produces a parts manifest and file occurrences whose producer consumes that
raw message. Retain decoding/charset outcome, part paths and valid byte/field locators.
Equal attachment bytes do not merge different message occurrences. Bound part count,
nesting, decoded bytes and parser time. Active HTML, remote images and attachment links
do not execute. Initial credentials support TLS app passwords; OAuth consent/refresh
is a later explicit lifecycle, not a promise that an expiring pasted token will monitor
forever.

### Continuing Sources and the restricted inbox

Implement one durable Source supervisor over the runner repository: leases/fencing,
checkpoints, capture ledger, delivery outbox, cancellation and connection generations.
One logical worker per account/mailbox does not require one permanent OS process or
socket. Begin with bounded polling; add IDLE as a latency optimization after reconnect
and capture semantics are proved. Sleep/review holds no authenticated connection.

At activation, record a backfill range/fence and a separate new-arrival cursor. A slow
historical import must not block new arrivals or create gaps between those ranges.
For each observed UID, persist an outcome and idempotent publication identity; replay
committed Store receipts after a crash. Advance scan coverage only after capture or
an explicit terminal unavailable/excluded outcome. Oversized/failed messages appear
as issues, not silent skips or an endlessly blocking first message. Publication and
runner checkpoints are separate commits: recover by stable publication identity and
outbox replay, not a claimed distributed exactly-once transaction.

Source authority is a bounded, revocable delegation: account/mailbox, criteria,
query/read operations, periodic and aggregate budgets, destinations, expiry and allowed
downstream processing. It is not a stored interactive bearer token. UIDVALIDITY change
pauses and asks for a new epoch/backfill decision. A UID cursor covers additions, not
old flag changes, moves or deletions. Those require a later synchronization contract.

New unassigned mail and uploads enter the pinned restricted inbox. Only specifically
allowlisted deterministic, isolated inspections run there. Deterministic does not
automatically mean safe: parsers still have resource and active-content limits.
No arbitrary Skill trigger, LLM disclosure, link-following or credential use is
authorized by mail content. A person promotes/selects a batch into an Intent, or a
separately reviewed rule does so within explicit scope. Similar uncertain documents
extend a grouped review instead of creating one card per file. Sender strings alone
are not authenticated identity or safe promotion evidence.

Subscription admission requires production mode, admitted trust state, exact Source
and Skill revisions, valid delegation and causal-cycle/aggregate-budget checks.
Internal outputs, trials and control/review records must not recursively trigger
unbounded work. Delivery is at least once with deduplicated logical run admission;
new remote observations remain distinct even when bytes are equal. Pause stops future
admission; already dispatched work is reported honestly and separately cancellable.

## 8. Implementation slices and ownership

All slices remove replaced paths cleanly. No old schema reader, dual router, protocol
dispatch shortcut or compatibility migration layer is required. A reset is a separate
explicit operation; do not delete current customer data as an implementation side effect.

### Reconciled execution priority

Focused implementation evidence for the current, not-yet-bundled increment:

- Pending-response feedback: `/tmp/aven-pending-feedback-KOWsL6/evidence.json`
  proves actual browser controls, Qwen assessment and SQL persistence, including
  publication races, reload and manual overrides. The same classifier passed
  `/tmp/aven-input-feedback-smYTIu/evidence.json` (120 repeated cases) and
  `/tmp/aven-feedback-context-iAc4aE/evidence.json` (36 held-out context checks).
  This does not prove native rollout or acoustic transcription.
- Explicit navigation and bounded source-context carry:
  `/tmp/aven-input-navigation-Fr7Ngh/evidence.json` uses production browser admission,
  real Qwen routing/answers and SQL. It covers selection after persistence, a manual
  screen change during admission, new-Intent creation, an origin-reference handoff
  and a French continuation rebuilt from SQL. No customer conversation is replayed.
  This is not native authentication, archived-Intent navigation or voice proof.
- Logical source previews:
  `/tmp/aven-live-llm-skills/2026-09-20T11-36-43.188Z/evidence.json` qualifies real
  decoding/decomposition, Qwen descriptions, Rust Store provenance, text-range and
  PDF page-two rendering at 390/1280 px, and a failed-read retry. Logical pages do
  not request nonexistent blobs. This is browser/Store proof, not native admission.
- HTTP transport foundation: `/tmp/aven-live-http-boundary-439MGd/evidence.json`
  retains six real-Qwen/HTTP cases across English, German, French and Spanish,
  including stale unavailable data versus an observed zero and a missing resource.
  Earlier failed evidence is retained; an initially reported zero for an unavailable
  resource was not accepted. The corrected contract names the observation category
  separately from task completion and includes a stop reason.
  Real-socket tests separately cover TLS rejection, restricted addresses, bounds,
  incomplete streams, timeout and cancellation. The protected customer executor,
  durable claims, credential-aware cache partition, Studio and IMAP remain unproved
  and disabled; these results do not qualify connected-work release.
- Ordered historical recall: `/tmp/aven-live-history-retrieval-nOidSc/evidence.json`
  passes ten Qwen/SQL cases, including oldest/nth/latest speaker-specific recall,
  bounded carried context and retrieval of a shortened excerpt. It retains exact
  source reads, answers and timings; no tools failed. An earlier latest-message
  run hallucinated a quotation when no prior dialogue was supplied. The engine now
  explicitly distinguishes absent local history from absent saved history. This is
  not proof of native delivery or a general latency improvement.

The latest read-only ideas review adds mail-derived correspondent dossiers, mixed
artifact collections, stable identities across revisions, navigable typed previews,
and Skill-contributed views/forms. These extend the earlier knowledge and connection
requirements rather than creating another graph, UI engine or task store. Saving an
idea as a Todo is not implementation. The following order reconciles immediate defects
with those product goals; dependencies can move work earlier, but not waive its proof.

| Priority | Deliverable and reason | Proof before handing over |
| --- | --- | --- |
| P0 — retain feedback accurately | Capture the active response, defer its annotation until durable publication, and distinguish multilingual evaluations from consent/fragments. This is the feedback loop used to judge everything else. | Real Qwen across languages and held-out topics; first/pending/older targets; loss/reload/races; manual clear/reason wins; SQL ownership and chronology checks. |
| P1 — make everyday interaction dependable | Finish registered task views and receipt continuity; explicit navigation selects its target without stealing later focus; cross-Intent references retain bounded source context; recovered inputs remain editable/dismissible; results scroll with consistent sizing. | Native conversation → task/board → reload; multiple Intents and queued edits; explicit archive navigation; referenced-source handoff; narrow/large-result views. Never infer completion from an Actor success flag alone. |
| P2 — inspectable results and context | Typed source → page → extracted-value tree; shared preview descriptors in chat and artifact views; exact context/omission/usage inspection. Reduce raw JSON and ambiguous counts before adding more output types. | Real synthetic document/Skill outputs; every visible result opens the correct source/version; keyboard/scroll tests; no eager full-corpus reads; feedback refers to the same response from either view. |
| P3 — protected useful connections | System-owned credential/capability reviews, guarded public/authenticated HTTP and finite TLS IMAP capture, then continuing mail Sources. This unlocks the highest-value requested new workflows. | Agent and Studio use the same installed Actors against real controlled HTTP/IMAP servers and Qwen; no secret in model/log/artifact; revocation, uncertain effects, MIME and backfill/arrival boundaries. |
| P4 — one artifact/knowledge foundation | Generalize the existing revision proposal to logical artifacts, exact/current references and typed relations; make tasks artifact-backed without a second writable truth. Add dossier maintenance over evidence, not asserted profiles inferred from senders alone. | Compare-and-set head conflicts, pinned history, mixed lists, reverse navigation, source lineage, no duplicate writes, bounded queries and sender-identity counterexamples; existing task operations still pass. |
| P5 — reusable work surfaces | Bounded JavaScript transform Actor and declarative Skill views/forms using the existing runtime and preview registry. Specialized Actors remain preferred. | Same execution contract on client/server, invalid/hostile code limits, typed outputs, replay and lineage; generated UI cannot impersonate privileged controls. |
| P6 — workspace and sustained voice experience | One additional in-app environment, resumable setup templates, scoped host files and explicit continuous transcription. Keep each independently releasable behind its actual capability. | Atomic entitlement/provisioning recovery and isolation; conditional setup fixtures; filesystem escapes denied; real audio recording/pause/resume/stop, interruption recovery and context inspection. |

Performance spans and privacy checks accompany every priority. P3's shared review and
authority foundations may proceed alongside P2, but not as a protocol-specific bypass.
The latest handoff instruction supersedes incremental restart offers: keep incomplete
work in the isolated client, then bundle/start the customer version only after the
combined regression/workday is satisfactory or an unavoidable blocker is reported.
Preserve the running checkpoint and database until that handoff; permission to restart
does not authorize data reset. Check disk after service/native builds and stop owned
test processes. Remove only identified disposable outputs, not shared caches wholesale.

| Slice | Concrete changes | Exit evidence |
| --- | --- | --- |
| S0: observe and preserve | Add content-free timing/error correlation at input, gateway and turn boundaries. Fingerprint current builds/tests; retain failing synthetic evidence. | Can distinguish model queue, execution and review; original successful scenarios remain green; provider failure category visible without prompt leakage. |
| S1: input UX | `input-routing.ts`, `input-inbox.svelte.ts`, `InputRouting.svelte`, chat/window/listener integration; narrow route/reply contracts, topic acknowledgement, decision revisions, private drafts, independent pending inputs. | Native click and genuine speech choice/correction/cancel tests; no premature contribution; no lost input; loaded latency; small-screen/keyboard/large-text review. |
| S2: durable admission and work | Intent-service atomic admission/outbox; shared portable Chat engine; runner-backed turn lease/checkpoints; task component and one Todo adapter. | Kill/reload at every boundary; one admission/effect; tasks and queued work restored; independent threads continue; no client-token persistence. |
| S3: answer/result correctness | Typed operation receipts and continuation; schema/cursor handles; bounded review; result descriptors using existing viewers; purpose/source/coverage presentation. | Real-model continuation after lost context corrects unsupported prose; actual interactive table and clickable source; no fake saved output; quantitative and adverse-answer checks. |
| S4: protected external reads | Integrate reviewed credential/component contracts; key ingress/use split; guarded HTTP/IMAP executors; shared reviews; stream/evidence publication; HTTP read and finite mail capture Actors. | Real-Qwen agent and Studio use against controlled authenticated HTTP and TLS IMAP services; leak/isolation/revocation tests; exact raw/MIME lineage and unchanged mail flags. |
| S5: continuing and reusable work | Source supervisor/delegation/capture ledger; inbox promotion; mail arrival → nested Skill → Markdown/index or typed metric result. | Historical and new mail overlap correctly; restart/revoke/pause/epoch reset; isolated trial; duplicate arrivals; human refinement and versioned activation. |
| S6: bounded API effects | Distinct typed HTTP effect operation and review, provider idempotency/reconciliation policy. | Real-model request preview/approval plus synthetic API write; lost reply never duplicates or silently resends an uncertain effect. |

S0–S3 have the highest immediate UX return. S4 is shared groundwork, not a shortcut
to mail. S5 depends on S4 and the already durable runtime; do not launch a desktop-only
background loop as an interim substitute. Separate patches can land behind truthful
readiness flags, but final feature acceptance requires the combined workday.

## 9. Dry-exercised edge cases and decisions

| Situation | Required outcome / simplification |
| --- | --- |
| User types while the previous message routes | Keep separate input identities. Independent requests proceed; pronoun-dependent ones wait for that decision, not the entire running Intent. |
| Yes while a destination question is open | Resolve that input decision, never append yes as a business contribution. No means keep current only when that is the one clearly spoken alternative. |
| New request while a question is open | Do not consume it as consent. Route independently; keep the earlier question accessible. |
| New message is an amendment, not a new task | Amend the pending decision with revision checking; preserve original text and explicit correction. Ask once if genuinely ambiguous. |
| A queued message starts while its editor is open | Save checks current state atomically: replace waiting work, or stop the exact original run and insert its replacement before later follow-ups. Preserve settled effects; block on uncertain ones. |
| Destination renamed, archived, merged, deleted or access revoked | Revalidate on admission. Show the current target/alternative; never silently write to a different Intent. |
| Commit succeeds but acknowledgement is lost | Resolve the original admission key; show the existing receipt. Do not create a second Intent. |
| Reload after the model reports a task created | Re-read the durable task and receipt. No replay of creation to reconstruct the view. |
| Previous answer names an entity that no query supports | Attribute/retract the earlier unverified statement and inspect receipt/source lineage. Do not transform exact quotation checking into factual corroboration. |
| Query returns no rows during incomplete indexing | State scoped absence only; show coverage/recovery. Do not invent a later page or change the domain question into repeated broad searches. |
| Long research or model outage | Keep input usable, show measured stage, retain successful results and a bounded retry/continue path. No unlimited repair loop. |
| User asks for all instances, not a sample | Server-backed paginated selection and coverage; report extracted occurrences versus normalized distinct values. Never extrapolate from a prompt sample. |
| User corrects a date, quantity or intended deliverable | Preserve it as user input with source role; do not require it to occur in a document. Recalculate from explicit inputs, not a previous rounded answer. |
| A paid receipt needs association with a booking | Record evidence association, not a new payable or payment. Inspect the existing reconciliation domain before extending it; matching amount alone is insufficient. |
| Connection secret rotates during a queue/review | New claim rechecks version, policy and decision. No stale credential execution or cache partition reuse. |
| Mail vanishes after selection or arrives during backfill | Explicit unavailable outcome for the selected UID; new-arrival cursor remains separate and gap-free. |
| Store publication succeeds before worker dies | Recover committed receipt by logical publication ID, then finish checkpoint/outbox; no duplicate ingestion event. |
| Inbox content tells the agent to fetch a URL or change routing | Treat it as document content. Only trusted user input/admitted policy can authorize destination/effects. |
| Model step replaced by a hardcoded Actor | Preserve typed ports, source evidence and case suite; publish a new Skill version and test the same examples before activation. |

## 10. Acceptance: realistic variety, real Qwen, no customer fixtures

Use the real configured Qwen provider for every conversational journey, including
routing, correction, review, Skill authoring and recovery. Record the upstream model
behind its public alias. Test services may control protocol behavior and inject actual
network/process failures; they may not provide canned model answers or pretend a
tool executed. Deterministic contract/property tests remain necessary supplements.

Independently invent datasets. Do not rename customer documents into fixtures or copy
their distinctive amounts, names, routes or sequences. Query the test account/database
identity before every run. Customer diagnosis and test receipts stay separate.

Required scenario groups:

1. **Small requests:** workshop tasks, a correction to quantities, a short follow-up,
   explicit chat-only planning and accidental background speech. Verify exact durable
   effects and reload. No external research for a broad new discussion.
2. **Concurrent work:** two active Intents, queued dependent follow-up, unrelated new
   Intent, wrong-topic suggestion, yes/no/correction by voice and click, duplicate
   labels, environment switch, late result, offline/reload and lost admission reply.
   Exercise queued edits before dispatch, during model execution and after completion
   races, plus concurrent editors, lost Save replies and an in-flight mutation. Verify
   one replacement, preserved ordering and receipts, no stale answer publication,
   no repeated completed effect, and no interruption of another Intent.
3. **Ad-hoc analysis:** synthetic mixed-currency supplies, missing values, credits,
   duplicates and partially indexed sources. Ask colloquially, with typos, in German
   and English; request a real searchable table, then exact source, then a saved note.
4. **Faulty prior claim:** one unsupported earlier assistant assertion, a failed turn,
   reload and a request to continue/find its source. Verify correction and no invented
   identifiers, pagination or facts. Also test a genuine old receipt so the agent does
   not discard valid historical evidence merely because newer data differs.
5. **Manual to reusable:** three actual ad-hoc analyses → confirmed case → Skill with
   nested extraction/query child and Markdown reporting parent → trial → publish →
   new source arrival → result → challenging exception → variant → old-case regression.
6. **Connected work:** finite historical mail selection and new arrivals from a real
   isolated TLS IMAP server, attachments of mixed types and malicious instructions;
   authenticated HTTP report capture, conditional reuse, rotation and denied redirect;
   promotion from inbox and one deliberately approved synthetic API write.
7. **Very hard cases:** noisy spoken correction during narration, ambiguous yes after
   several pending messages, fifty-plus Intent candidates, large paginated collection,
   simultaneous OCR/backfill, interrupted review, two clients, two worker replicas,
   UID epoch reset and restore generation fencing.
8. **Context boundaries:** lengthy multilingual conversations on both sides of the
   application's recent-history boundary, plus requests measured with the configured
   provider's tokenizer immediately below and above its advertised context capacity.
   Distinguish durable conversation length from the bounded request actually sent.
   Check early user facts, recent corrections, speaker identity, exact old-message
   retrieval, valid tool-call/result pairs, completed receipts and queued follow-ups.
   A deliberate provider overflow must remain an explicit failed turn, not silent
   truncation, a fabricated quotation, lost input or permission to replay a mutation.
   Record actual input/output token budgets and re-test a smaller continuation after
   failure. Gateway-only capacity tests do not substitute for the native history path.

For routine routing, run at least thirty independently varied inputs with three
repetitions; for state races run the actual boundary interruption matrix. Fixed
wording success is insufficient. Hold back scenario paraphrases and datasets from
prompt tuning. Report every attempt and distribution, not the best run. Use semantic
outcome assertions, stored receipts, source lineage and rendered interaction checks;
an LLM judge can supplement, but cannot alone certify its own system.

Native voice gates must include actual audio through the configured ASR and TTS path,
with saved synthetic audio/latency evidence. The existing accepted-transcript event
proves only the post-ASR boundary. Test both hardware-accelerated normal use and the
software-rendered screenshot harness; screenshots alone do not establish scrolling
or CPU behavior. Exercise 390 px, ordinary desktop, 200% text, keyboard and screen
reader paths. Primary actions cannot be clipped, hidden behind a panel or require
hover. A short new-user walkthrough must establish that people understand the
destination question and result card without instruction.

Safety and durability gates allow no false success, unauthorized effect, lost accepted
message, duplicate mutation, cross-environment leak or trial-triggered production run.
Routine semantic cases must pass all held-out repetitions. Very hard semantic ambiguity
may resolve to a concise clarification, not an invented answer; known uncertainty is
not a failure if the user has an easy way forward. Latency misses remain visible and
block a claim of a qualified speech experience even if correctness eventually passes.

## 11. Evidence ledger and remaining qualification

### Current feedback and routing checkpoint

The latest feedback implementation separates destination routing from an optional
assessment after durable message admission. Combining both decisions repeatedly
misclassified task refinements and polite criticism. A saved, immutable check keeps
the eligible response IDs and conversational context, including when routing timed
out and the user chose a different destination manually. Feedback cannot delay
admission or overwrite an explicit vote, cleared vote or reason. Successful neutral
assessments have a hidden completion receipt; failed assessments remain unresolved.
The client retries a bounded number of times and recovers unresolved checks in loaded
history. This is not an unattended server-wide feedback backfill.

The API reserves one interactive slot when capacity exceeds one. At capacity one,
routing overtakes queued work with a bounded burst so work is not starved. Feedback
uses the work lane. This does not preempt an in-flight provider request or establish
provider-wide fairness across API replicas.

The current synthetic qualifications are:

- `/tmp/aven-input-feedback-XKpWzh/evidence.json`: 100/100 real-Qwen assessments
  over fifty independently invented utterances in eleven languages, plus SQL
  provenance, idempotency and manual-priority checks.
- `/tmp/aven-feedback-context-Ji0H20/evidence.json`: 36/36 held-out assessments
  across three multi-turn contexts with real-Qwen seed answers. These include
  feedback about an older reply, mixed praise and criticism, delivery failures,
  withheld judgment and ordinary clarification. Earlier runs missed praise of an
  older reply when judgment of a newer one was withheld. Target-first instructions
  corrected that scope error; those failed receipts remain retained.
- `/tmp/aven-input-decisions-UFp29L/evidence.json`: 171/171 routing/reply cases;
  measured p50 599 ms and p95 694 ms. These are written-input request timings, not
  microphone-to-first-audio latency or a guarantee under arbitrary provider load.
- `/tmp/aven-routing-priority-etJDsd/evidence.json`: real-Qwen dispatch tests at
  capacities one and three establish reserved admission and bounded priority.
- `/tmp/aven-feedback-recovery-DDn6VB/evidence.json`: production WebKit controls
  and recovery with real Qwen and isolated SQL. Routing timeout, cross-Intent
  admission, lost commit acknowledgement, manual override, neutral completion and
  reload recovery pass. Only native IPC is bridged in this test.
- `/tmp/aven-native-input-feedback-owZ6IS/evidence.json`: the actual desktop,
  passkey-authorized synthetic account, API, Qwen and customer database pass automatic
  feedback, visible provenance, unpress, changed vote, inline reason and reload.
  Later praise cannot replace a manual choice. The screenshots were inspected.
- `/tmp/aven-live-queued-continuity-a1vnd8/evidence.json`: eight real-Qwen/SQL
  queued-follow-up scenarios pass. Contiguous waiting inputs with the same context
  and speaker share one response while retaining their individual durable message
  IDs. Input count and character bounds prevent unbounded batching. This does not
  merge new input into an already running turn, implement queued editing or solve
  voice endpoint detection.

The local test checkpoint is frozen at
`/tmp/aven-feedback-priority-checkpoint-20260920-M12oWs`; its manifest records native
hashes, service images and qualification receipts. Identity and customer data were
preserved. Its standalone frontend server avoids mixing newer build HTML with older
checkpoint assets. The exact frozen native binary also passed a clean-profile startup
and native-IPC check. The full native release suite, acoustic voice journey and broader
connected-work plan remain unqualified; these focused checks do not replace them.

The first interactive handoff exposed a missing recovery-button regression. Clicking
a suggested destination supplied a Svelte proxy to the plain controller; its state
copy then failed and left the tray unresponsive. The isolated native reproduction at
`/tmp/aven-native-input-recovery-8gggD7/evidence.json` retained that exact failure.
The adapter now snapshots every object-bearing input boundary and candidate lookup
result. `/tmp/aven-native-input-recovery-fKdAFA/evidence.json` passes the repaired
development flow. `/tmp/aven-native-input-recovery-TBs63O/evidence.json` repeats it
against the actual frozen compiled frontend: real-Qwen suggestion, six saved drafts,
discard, suggested destination, exact saved contribution, edit, other-draft removal
and two reloads. Screenshots and source fingerprints are retained; no customer data
was used. The replacement local checkpoint is
`/tmp/aven-feedback-priority-checkpoint-20260920-SkzqAQ`, with unchanged native binary,
API/Intent images and customer data. The user's pending drafts were not deleted.

### Receipt continuity and new interaction gaps

The latest read-only interaction review confirms that better input admission does not
alone establish fluent execution. Explicit navigation can accept the right destination
without selecting its view. Feedback captured during an unfinished response currently
offers only older completed replies as targets. Short, unfinished reactions can also
receive a vote without a sufficiently expressed judgment. Treat these as separate
state/context defects, not reasons to add customer phrases to a classifier prompt.

Follow-up implementation must preserve an explicit navigation request through
admission without stealing focus after the user has moved elsewhere. An in-progress
response must be represented in feedback context rather than silently reassigned to
an older reply; any eventual annotation needs that response's durable identity and
the existing manual-priority/idempotency rules. Do not infer an evaluative stance
from an incomplete phrase or solely from an earlier failure. Retain speech endpointing
as its own qualification rather than claiming that queue coalescing solves it.

A subsequent read-only review adds these acceptance requirements, without copying
customer conversations into the test corpus:

- Preserve the source context when a contribution refers to something in another
  Intent. A destination title alone cannot explain an anaphoric request. Similar
  spoken names must not silently produce duplicate collections; a confirmed new
  destination is not evidence that duplication was wanted.
- Capture explicit feedback even when the first response has not finished. The
  current capture can omit the check entirely when no completed target exists;
  complaints about a running response can instead vote on an unrelated older one.
- Separate related-Intent links from destructive merging. Reusing an archived
  conversation or its outputs must not require merging two distinct pieces of work.
- Make saved task collections discoverable alongside other work results. Unifying
  their artifact representation is an architectural requirement still to design,
  not permission to add a second independently writable task store.
- Measure simple readbacks end to end. Observed data reads take milliseconds while
  the containing answers take much longer. The agent's claim that repeated reads
  alone explain the delay is not supported by those timings; model, queue and review
  spans must explain the remainder before selecting an optimization.

Native visual inspection also reproduced a window whose Actor reported success but
whose screen used the generic manifest renderer instead of its registered component.
The Intent surface now renders the registered component/subject pair. Qualification
must assert the actual list controls, a saved synthetic task, board columns and return
to the activity stream, not just a toggled window flag.

The follow-up conversation review reiterates the priority of protected HTTP and
IMAP. The requested target includes authenticated HTTP methods beyond reads, fixed
application-owned credential forms in a recognizable trusted area, and a separate
executor that resolves scoped capabilities without releasing raw secrets to Actors.
The complete written feedback explicitly permits an initially unencrypted local
customer-database adapter. Section 7 now records that local-only exception, exposure
warning and replacement boundary; the non-local encryption gate and protected
executor requirements remain. This does not authorize model-generated credential dialogs.

Another observed turn treated an architectural request for artifact-backed tasks as
permission to publish and execute a snapshot Skill. Its output was saved before an
answer-review failure. Reproductions must distinguish discussion of desired product
behavior from an authorized one-off export, and distinguish a verified saved output
from whether that output actually fulfills the request. Do not retry the write merely
because the final answer failed, or mistake a Markdown snapshot for artifact-backed
task identity and revisions.

The receipt changes pass `/tmp/aven-live-receipt-continuity-cHHjcx/evidence.json`:
five real-Qwen task turns through HTTP/SQL, saved-history reload, and six independent
positive/negative receipt audits. All task calls succeeded. The focused source-review
regression at `/tmp/aven-live-review-contract-Xh5v2Q/evidence.json` passes ten checks
covering primary-source precedence, past/current distinction, partial search,
embedded instructions and readable continuation. These are not whole-product or
speech-latency qualifications. The native journey at
`/tmp/aven-native-receipts-qXMosN/evidence.json` additionally passes actual saved-task
list controls, board columns and return to activity. The exact frozen frontend passes
the real-Qwen/reload check at `/tmp/aven-frozen-tasks-aueGIk/evidence.json` and is loaded
in the customer checkpoint `/tmp/aven-feedback-priority-checkpoint-20260920-byRE8d`.
These focused passes are not the full release gate. The native receipt reports one
recovered pure-calculation rejection, so first-attempt quality is not passing. Calculator
unit-prompt experiments did not reliably eliminate a recoverable first-call rejection;
their instructions were reverted and failed evidence retained. A corrected final
answer does not erase that first-attempt UX defect.

### Earlier focused checks

Recent focused checks (not completion of the broader connected-work plan):

- Source continuation and visible model phases pass the isolated native Qwen probe
  at `/tmp/aven-live-native-progress-PrcW3F/evidence.json`: every distinct synthetic
  document title and all three pages of a synthetic handbook are accounted for.
  This uses the production index/reader with invented source-provider text, not a
  customer import. Redundant search calls remain a latency concern.
- `/tmp/aven-live-review-contract-M4IQTm/evidence.json` passes all 30 real-Qwen
  positive/negative review cases, including page versus source completeness and
  independently scoped catalog searches.
- `/tmp/aven-input-feedback-tXH0JZ/evidence.json` passes 36 real-Qwen feedback cases
  and real-SQL source provenance, retry, reason and manual-clear checks. Earlier
  attempts incorrectly rated task clarification as criticism; the final contract
  requires a verbatim answer evaluation and keeps those failures as evidence.
- `/tmp/aven-input-decisions-1fJzCh/evidence.json` passes all 171 real-Qwen
  routing/reply checks, including duplicate Intent titles and OS locale handling.
  Measured request p50 was 696 ms and p95 1,041 ms; these are written-input test
  timings, not acoustic speech latency. The earlier 159-case run is retained.
- `/tmp/aven-native-input-feedback-WgX3oJ/evidence.json` passes the native input →
  real Qwen → saved contribution → inferred vote → manual clear/reason → reload
  journey. Earlier native attempts exposed an unsupported Linux `C` locale and
  follow-up ambiguity when synthetic Intents had identical titles. The input/API
  boundary now normalizes presentation locales; the router uses the selected ID
  and recent dialogue, not title uniqueness, for an ordinary follow-up. Failed
  attempts remain recorded. This proves written input and reload, not ASR/TTS.
- `/tmp/aven-live-history-retrieval-ukFi7E/evidence.json` passes four real-Qwen
  historical-message requests over 66 independently invented messages and
  interleaved activity. All four exact quotations and source reads were inspected.
  Runtime was 20–87 seconds, so correctness does not establish acceptable speech
  latency. This is production SQL/Actor/engine integration, not native UI evidence.
- `/tmp/aven-live-history-retrieval-c8cAew/evidence.json` repeats those four exact
  source/quotation checks successfully and includes source fingerprints. Runtime
  was 55–151 seconds during partially concurrent model work. Several initial drafts
  added unnecessary historical details or a wrong sequence label that the reviewer
  corrected; the final answers were inspected. One request searched globally rather
  than selecting its Intent, motivating a further cross-Intent distractor regression.
- `/tmp/aven-input-feedback-w0EnII/evidence.json` is a **failed** repeat: 34/36
  feedback decisions matched expectations, but two task clarifications were rated
  negatively. Persistence/manual-clear checks still passed. The earlier green
  corpus and native journey therefore do not establish reliable sentiment precision.
  Manual override remains essential; do not present the inferred vote as explicit
  user testimony or train procedures from it automatically.
- The cross-Intent extension at `/tmp/aven-live-history-retrieval-We03CQ` was
  interrupted and rejected in `manual-review.json`: its first quote was correct but
  its added explanation contradicted the message order. The following scenario
  exceeded five minutes. An experimental tool-description clarification was then
  tried in `/tmp/aven-live-history-retrieval-z0VktD`; first/nth requests each hit
  the new 240-second ceiling before completion, and the remaining requests were
  stopped. That speculative wording was **not retained**. These runs do not qualify
  cross-Intent history or acceptable latency; only the earlier bounded metadata
  correction is retained in the working tree.

During the latter experiment, a read-only ten-minute aggregate of the normal local
API showed twelve interactive timeouts and one interactive success, alongside
twenty-five completed work requests. The test used the same Qwen endpoint; provider
health answered but load metrics were unavailable. Shared waiting is observable,
but its cause and this probe's contribution are not established. Additional model
load was stopped. Owned test frontend/display processes and the now-empty isolated
PostgreSQL container were removed; the customer's running client, stack and data
were not stopped or reset. Failed evidence remains available.

The latest customer feedback adds a separate history requirement. First/nth-message
questions must retrieve the requested record even outside the current context.
The inspected failure made one history search but neither followed its continuation
nor read a message. History is newest-first and bounded to 20 search results; a
larger requested limit does not bypass pagination. The saved trace does not retain
the full result, so it cannot establish which previews the model actually received.
The shared search result now supplies explicit continuation arguments and explains
newest-first Intent-history ordering. Review metadata retains message IDs, roles
and contribution sequences even when a hit has no document title. Previously those
hits were dropped, so the reviewer lost the writer's evidence of chronological
position. Contribution sequences are not message ordinals: activities and assistant
messages must not count as user messages. Search excerpts still require an exact
message read before quotation. Retained metadata remains bounded and exposes omission.

Current conversation context also has fixed message/character caps. A future
budget-aware recent-history selection should reserve a compact, source-linked
goal/history snapshot identifying its coverage boundary and the searchable older
history. That snapshot must not replace exact retrieval or become independent
evidence of past decisions. That budget-aware snapshot, efficient direct ordinal
lookup and a structural HTML-query Actor remain unimplemented; do not equate the
source-pagination and review-metadata fixes with their delivery.

The authorized history reader now supports Intent-scoped message-role filtering and
oldest/newest ordering, with the selection bound into its cursor. This excludes
interleaved activity before the model counts human messages. Exact ordinal lookup
remains a possible extension; current pagination must still be followed. The existing
reader returns source IDs and bounded excerpts with continuation, not a second
conversation loop. Per-Intent contribution sequences are not cross-conversation
chronology or message ordinals.

### Context-capacity qualification

Capacity is measured with the configured Qwen server's own tokenizer and reported
262,144-token limit, not a characters-per-token estimate. The direct gateway probe
at `/tmp/aven-live-context-boundaries-TOmDPC/evidence.json` passed a 114-message
invented conversation at 98% and at the edge: 261,527 input tokens plus a 512-token
answer reservation left 105 tokens spare. It retained an early fact, a middle
correction, a recent German correction and the distinction between a draft and a
sent invitation. Oversized input and an excessive output reservation each returned
a typed context error; the next request
used the same single-permit gateway successfully. These are actual provider
boundary tests, not proof of native UI hydration or durable-worker replay.

The production conversation-engine probe at
`/tmp/aven-live-conversation-capacity-NlfWqL/evidence.json` passed the 23/24/25-message
recent-history boundaries and restored 120 messages whose unabridged history was
373,405 tokens. The bounded model request retained the latest correction. An
oversized host context after a completed calculation preserved the original input
and receipt, reported failure, and continued the queued follow-up without repeating
the calculation. The shared desktop/server request now asks for the provider's
streamed usage totals; these were present and positive for every successful case.
This observes the real persistence callback, not database recovery.

`/tmp/aven-live-history-retrieval-cyYsEq/evidence.json` additionally proves retrieval
of a fact beyond the recent-message excerpt limit. Qwen read the exact saved passage
and gave the requested brief answer. The first run at
`/tmp/aven-live-history-retrieval-aJ0lNn/evidence.json` also answered correctly, but its
test assertion wrongly required the whole original message instead of the relevant
passage; that failed result is retained. No model prompt change was needed for this
case. It required four tool calls and about ten seconds, not instant recall.

An additional real-provider diagnostic showed that input can fit while its requested
answer reservation exceeds capacity. SGLang reports this differently from input-only
overflow. The gateway now recognizes both exact numeric diagnostics without logging
the provider body or blindly retrying unchanged input. The capacity tests include
both cases. Native transport qualification is a separate gate; none of these tests
implements token-budget-aware compaction, durable queue editing or unlimited recall.

The complete eleven-case history rerun at
`/tmp/aven-live-history-retrieval-242rNt/evidence.json` passed with streamed usage
reporting enabled. Exact historical retrieval took roughly 7–19 seconds; questions
answered from already available recent or carried context took under one second in
this run. Those are measured cases, not a general latency guarantee.

The combined native run at `/tmp/aven-platform-proof.ErQgcD` exposed an independent
archive-navigation defect before reaching capacity checks. The model attempted to
restore an already selected archived Intent and hit a revision conflict. The host
misclassified that definite rejected write as an uncertain effect. Routing receipts
and tool descriptions now distinguish opening an archived conversation from moving
it back to the active list. The native journey additionally requires archive state
to remain unchanged on a return visit.

For Intent metadata/lifecycle commands, the host recognizes only the trusted native
`INTENT_VERSION_CONFLICT` envelope with status 409 and non-retryable classification
as a definite rejection. It refreshes the current Intent projection and lets the
model reconsider; it does not automatically repeat the write. Transport failures,
generic conflicts and malformed replies remain uncertain. The focused real-Qwen,
signed-HTTP and SQL proof at `/tmp/aven-live-intent-conflict-epxbRE/evidence.json`
passed English archive and Spanish restore requests with genuine intervening writes:
one rejection, one successful change, and all notes retained. Earlier harness runs
are retained: one omitted the native transport envelope, another omitted the usual
history tools and caused an extra unsupported lookup. Native and full-platform
qualification remain separate from this focused result.

The subsequent combined native run at `/tmp/aven-platform-proof.YhHPhb` passed all
nine live checks: feedback and manual override/reload, source-aware navigation,
French continuation, feedback targeting a still-running reply, archive navigation
without restoration, old-message retrieval, and signed native capacity requests.
The near-limit answer used 261,527 input tokens and took 44.5 seconds. Both overflow
forms returned `LLM_CONTEXT_LIMIT`/422 without retries; a small request then succeeded.
This is native transport evidence, not typing a full context window into the UI.
The old-message answer needed one answer-only repair and took 41.2 seconds; the
calculation sequence recovered from one invalid extra argument. Those costs remain
in the evidence, so this pass is not a claim of error-free tool use or low latency.
An intervening failed run at `/tmp/aven-platform-proof.kuu0cd` placed the new archive
assertion before the test actually archived the Intent; the assertion was moved,
not relaxed. Full-platform and live-provider checks remain separate required gates.

The expanded gateway probe at
`/tmp/aven-live-context-boundaries-RTBfd9/evidence.json` passed all seven boundary
cases and both continuation checks, including streaming through the production
decoder. The streamed edge response reported 261,527 prompt tokens and 43 output
tokens, matched the four expected facts, and finished normally. Both streaming
overflow forms returned the same typed non-retryable error. The smaller requests
afterward succeeded, proving permit release rather than leaving the gateway stuck.
Streaming reuses the exact measured conversation from the non-streamed case; its
lower latency is not evidence of a streaming speedup because provider prefix caching
is uncontrolled. The earlier run at `/tmp/aven-live-context-boundaries-TNd5pw`
failed a harness assertion: internal gateway errors do not carry the wire-level
`retryable` field. The probe now uses the production transport-error normalizer.

Full-platform fixture maintenance also removed calls to deleted Studio editing
tools in favor of `studio_author`, and added the current action-only checklist
recovery phase. These are controlled wiring scripts, not substitutes for real-model
quality tests. Their failed runs remain at `/tmp/aven-platform-proof.IKrwBx` and
`/tmp/aven-platform-proof.uWx5zg`; production did save and publish in the latter,
then truthfully reported the fixture's invalid verification response. No compatibility
aliases or relaxed product validation were introduced.

The next full-platform run, `/tmp/aven-platform-proof.o8DQti`, passed all three
Studio cases but failed when Artifact Store was killed at its 768 MiB container
limit during environment switching. Request-state cloning copied the entire
immutable schema catalog. The catalog now shares its immutable allocation across
requests. Under the same isolated 1,280-read workload, peak cgroup memory fell from
480,088,064 bytes in `/tmp/aven-artifact-store-memory-lc8vj7/evidence.json` to
174,821,376 bytes in `/tmp/aven-artifact-store-memory-bpmF26/evidence.json`. This
empty-workspace comparison is a resource regression check, not upload-capacity or
full-platform qualification; the combined gate must still pass.

That run's successor, `/tmp/aven-platform-proof.d84FGp`, passed the Store and
Studio paths but failed on public Git synchronization in managed hosting. A direct
checkout of the same public site under the same resource caps then succeeded in
9.8 seconds; no hosting timeout was relaxed. Full qualification remains open.
The native run at `/tmp/aven-platform-proof.e3E5Fn` also exposed cold tenant-pool
connection errors. A dedicated two-tenant probe reproduced 31 failed first reads
out of 64 at `/tmp/aven-artifact-store-pools-0v4YGF/evidence.json`, followed by
successful warm reads. Atomic installation of a lazy pool removes duplicate
connection attempts without holding a registry lock during network I/O. The same
probe passed all 192 reads at `/tmp/aven-artifact-store-pools-WyqCQF/evidence.json`.
Memory and cold-pool probes are now required by the Linux full-stack gate.

Response-level model observations passed the real-provider capacity rerun at
`/tmp/aven-live-conversation-capacity-tJQrNJ/evidence.json`. Its six cases include
the recent-history boundaries, large restored history, overflow after a retained
calculation, and cancellation after actual streamed text followed by a fresh reply.
The saved terminal records keep each request's phase, measured time and reported
tokens without leaking cancelled-request state into the next turn. English archive
and Spanish restore conflict recovery also passed with those observations enabled
at `/tmp/aven-live-intent-conflict-u58aVF/evidence.json`. Native database round-trip
and physical expansion of the inspection control remain a separate qualification.
The first native inspection attempt at `/tmp/aven-platform-proof.e3E5Fn` persisted
and restored the correct data but failed a harness expression missing its return
statement. Its recorded UI text contains the expanded measurements; the corrected
check still requires a physical open and close, with exact persisted observations.

The corrected native run at `/tmp/aven-platform-proof.LebUjU` passed all ten
live-model checks, including the persisted observation inspector and context
boundaries. Its outer runner subsequently failed because its shell file was edited
while running; this is not a passing complete gate. The following full-platform
attempt at `/tmp/aven-platform-proof.lbfeHV` completed all Studio cases but its
final persistence assertion reused an expired harness token. That assertion now uses
the signed-in native history reader and its normal token refresh, with the same
durability requirement. `/tmp/aven-platform-proof.xmdsBy` then passed seven native
stages (the separate live lane is skipped), both Store resource probes, and the full
installation/encrypted-recovery drill. No customer database was reset.

Inspection of long histories also identified a context-view rendering collision:
distinct messages with identical opening text shared a row key. Rows now use their
position within the captured request, preserving repetitions and order. The native
live lane checks every rendered message against the actual prepared request and
physically closes the inspector. Its description distinguishes the prepared answer
round from the full saved conversation, separate review requests and provider
transformations; it is not a full context-budget viewer.

The complete live rerun at `/tmp/aven-platform-proof.KpSYzR` passed all eleven
native checks and its outer runner. The context-edge request retained all four
expected facts at 261,527 input tokens, with 512 reserved output tokens and 105
tokens spare; it took 39.5 seconds. Both oversized-input and oversized-reservation
requests failed explicitly, then a small request succeeded. Prepared-history rows
with repeated openings rendered in exact order and the inspector closed normally.
The preceding `/tmp/aven-platform-proof.fqc1v2` attempt passed the earlier ten
checks but failed its inspector assertion: the harness read a nested tool-argument
element as message content. Selecting the row's own content fixed the assertion;
no production behavior or acceptance requirement was relaxed. The separate full
gate at `xmdsBy` and this real-provider lane now both pass. Acoustic speech latency,
token-aware compaction and the background native handoff remain unqualified.

The local checkpoint `/tmp/aven-context-checkpoint-20260920-IOBJWa` now contains
the frozen `26.9.20-local.1` executable, embedded frontend, matching runtime libraries,
image digests and qualification references. Its separate fresh-profile smoke check
passed the native bridge and identity gate with test hooks disabled. The Linux
installer CLI could not allocate its required file watcher on this workstation;
the direct native build used by the E2E suite succeeded without changing system
limits. This checkpoint is a runnable local directory, not a DEB/AppImage installer.
The four existing application services were replaced with the verified images while
preserving their exact environments. Identity and database containers were untouched;
the history count and component versions matched before and after. The customer
client was opened with its saved profile and automatic hardware selection. This
launch is a handoff, not additional customer-data test evidence. Background dispatch
and protected connectors remain disabled, and queued editing is still planned.

### Harness lessons: adopt only where the current evidence supports them

The latest authorized customer inspection exposes a task-list coverage mismatch:
the current writer receives the full bounded service page, but the answer reviewer
and restored history receive only its first retained rows. The stored projection
does disclose those omissions, yet the page still reports the service's exhausted
cursor. Follow-up answers then describe incomplete lists instead of completing the
requested organization, and can drift into an unrelated date discussion. Do not
copy that conversation or its task values into tests. Reproduce with independently
invented long task descriptions, multiple scopes and overlapping labels. Compare
writer, reviewer and restored-history coverage; require a usable continuation for
every omitted row, preserve action receipts, and test latest-request relevance.
The inspected task update contract also lacked reassociation: discussing a move
could not make it executable. The current implementation adds an explicit
revision-checked `intentId` update through the same command path, with separately
authorized owner/destination validation. It preserves identity and the command's
originating conversation instead of deleting/recreating tasks or moving the thread.
`/tmp/aven-live-receipt-continuity-yXUnGZ/evidence.json` passes the combined
seven-turn real-Qwen check and eight answer audits. After restoring saved history,
the Spanish instruction moves exactly two of thirty-six personal tasks, preserves
their identities and fields, and leaves the other thirty-four untouched. Missing
and foreign destinations are rejected even when no conversation cause is supplied;
the original command cause remains unchanged. Native interaction is a separate gate.

The shared Task Actor now returns whole-row list pages within 7,000 JSON characters,
with a continuation from the last returned row. The current writer and retained
reviewer/history evidence therefore receive the same page; immutable mutation
receipts are unchanged. An individually oversized row fails explicitly instead of
being silently skipped. `/tmp/aven-live-receipt-continuity-HId2KE/evidence.json`
passed six real-Qwen conversational turns and eight answer audits, including
thirty-six invented long records, personal/team separation, an exhaustive count and
a responsibility subset. Every expected ID was observed and no read changed task
state. The last answer took about 83 seconds and needed answer repair: the writer
claimed that no archived personal tasks existed without reading that selection.
The reviewer correctly required qualification. The resulting delay remains a UX
issue; removing that check would hide an unsupported claim, not improve quality.

`/tmp/aven-platform-proof.IUl2tj` passed the separate-process background gate:
actual worker termination after committed tasks, unchanged completed journal entries
and task receipts after restart, independent Intent progress, FIFO follow-up, and
queued work surviving both service restarts. The earlier attempts exposed two
harness defects (a Bun-only helper in Node and excessive login refresh) and a
transient socket closure on a read after restart. The final run did not need a read
retry; its cause is not established. The harness now retains timings for any such
failure and permits only bounded read reconnection, never blind write retry.
Native background handoff, renewal controls and the other enablement prerequisites
remain unqualified; the customer composition stays on its prior foreground path.
The task manifest's typed ports also do not by themselves install productive tasks
in Studio. The current server catalog registers document/runtime Actors; Tasks are
bound separately to interactive and delegated chat. Productive Skill installation
must use the same authorized task repository and immutable receipt resolver under
the Skill's bounded authority. Do not bypass that missing authority with direct SQL
or advertise the manifest as an already executable nested Skill.

The task follow-up at `/tmp/aven-live-receipt-continuity-JFKrZb/evidence.json`
passed eight real-Qwen turns and eight answer audits. It also stores three French-
requested initial task states in revision one, with no later update or unrelated
change. A two-task move took 143 seconds, mostly in two answer reviews. The first
review correctly rejected an unsupported current-count claim; disabling that check
would hide an error rather than qualify a latency improvement.

The full platform gate at `/tmp/aven-platform-proof.CW1xok` passed native interaction,
customer isolation, two runtime upgrades and encrypted fleet restore after database
and configuration loss. Its native model is a controlled fixture, not real Qwen,
and this run predates the initial-task-state change.

Three later real-Qwen native attempts remain failed evidence. `0UN6WO` inspected
the most recent answer-repair request instead of the earlier history-bearing request;
the harness now captures the actual request and rendered messages while that request
is active. `LiMOso` exposed a genuine create-task mismatch: the model supplied an
explicit `open` status which the schema rejected, then recovered. The shared create
contract now accepts an optional initial status and still rejects unknown fields.
`QF5Bog` created and moved the task correctly but routed the Spanish instruction to
the action's destination, despite being told to stay in the source chat. Routing
guidance now distinguishes conversation placement from object placement; the native
check fails directly on unwanted navigation instead of waiting for an answer in the
old view. `/tmp/aven-platform-proof.qMXxCZ` then passed all twelve native checks,
including task identity/field preservation, unchanged source-chat selection, the
registered list after reload, and the actual native context-edge/overflow/recovery
requests. Both task and inspector screenshots were inspected. This run predates
the later structured routing-instruction change.

The broader real-Qwen routing attempts `zm2DQn`, `tf3AfT` and `IubeVA` remain
failed evidence. Prompt-only clarification did not consistently distinguish a
stored-object target from the requested conversation context, while preserving
explicit new-Intent and ordinary follow-up behavior. The bounded route result now
classifies that distinction before selecting the destination; inconsistent results
are rejected before admission. A French test phrased only as the purpose of a new
conversation was also ambiguous about whether to execute a comparison; it now
explicitly asks for the comparison instead of treating a valid scope question as
a failure. The original topic-opening contrasts remain in the suite.

The later routing runs `YqsvC5` and `JuENVR` exposed inferred topic changes being
treated as explicit directions and correct scalar decisions rejected for trailing
newlines. The route now quotes an explicit direction before classifying it, checks
that phrase against the contribution, and normalizes only declared scalar decision
tokens. `qF98fS` passed 207 repeated decisions. The held-out `F6apvS` found only an
ambiguous French work-versus-setup oracle; its replacement explicitly separates
those requests. `AHrwSC` passed 234 decisions (median 545 ms, 95th percentile 629 ms).
The native `sivaEb` then found a separate contract defect: a correctly routed short
appreciation had an empty topic label. Presentation-only text no longer invalidates
an otherwise valid destination. `vqLCxj` passed the 234-case suite with the native
journey sharing Qwen (median 643 ms, 95th percentile 1,654 ms).

`/tmp/aven-platform-proof.VEwhO3` passed all twelve current native checks, including
the acknowledgement/feedback path, task moves across reloads, context inspection
and actual context-edge/overflow recovery. Task and inspector screenshots were
inspected. The native edge request contained 261,527 input tokens against Qwen's
262,144-token capacity, reserving 512 output tokens, and answered the retained facts
correctly in about forty seconds. Output-reservation and input-only overflow were
rejected, then a fresh request succeeded. This is bounded synthetic history supplied
through authenticated native IPC, not 114 separately spoken or typed turns.

The subsequent full platform proof at `/tmp/aven-platform-proof.y3yDQr` passed
seven controlled native/browser journeys, service persistence/isolation checks and
the hosted lifecycle proof, including encrypted fleet restoration after database
and release-configuration loss. Its model responses are controlled fixtures, not
Qwen evidence. `/tmp/aven-platform-proof.amVNVG` repeated the seven controlled
journeys after the answer-review policy change below. The earlier full attempt
`uX0Q21` failed while resolving Debian package mirrors during an image build; an
unchanged retry passed. Keep that infrastructure failure distinct from a product
regression or a successful test run.

The disabled HTTP foundation now pins binding and secret versions, partitions cached
responses by current host policy and productive/trial scope, and requires current
artifact access before cached/offline release and after `304` revalidation. It rejects
changed versions/policy during an acquisition instead of combining old validators
with new authority. The host access/index adapters and durable use claims are still
unimplemented; this does not enable customer credentials. The package's 79 contract
and real-socket tests pass. The expanded real-Qwen/HTTP evidence at
`/tmp/aven-live-http-boundary-c47HLr/evidence.json` passed all thirteen structured
boundary assertions, but manual inspection found a wrong-language receipt and an
incorrect explanation of key rotation. Cause-specific diagnostics corrected the
rotation explanation in `/tmp/aven-live-http-boundary-v0jPLX/evidence.json`; another
receipt still switched language. These runs qualify acquisition boundaries and
structured facts, not final user-facing delivery. Productive connection integration
must use the shared answer/review path and test language and prose as well as fields.

That conversation experiment exposed a generic integration gap: a new read tool
could supply observations without activating the shared answer review, because it
was not among the existing tool names. Tools can now declare the host-owned
`answerReview: required` policy. It is not sent to the model provider, cannot be
enabled or disabled by a tool response, and does not weaken existing mandatory
checks. A malformed or failed observation still activates the declared check;
evicting old receipts does not erase it. The experiment uses this same policy and
production ChatCore, not a separate answer implementation.

Real-Qwen inspection also caught a `404` being overstated as proof that the
underlying data did not exist. The HTTP package now supplies status-specific
diagnostics beside observations, distinguishing transport success, partial content,
missing/undisclosed resources and unknown domain values. This follows
[HTTP status semantics](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.5.5),
not an incident-specific prompt rule. The package's 100 contract and actual-socket
tests pass. The latest conversation evidence is
`/tmp/aven-live-http-conversation-ZQ2lPs/evidence.json` and
`/tmp/aven-live-http-conversation-sHlWeF/evidence.json`: twelve independently
invented requests across eight languages, using actual authenticated HTTP and
Qwen, with production answer review plus a separately retained answer audit.
They cover a count, a genuine zero, `404`, denied access with no provider request,
an oversized body with no content release, and credential rotation followed by a
newly authorized read. Each permitted case makes one actual provider request;
rotation requires two tool attempts because the first stops before network access.
Both suites passed their automated assertions. Manual review accepted the alternate
suite but rejected the standard German `404` answer: it implied that the domain
count was not recorded and access was denied, which the response does not prove.
That run is therefore not accepted answer-quality evidence despite both automated
auditors passing it. The status diagnostic now explicitly distinguishes unobserved
domain values from absent records and an unestablished refusal cause. A simple missing-resource
explanation still took forty seconds in one run; this is not speech-latency
qualification. The host read port and Vault remain test adapters: these results
do not establish installed HTTP Actors, durable credential storage, Studio use or
customer-facing connector availability.

Failed experiments remain evidence: `QY4hNI` exposed missing review activation;
`7QnDqa` exposed an unclear recovery prerequisite; `OIBnt8` exposed the `404`
overclaim; `B9Ne14` returned malformed audit output; and `D9EkrM` exposed an
ambiguous body-release receipt. The independent audit permits one JSON-format
retry, retaining both attempts, but never retries a valid rejection until it passes.
The body-release result now explicitly records that no body was released rather
than relaxing the answer oracle. Initial passing runs do not invalidate these
failures or prove all HTTP prose correct.

A result-first opening was tested as an experiment-only alternative to the
universal five-word first sentence. `VYcb3D` (current rule) and `GQIQ66`
(candidate) both passed the first six scenarios with the same tool/model call
pattern and one answer repair each; `8ZkVso` later passed six alternate candidate
scenarios after diagnostic corrections. Some responses read more naturally, but
latency varied and spoken interaction was not tested. The production instruction
is unchanged; no causal performance improvement or voice qualification is claimed.

The comparison inspected pinned upstream implementations, not assumed capabilities:
[OpenCode edit diagnostics](https://github.com/anomalyco/opencode/blob/83abc64a5c4e0e0a5157f2c4435d34131009a404/packages/opencode/src/tool/edit.ts),
[OpenCode repetition detection](https://github.com/anomalyco/opencode/blob/83abc64a5c4e0e0a5157f2c4435d34131009a404/packages/opencode/src/session/processor.ts),
[DeepSeek prompt composition](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/core/system-prompt/src/index.ts), and
[Hermes procedure guidance](https://github.com/NousResearch/hermes-agent/blob/8a92051f20e6b371c4ff1a46a5bcec7138cc4e8c/agent/prompt_builder.py).

| Lesson | Current decision and acceptance boundary |
| --- | --- |
| Useful tool feedback | Adopt concrete missing information at its owning tool/result boundary. History results now preserve ordering, continuation and review metadata. Mutation receipts must distinguish the committed operation from the user's requested outcome; a generic success wrapper must not invent validation. Add schema-specific postconditions only where an existing validator or readback can actually establish them. |
| Recoverable exceptions | Preserve the existing shared Actor behavior. Read/view and trusted pure-transform exceptions already return structured failures; known pre-effect rejections are correctable. A dispatched mutation with unknown outcome remains uncertain and requires its receipt. Do not add a blanket catch/retry to the outer conversation loop: it can swallow lease, authority or persistence fences. A new retry needs a demonstrated missing case and an observable no-duplicate-effect test. |
| Specialist instructions | Prefer capability-owned guidance close to the tool and reviewer over adding rules to every answer. The result-first opening experiment above is not adopted: it does not yet establish a latency benefit or spoken-interaction quality. Do not introduce a prompt-plugin framework solely to reorganize text. |
| Lack of progress | A candidate guard should compare normalized arguments, new evidence IDs/cursors and outcome revisions, excluding explicitly declared polling. First instrument and replay held-out traces; repeated empty results should suggest a changed query, not grant authority or blindly retry. No new automatic loop gate is enabled by this review. |
| Learned procedures | Defer automatic learning. A reusable procedure needs original evidence, version/review state and regression cases, and cannot enlarge a Skill's authority. One incident or inferred sentiment must never silently become permanent instruction. |
| Whole-interaction evaluation | Keep exact source/outcome assertions, manual answer/UI review, failed attempts, tool counts and phase timings together. A correct quote with an unjustified refusal is a failure; a correct answer taking a minute is not a qualified speech interaction. Use independent synthetic scenarios, then held-out languages/roles and interruptions. |

The initial paired experiment is retained at
`/tmp/aven-tool-feedback-experiment-t3uvNg/evidence.json`. Two history requests ran
with and without extra ordering/continuation feedback. The baseline first-message
answer quoted the right message but unnecessarily denied certainty; the baseline
seventh-message answer quoted the sixth. The richer results answered both requests,
but the seventh-message run took longer (about 79 versus 42 seconds). A naive
substring assertion accepted the first baseline despite its poor answer; manual
inspection rejected that UX claim. This small exploratory run supports the targeted
history correction, not a general causal latency claim or adoption of all six ideas.

The separate clarification-feedback comparison at
`/tmp/aven-feedback-clarification-CKLRqV/evidence.json` made 48 real-Qwen decisions
over independently invented evaluations and task directions. The existing wording
passed 20/24; a more explicit candidate passed 23/24 but still incorrectly downvoted
a request for a shorter explanation. That candidate was **not adopted**: a reduction
in this small sample is not proof that the boundary is dependable. The first harness
attempt failed a required output-schema-name check before classification; it was
fixed in the experiment, not hidden as a model failure. Further precision work must
hold out new contexts and paraphrases rather than accumulate incident-specific rules.

That earlier checkpoint did not include the history metadata correction. The newer
checkpoint above includes the current working-tree frontend; the broader
connected-work qualification remains open.

### Earlier evidence and open qualification

New local evidence from this review is temporary and synthetic:

- Native parallel journey: `/tmp/aven-live-parallel-intents/2026-09-18T23-01-19.283Z/evidence.json`;
  eighteen completed checks, no recorded failure. Its current receipt has no unified
  `passed` field; process exit and check inventory were inspected as well.
- Responsive receipt rendering: its `input-ui/proof.json` and screenshots, 390/1280 px.
- Native diagnostic: `/tmp/aven-spec-review-ZPoPPP/native-probe.json`; eighteen route
  results, actual task-before/after-reload state, pending choice and accepted-transcript
  state. This is a diagnostic finding, **not** an all-green acceptance suite.
- Confirmation experiments: `structured-routing-probe.json`,
  `structured-routing-probe-v2.json`, `structured-routing-probe-v3.json` in that directory.
  They test proposed prompts/contracts through the actual gateway, not implemented UI.
  The first two exposed language/shape weaknesses; the final narrow classifier produced
  ten semantically appropriate completed responses and two timeouts. No speech-quality
  guarantee follows from these results.
- Real stream/production Chat recovery: `/tmp/aven-live-model-recovery-1789773149595.json`.
- Focused knowledge journey:
  `/tmp/aven-live-llm-skills/2026-09-18T23-14-29.629Z/evidence.json`;
  six conversational checks passed, including creating, publishing and productively
  running a Skill. The receipt reports `synthetic: true`, `passed: true` and no failure;
  the process exited successfully. This was production Chat/Store/Runner code with
  real Qwen, not a native rendering or full authentication test. The verbose schema
  answer still fails the intended UX standard. The first invocation lacked a required
  endpoint environment variable and stopped; it is an environment failure, not a
  product pass.

Retained earlier workday and feedback receipts establish useful existing coverage,
not newly executed proof. Promote independent diagnostic scenarios into privacy-reviewed
reproducible regression tests; do not copy private diagnostic content or credentials.
Standard execution prerequisites and commands
remain in [Build and test](operations/build-and-test.md).

Implementation qualification on 19 September uses independently invented data:

- `/tmp/aven-input-decisions-Tg4UvA/evidence.json`: 159 route/reply decisions passed
  across repeated varied cases. The median was about 540 ms and p95 about 649 ms.
  These are model decision timings, not ASR/TTS or loaded native-input qualification.
- `/tmp/aven-live-durable-tasks-WeCsEQ/evidence.json`: 19 real model requests,
  durable task receipts and scoped service checks passed. Responsive task cards were
  inspected at 390 px; this component journey is not a native background-chat handoff.
- `/tmp/aven-live-dispatched-chat-KMYFyT/evidence.json`: 19 streaming model requests
  plus route calls passed through service-authenticated HTTP, signed discovery,
  admission, lifecycle, publication and task boundaries. This includes independent
  Intents, FIFO, lost acknowledgements, fenced journal recovery, unpublished-result
  supervision, no duplicate task, uncertainty, expiry and service unavailability.
  The host composition is isolated and in-process; it is not deployed startup or a
  full native workday. The original single-version readiness check failed after the
  supervision index changed the catalog; readiness now consumes that shared catalog.
  A later failed test had a single-page helper used after creating multiple pages;
  the corrected test retains the actual multi-page worker checks.
- `/tmp/aven-live-llm-skills/2026-09-19T14-21-00.321Z/evidence.json`: real-Qwen
  mapping of three independent statement layouts, human confirmation, productive
  transactions, ideal-node case planning and case refinement passed. The preceding
  `2026-09-19T14-12-57.779Z` run failed because a full case rewrite lost its predecessor.
  `studio_case_revise` now requires the predecessor for either incremental changes
  or a full rewrite; new proposals use `studio_case_propose`. Shared authoring keeps
  the originating authority/cancellation context on every subrequest. This is not
  proof of native Studio rendering or protected external connectors.
- `/tmp/aven-live-dispatched-chat-QvsfXK/evidence.json`: 33 real model requests
  passed the isolated conversation/recovery journey with queued/accepted/completed
  state read through the authenticated facade. Archived human corrections and
  feedback remained available without moving the conversation or failed tool calls;
  long text was read at a nonzero offset. This does not require sequential page
  traversal; Unicode continuation has a separate service-boundary assertion.
- `/tmp/aven-live-durable-tasks-51Nu8Q/evidence.json`: 18 real model requests passed
  task persistence and the actual Svelte task controls, including identical native-
  adapter/delegated preview responses. One verifier completion exhausted its budget
  after about 54 seconds; its verifier-only retry succeeded without repeating the
  task mutation. Retain this as a latency defect, not a clean speech UX pass. The
  native binary compiled after adding the preview command; native interaction with
  a matching rebuilt Intent service remains unqualified.
- `/tmp/aven-live-dispatched-chat-WZfeOd/evidence.json`: 34 real model requests
  passed with the real Rust Artifact Store, signed delegated knowledge queries,
  current membership withdrawal, paused execution and ended-authority denial.
  Scope escape and write attempts were rejected. The preceding `t5eus3` attempt
  exposed an incorrect expectation of a facade error code at the Store boundary;
  the adapter now uses the actual Store error contract and redacts other bodies.
- `/tmp/aven-live-dispatched-chat-Mpj3da/evidence.json`: 37 real model requests
  passed, including a committed task with its acknowledgement held across Intent
  archival/restoration. No later model call or duplicate task occurred; restored
  work retained its FIFO barrier. An ended unbound runner admission retired instead
  of remaining in restart discovery. This is not yet the user-facing stop/settlement
  journey. A subsequent `4niIXR` run completed the earlier tasks but exposed a test
  observer racing its own evidence write before holding the publication reply; the
  observer now waits for that explicit boundary instead of assuming it was reached.
- `/tmp/aven-live-dispatched-chat-SYEWZd/evidence.json`: 36 real model requests
  passed with authenticated queued/bound Stop commands, immutable command retries,
  scope and closed-body checks, and no execution of a withdrawn earlier request.
  The saved action remained; no subsequent model request ran under withdrawn work.
  The earlier `Cmt4vR` run expected 403 for a foreign turn but received the intended
  non-disclosing 404. The `kC8ZA6` run failed a real UX assertion: a count-only answer
  was too verbose. The shared guidance now uses one summary query and a short answer,
  and does not infer business-record uniqueness from distinct artifact IDs. The later
  answer took about 11.8 seconds including review, despite its query taking about
  41 ms; this is not a speech-latency qualification.

- `/tmp/aven-live-dispatched-chat-TX3k6t/evidence.json`: 39 real model requests
  passed requested Stop settlement, immutable settlement receipts and FIFO release
  only after the executor and tool journal settled. A lost action acknowledgement
  retained uncertainty without repeating the action. The preceding `u7vleA` attempt
  correctly denied the API role direct journal access; status now reads only a
  security-barrier boolean view. The later test also verifies that journal contents
  remain inaccessible to that role.
- `/tmp/aven-live-dispatched-chat-yokYW2/evidence.json`: 37 real model requests
  passed the same journey with host-only guarded publication against the real Store.
  The test lost a successful publication acknowledgement, recovered its original
  receipt and bytes, replayed unchanged material, rejected changed material and denied
  writes after Stop. This is a transport boundary probe inside a real-model-owned
  turn, not proof that the agent already has the full server Studio tool host. The
  verifier corrected an unsupported claim of complete history coverage before the
  answer was published; the final answer retained only the established fact.

- The extended Studio journey initially failed before authoring in
  `/tmp/aven-live-dispatched-chat-E7Zw27/evidence.json` (29 real model requests):
  Qwen copied an earlier question's checklist and quoted a no-longer-retained source.
  Historical research state is now excluded from the next turn, not erased from
  its saved diagnostics. `/tmp/aven-live-dispatched-chat-Cvgk8Y/evidence.json`
  (25 requests) then exposed a different failure: a matching search snippet had no
  exact full-read offset, and the model tried to cite a page it had not read.
  Search now supplies that navigation and failed quotation checks describe retained
  page coverage. Neither failed run counts as accepted journey evidence.
- `/tmp/aven-live-dispatched-chat-qL0J1V/evidence.json` (53 requests) passed both
  history follow-ups and initial Skill publication, but failed same-Skill refinement:
  the model copied the published artifact into a second draft instead of editing the
  existing one. The agent receipt now retains one immutable definition plus the
  editable draft identity and an explicit successor-versus-variant distinction.
  The result remains a failed journey. Contract tests are supporting checks, not a
  substitute for real-model proof.
- `/tmp/aven-live-dispatched-chat-khJVYH/evidence.json` (29 requests) failed the
  count-only speech check: the correct number came with unrequested caveats and
  assurances, and the reviewer accepted it. Requested brevity now belongs to the
  shared request-scope contract used by both writer and reviewer.
- `/tmp/aven-live-dispatched-chat-V5oNBK/evidence.json` (51 requests) passed the
  combined journey, including both history follow-ups without failed tools, the
  short count answer, saved Skill authoring, same-draft refinement, unchanged public
  settings and immutable predecessor lineage. The answers and diagnostic receipts
  were inspected. The test explicitly excludes child execution, interrupted Studio
  mutation recovery and native UI. Subsequent dependency and scenario changes need
  their own run; this receipt records its original source fingerprints.
- `/tmp/aven-live-dispatched-chat-K06GDK/evidence.json` (65 requests) passed the
  extended journey with an intentionally separate variant, a fixed title and one
  remaining editable setting, and an actual nested published-Skill reference. It
  verifies origin and child lineage and no execution. All four authoring answers
  were inspected. They are factually supported but still overexplain schema details;
  concise completion presentation remains a UX follow-up. This run predates the
  atomic draft-receipt change and does not prove its recovery behavior.
- `/tmp/aven-live-dispatched-chat-QbBLLA/evidence.json` (63 requests) passed the
  same combined journey while losing a real Qwen rename reply before its tool
  checkpoint. A replacement worker recovered the original immutable save receipt,
  published that revision and completed without a duplicate edit. The API cannot
  read the receipt table, and the worker cannot update or delete its snapshots.
  Four supporting PostgreSQL checks separately passed rollback on receipt insertion
  failure, concurrent delivery, later-head changes and execution/identity fences.
  This receipt predates subsequent completion-copy and aggregate-capacity changes.
  The earlier schema-pin setup failure at `L3Fe8e` made no model requests; it was
  fixed by keeping the new schema target and runtime range aligned, with a catalog
  regression preventing that mismatch.

- `/tmp/aven-live-dispatched-chat-vqMbMJ/evidence.json` (67 requests) passed the
  bounded draft-receipt journey, but manual review still found verbose operational
  answers. The next run, `ll20b0` (63 requests), proved the added publication
  interruption assertions but failed its stricter concise-completion gate. It is
  retained as a failed journey, not accepted end-to-end evidence.
- `/tmp/aven-live-dispatched-chat-8f3xuS/evidence.json` (61 requests) passed the
  combined journey with both draft and Skill-publication interruption recovery,
  no repeated publication request, variants, actual nested references and short
  operational completions. All four authoring answers were inspected. Shared
  writer/reviewer guidance now separates a completed action receipt from a
  requested explanation; details remain inspectable. This still excludes child
  execution, case-proposal recovery and the native background-chat handoff.

- `/tmp/aven-live-background-chat-2Xmkva/evidence.json` passed the opt-in production
  function composition using signed services, real SQL/Store and Qwen: independent
  Intents while another model request is delayed, FIFO follow-up task changes, cold
  queue discovery after worker reconstruction, exact calculation and shared Studio
  authoring/publication. All five answers were inspected; none has a failed tool
  call. The preceding `eMUYS5` attempt exposed pure calculation rejection being
  treated as an uncertain write. Recovery now distinguishes trusted pure transforms
  from effectful methods. This remains an in-process service fixture, not deployed
  entrypoint, separate-process restart or native handoff proof.
- Case-publication recovery attempts `YtOC6o`, `3sWzEe` and `wGSZTH` remain failed
  journeys. They exposed, respectively, an interruption-harness assertion occurring
  before an actual effect; a proposal that weakened a required human-review rule and
  an answer-only repair being asked to execute that missing change; and a test reading
  a deliberately truncated chat projection instead of the full journal. The harness
  now checks actual receipts and semantically reviews the stored proposal. Ideal-step
  acceptance guidance preserves mandatory conditions; it is not a deterministic
  proof of arbitrary prose semantics.
- `/tmp/aven-live-action-receipt-F6jqa1/evidence.json` passed real-Qwen negative and
  positive controls over the original synthetic journal. A false completion was
  rejected; the text-only repair reported the specific unmet requirement and next
  action without inventing a new saved result. This repairs reporting, not the
  unfinished action. `/tmp/aven-live-review-contract-RHAI2B/evidence.json` passed all
  24 varied good/bad answer checks with that same reviewer change.
- Subsequent attempts `q7idPG` and `2oaZFh` exposed qualification-harness errors:
  the evaluator lacked the saved receipts, then judged an invented one-line answer
  instead of the actual stored plan. The qualification now compares the saved plan,
  predecessor, real answer and what-if result directly against the request. The
  intervening `SLCMtw` run found a product defect: refinement appended a later
  statement to an existing evidence quotation. Shared Actor and service validation
  now reject changes to the source kind, reference or quote under a retained evidence
  ID, before publication; new evidence uses a new ID. Its regression failed before
  the fix and passed afterward. These failed journeys are not completion proof.
- `/tmp/aven-live-review-contract-tnYzcW/evidence.json` passed 24/24 real-Qwen
  good/bad controls after limiting presentation repairs to material problems. This
  avoids demanding a rewrite merely for headings or a relevant next step without
  relaxing factual, authorization or required-outcome checks.
- `/tmp/aven-live-dispatched-chat-XlapiE/evidence.json` passed the combined journey
  with 72 real-Qwen requests, including new and revised case proposals interrupted
  after actual publication. Both saved proposals and their answers were inspected:
  the missing capture remains ideal, damaged returns stay separate from outstanding
  loans, uncertain counts require human review, and predecessor evidence is unchanged.
  Neither turn needed a rejected authoring correction. The earlier `JMxwcn` attempt
  correctly rejected an unknown model-supplied field before writing, then recovered;
  its harness incorrectly demanded zero recoverable errors. Qualification now permits
  at most one demonstrably settled correction, still requires exactly one publication,
  and records that count. The successful journey does not prove native handoff,
  delegated child execution or the complete tool catalog.
- Result-layout checks replayed actual synthetic Qwen outcomes from
  `/tmp/aven-live-llm-skills/2026-09-18T17-27-09.420Z/evidence.json` in the production
  components. Chromium and WebKit passed inline and popup surfaces at 390, 1280 and
  1864 pixels: twenty expanded result cards, uniform widths, wheel scrolling,
  reachability of every card, keyboard collapse and retained visible input draft.
  WebKit screenshots were inspected. WebKit's isolated temporary launcher preserves
  the path to separately extracted Ubuntu browser libraries; no system package or
  customer client was modified. This is browser interaction proof, not native IPC.

The existing JOSE dependency is pinned to 6.2.10 across the workspace. Its
[maintainer release notes](https://github.com/panva/jose/releases/tag/v6.2.10)
describe stricter header/key policy and authenticated-encryption input validation.
Identity, facade and customer-platform regressions pass with the patch, with their
optional database suites still requiring separate isolated runs. This dependency
update does not implement protected credential storage or qualify an encryption scheme.

Additional qualification on 21 September:

- `/tmp/aven-platform-proof.4GtQRH` passed the native real-Qwen journey: twelve
  checks cover multilingual feedback, routing/source continuity, persisted tasks,
  context inspection and historical recall. A synthetic context-edge request used
  261,527 measured input tokens plus a 512-token completion reserve against the
  262,144-token capacity. Both reserve overflow and input overflow returned the
  typed, non-retryable context-limit result; a fresh request then succeeded. The
  restored native history contains 114 synthetic messages inserted through authenticated
  IPC, not 114 individually spoken turns. Two inspected captures contain the same
  small unexplained dark rectangle; the interaction assertions passed, but this is
  not a claim of flawless rendering or acoustic qualification.
- `/tmp/aven-live-http-conversation-ngV1r8/evidence.json` and
  `/tmp/aven-live-http-conversation-ghA7e4/evidence.json` passed six standard and six
  alternate real-Qwen conversations after the 404 diagnostic correction. Manual
  review found no invented zero, missing domain record or access-denial explanation.
  The alternate German explanation is still awkward/verbose; these results do not
  qualify speech UX. Earlier automated success at `sHlWeF` remains rejected by
  manual review, rather than being erased by later passing runs.
- `@avenos/credential-storage` now has 29 actual cryptographic checks for its
  closed JOSE envelope profile, context substitution, tampering, key policy and
  explicit re-sealing/removal. `/tmp/aven-live-credential-envelope-biaIYx/evidence.json`
  passed four real-Qwen conversations over an actual authenticated loopback origin:
  serialized-record recovery, wrong-environment rejection, removed-key rejection,
  and re-sealing under a new key. All four answers were inspected; denied reads left
  the quantity unknown and made no provider request. No private key was persisted.
  This qualifies the encoding/test-host path, not customer SQL roles, use claims,
  productive ingress, protected process isolation, key escrow or restore deployment.
- The customer-platform type and regression checks passed, as did the deployment
  checks when rerun with Docker access. The first deployment invocation failed
  because its sandbox could not create a fixture volume; it is not a passing run.
  The controlled native gate at `/tmp/aven-platform-proof.amVNVG` is seven separate
  controlled journeys, not additional real-Qwen evidence.
- `/tmp/aven-platform-proof.Owg51a` passed the twelve-check native/Qwen gate after
  introducing exact-signature function grants and verification of every component
  role. The new provisioner proof uses actual PostgreSQL with a setter that cannot
  read its private table, a reader that cannot call the setter or its secret-reading
  overload, and a deliberately missing second-role grant that reconciliation repairs.
  Its five package tests passed. This is a reusable provisioning boundary, not an
  installed credential Vault. The isolated X11 screenshot inspected in this run
  did not reproduce the earlier dark rectangle. The preceding native attempt at
  `XNw4AS` failed a WebDriver screenshot timeout after successful interactions; it
  remains failed evidence, and no rendering root cause is asserted.
- `/tmp/aven-live-background-chat-hBOeWa/evidence.json` passed actual Qwen, signed
  service requests, customer-local PostgreSQL and the real Store with a queued
  replacement followed by a dependent task update, another independent Intent,
  cold worker reconstruction, arithmetic and published Markdown Skill authoring.
  All five answers were inspected and no tool call failed. Forty-four Intent-service
  tests passed against isolated PostgreSQL, including chained replacements, competing
  saves, dispatch/save races, immutable history and work-certificate material binding.
  This qualifies still-pending replacements internally, not active-run editing or
  a native Edit control. The customer stack has not been switched to this path.
- The first queued-edit journey at `Pwy0e0` passed the ordering/task checks but
  failed the no-retry calculation gate: the model supplied incompatible units and
  corrected them. Moving guidance into field descriptions initially exposed a
  strict public-schema rejection at `uvXPTC`; that failed development run is retained.
  The shared parser now admits bounded descriptions while preserving value validation
  and ignoring annotations for binding compatibility. It does not ignore a data
  property named `description`. The generic prompt no longer contradicts the
  calculator about count units. The broader calculation run at
  `/tmp/aven-live-llm-skills/2026-09-21T00-50-26.462Z/evidence.json` then caught a
  reversed subtraction that the model corrected with a second call. Its one-call
  regression gate remains strict; explicit operand order and held-out Spanish/French
  cases are under qualification. Neither a corrected answer nor one later pass
  erases these extra-call failures.

Further qualification and open regressions on 21 September:

- `/tmp/aven-live-chat-journal-FTFNC8/evidence.json` passed real Qwen with actual SQL
  note writes and lost acknowledgements. Tool checkpoints now bind the exact name
  and argument string to their claimed digest, beside the original result. Changed
  commands are rejected both before completion and during replay. This is not yet
  an active-message editing or replacement-receipt transfer proof.
- `/tmp/aven-live-llm-skills/2026-09-21T01-07-53.231Z/evidence.json` passed the arithmetic,
  multilingual operand-order and actual extraction → calculation → Markdown gates.
  Manual review still found an unnecessary rounded alternative beside an exact
  quotient; automated correctness is not a blanket prose-UX qualification. The
  preceding run at `2026-09-21T01-01-54.380Z` failed an overly narrow filename-label
  assertion. The corrected assertion checks each exact filename/value association
  across the operand and source labels and still rejects fabricated artifact IDs.
- `/tmp/aven-platform-proof.LvE5pU` passed the twelve native/Qwen checks, but the small
  dark rectangle recurred in an inspected task capture. `/tmp/aven-platform-proof.ji8hcK`
  then reproduced a separate real defect: a task moved correctly, while the answer
  reviewer lacked the destination name-to-ID metadata visible to the writer. Repeated
  text repairs rejected the otherwise successful operation. Structured host context
  references now carry that same bounded metadata to both stages; real-model positive
  and negative controls and a fresh native run are under qualification. Captures now
  retain the isolated display's native window inventory for diagnosis; no rendering
  root cause is claimed.
- `/tmp/aven-live-dispatched-chat-qzmMkI/evidence.json` failed the no-retry historical
  retrieval gate because Qwen supplied an unrecognized search field. The later correct
  answer does not erase that failure. The new private settled-receipt inspection
  assertions were not reached in that attempt and cannot be counted as passed.
- `/tmp/aven-live-dispatched-chat-nDoJR2/evidence.json` reached and passed private
  stopped-action inspection against Qwen-produced SQL receipts, including exact
  reference binding and worker-only access. Historical retrieval had no failed calls
  in this run. The overall journey still failed its short-completion gate: the initial
  published-Skill answer was 490 characters against the 450-character limit, including
  an unsolicited trial suggestion. Actual publication, same-draft refinement, variant
  and nested-child lineage checks passed before that assertion. The remaining later
  case scenarios were not executed; this is partial evidence, not a full-suite pass.

- `/tmp/aven-live-receipt-continuity-s0rqbt/evidence.json` passed the new named-destination
  positive and negative controls, but manual review rejects its final answer: a correct
  follow-up creation was described as partial because the other mentioned Intent was
  mistaken for the current conversation. The shared evidence now includes the engine's
  accepted conversation identity separately from referenced records. Follow-up controls
  require “this Intent” to remain the origin after a record moves elsewhere. The first
  automated pass does not qualify that incorrect completion text.
- `/tmp/aven-platform-proof.DC769X` passed all twelve native/Qwen checks after the
  reference-metadata change, including native context-edge/overflow recovery. This
  predates the additional accepted-conversation distinction above. The black rectangle
  corresponds exactly to a separate 76 × 45 native popup in the isolated X11 window
  inventory, not a DOM card; its type and rendering cause are still under investigation.
- `/tmp/aven-platform-proof.FKAXEH` passed all twelve native/Qwen checks with the
  accepted-conversation distinction, including context-edge and overflow recovery.
  Native window properties identify the intermittent small black rectangle as a
  tooltip window, not a result card. The source of its black rendering under isolated
  software capture remains unqualified; it must not be attributed to application CSS.
- `/tmp/aven-live-intent-references-PYl4N2/evidence.json` passed two shorter held-out
  three-turn conversations with real Qwen, signed task HTTP, SQL history reload and
  English/German/French/Spanish wording. Every follow-up “here” remained in the accepted
  conversation after moving a task elsewhere; no tool failed and no answer repair ran.
  Additional identity/revision assertions are being rerun, not retroactively claimed.
- `/tmp/aven-live-receipt-continuity-Km0vVk/evidence.json` passed all eight operations
  and supported/unsupported audit pairs, including named-destination and accepted-Intent
  controls. Final answers were inspected. Review remains slow: one reassociation took
  81 seconds including a legitimate answer repair, and the final follow-up took
  33 seconds. Correctness here does not meet the speech-latency goal.
  The preceding `5gXMUS` run failed a blanket no-repair assertion because the draft
  included an unrequested remaining-count claim. Its repair correctly omitted that
  unsupported aside. The broad journey now retains repairs as diagnostics; its
  factual/tool assertions remain strict, alongside small no-repair conversations.
- `/tmp/aven-live-intent-references-GTswJr/evidence.json` passed the strengthened
  held-out conversations with original task identity/revision assertions. The moved
  record changes exactly once and the untouched record keeps its revision.
- `/tmp/aven-live-growing-conversation-Rqcq8d/evidence.json` passed thirty actual
  sequential Qwen replies plus an intentional overflow. The conversation grows through
  twenty-eight exchanges and a disk reload before reaching 261,485 input tokens with
  512 reserved output tokens in a 262,144-token window. An oversized draft receives
  `LLM_CONTEXT_LIMIT`; the next shorter request keeps all accepted messages and the
  multilingual corrections. The run consumed 4,178,399 input tokens. This is provider
  capacity/transport proof, not thirty native user interactions. The first attempt
  at `XD7c3E` failed a case-sensitive color assertion despite the correct color; case
  normalization now ignores capitalization only, while exact codes, values, types
  and extra fields remain checked.
- `/tmp/aven-live-conversation-capacity-WPbdaK/evidence.json` passed the current
  shared-engine restoration, overflow, queue and interruption-metrics checks. A real
  calculator result survives overflow without being executed again. Both successful
  and interrupted timings round-trip through the saved-response serializer.

The publication Actor's own guidance now asks for a concise named result and its
execution state, leaving wiring and internal revisions in the inspectable receipt.
Excluding execution is not an invitation to add an unsolicited trial tutorial.
The dispatched regression at `/tmp/aven-live-dispatched-chat-xQa1ma/evidence.json`
passed the original short-answer, publication, lineage and recovery assertions, but
failed the later saved-case check. An otherwise mandatory human review acquired an
alternative allowing an unreviewed warning. This is a real unmet requirement, not a
cosmetic answer problem. Inspection also found that generic 8,000-character evidence
limits discarded the longer saved plan and what-if result before answer review.
Those now retain complete, separately bounded plan records and case-specific audit
guidance. Authoring clarifies that a human can leave a question unresolved after
review, but an unreviewed warning does not fulfill a required check. Fresh multilingual
mandatory-review and warning-only scenarios are under qualification; no claim of
successful repair or release is made from the earlier partial pass.

`/tmp/aven-live-receipt-review-options-2Iv57X/evidence.json` completed an isolated
fourteen-pair comparison on actual synthetic Task receipts. Both modes classified
all fourteen cases correctly. Median audit time was 7.8 seconds with production
reasoning and 3.2 seconds with the non-reasoning JSON candidate; output tokens fell
from 22,548 to 3,551. This is evidence for a narrower future optimization, not a
production change: a previous repeated source audit accepted a wrong time bucket
under the fast candidate, so current verification remains reasoned.

Replacement and saved-plan qualification on 21 September:

- `/tmp/aven-live-background-chat-OaTDAi/evidence.json` caught a duplicate creation
  after an active-message edit. The predecessor settled and its receipt reached the
  model, but the model interpreted the edited wording as an additional creation.
  This is retained as a real failure, not excused by the truthful final answer.
  Shared edit guidance now makes replacement semantics explicit in the system
  instructions rather than embedding it only beside untrusted receipt data.
- `/tmp/aven-live-background-chat-XvZ0C1/evidence.json` passed the resulting real-Qwen
  task edit, dependent queued follow-up and later completed-message edit. Original
  task identity and exact revisions are preserved, no second creation occurs, and
  the completed follow-up survives the second edit. All eight answers were inspected;
  the German task receipt still uses the untranslated status word “done”. This is
  signed-service/SQL/Store proof, not native editor qualification.
- `/tmp/aven-live-background-chat-MzN5sa/evidence.json` passed the same identity,
  queue and no-duplicate gates with independently worded French edits, an Italian
  completion and a Spanish later edit. Those edit answers were inspected. The same
  run's unrelated calculation answer introduced and immediately corrected an unasked
  wrong alternative; its final value is right, but that prose is not UX-qualified.
  Application, platform and E2E type checks and 422 application tests passed.
  The complete platform regression first stopped
  because local test ports were sandboxed, then found a stale worker-grant assertion:
  settled-receipt inspection requires `SELECT` on `run_settlement`. Its exact grant
  assertion now includes that read privilege, not broader mutation rights.
- The first stricter saved-plan retry rejected a legitimate corrective successor.
  The test now permits at most one additional version, only as a linear successor
  preserving every immutable predecessor, source and stable step identity. It still
  rejects forks, duplicate effects and invented execution. A later run at
  `/tmp/aven-live-dispatched-chat-gJq3O4/evidence.json` then caught renumbering of an
  existing step during insertion. Actor-owned guidance now distinguishes stable step
  identity from position; fresh authoring qualification remains required.
- Saved-case reviewer calibration at `/tmp/aven-live-case-review-7WusaS/evidence.json`
  classified all six supported, unsupported and honestly partial receipts correctly
  using production options, taking 22–48 seconds each. The fast candidate at
  `3Lvs8n` accepted both incorrect mandatory-review claims. The shorter case-only
  candidate at `4AtDTR` failed five of six checks, including invalid formats and
  completion exhaustion. Neither candidate is enabled. Accuracy on task receipts
  does not justify applying a faster reviewer to arbitrary saved plans.

Further qualification on 21 September:

- `/tmp/aven-live-growing-conversation-Rqcq8d/evidence.json` passed 28 sequential
  actual-Qwen exchanges, multilingual corrections, disk reload halfway through,
  and an exact independently generated code check near the configured context
  limit. The edge request used 261,485 input tokens plus 512 reserved output tokens
  in the 262,144-token window. A 262,390-input-token request was rejected with typed,
  non-retryable `LLM_CONTEXT_LIMIT` and no output. A shorter continuation succeeded
  using the same accepted-history digest. These are actual generated prior answers,
  not a prewritten long transcript. The test covers provider, gateway and disk
  history; it does not claim 30 native SQL-backed turns.
- `/tmp/aven-live-conversation-capacity-hDCDCi/evidence.json` passed the separate
  shared-engine restoration boundaries at 23, 24, 25 and 120 prior messages, actual
  overflow after a calculator result, queued continuation and stream interruption.
  The restored 373,405-token synthetic history produced a bounded 11,937-token
  request and retained the correction. An actual 458,787-token overflow preserved
  the calculator receipt; continuing did not execute it again. Successful and
  interrupted timing records round-trip through the saved-response serializer.
  Prior history in this second test is authored synthetic material, and its
  persistence callback is in memory, not customer SQL.
- A dispatched run at `77SthY` rejected an unsupported retrieval argument and then
  recovered. The shared Retrieval Actor now reports the unknown field names and
  permitted schema fields without echoing their values, before any storage call.
  Eleven focused tests (142 assertions) passed. Both operations and all three kinds
  reject wrong-operation filters too. The correction applies to every host of the
  same Actor, not a special case for one model-generated field.
- `/tmp/aven-live-dispatched-chat-W3VGOm/evidence.json` passed the earlier retrieval,
  cancellation, receipt recovery and Skill-refinement checks, then failed because
  the test's model auditor answered the sample user instead of producing its JSON
  assessment. The evaluator now explicitly owns only internal qualification, and
  records its raw reply before parsing. The repeated run at `Q8V1d5` failed earlier:
  Qwen invented two catalog tool names before recovering and publishing the correct
  Skill. This remains a failed first-attempt-quality gate; no alias or permissive
  compatibility route was added.
- The shared `RemoteIntentWork` client and native pinned-workspace bridge are added
  but not connected to the ordinary composer. Five client tests (23 assertions),
  the Rust path-policy test, application and E2E type checks passed. The native
  background lane now exercises this exact bundled client for admission, receipt,
  status and stop, and closes/reopens the client around queued and completed work.
  Its first attempt at `aven-platform-proof.OT4Yvd` failed before building because
  the test launch omitted the required Node runtime from its path. This is not
  passing product evidence; the corrected isolated run is under qualification.
- `/tmp/aven-live-background-chat-95Bjf6/evidence.json` passed using the shared remote
  admission client, including bound receipt readback, queued replacement, active edit,
  completed-message edit, FIFO follow-up and no duplicate creation. All eight answers
  were inspected. One German status receipt still says “done”; the task identity and
  state are correct, but that wording remains a presentation issue.
- The native background attempt at `/tmp/aven-platform-proof.RTlbT4` passed signed
  native admission, receipt readback, cancellation and fresh-client reconstruction.
  It then recovered the actual killed worker and completed the two task requests,
  but failed its Spanish clarification check: the question ended in a period.
  The global prompt explicitly required every opening to end with a period,
  conflicting with its clarification instruction. The full journey remains failed;
  later service-restart checks were not reached in this attempt.
- `/tmp/aven-live-answer-opening-6Awukb/evidence.json` compares that historical opening
  rule with a natural, direct opening across six languages and an exact-format control,
  twice with alternating order. Both scored 14/14 on punctuation/format and no-action
  checks; this small comparison did not reproduce the malformed Spanish question.
  Human inspection found a filler acknowledgement in all twelve historical
  clarifications and a direct useful question in all twelve candidate replies.
  The shared engine now uses the candidate: short natural answers, language-appropriate
  punctuation, no forced separate acknowledgement, explicit format precedence.
  There is no claim of measured audio improvement; real speech and loaded latency
  remain separate gates. The native failure is not retrospectively counted as passing.
- Deployment regressions passed with their disposable Docker resources; the earlier
  sandbox attempt could not create its test volume. Sixteen focused client/retrieval
  tests passed with 165 assertions. The customer activity metadata remains unchanged
  since the earlier review; no newer customer conversation was copied into testing.

Remaining decisions and release gates:

- The production opening regression at `aven-live-answer-opening-LdElGq` passed
  14/14 trials, and `aven-live-conversation-capacity-d0MRij` repeated the restoration,
  actual overflow, retained-calculation and continuation checks successfully. The
  application suite now passes 429 tests with 8,091 assertions. These are focused
  results, not a completed release gate.
- The fresh native background run at `/tmp/aven-platform-proof.3HWPH1` passed all
  three selected tests, including queued cancellation, native close/reopen, killed
  worker recovery, service restart and a subsequent calculation. It uses the real
  native work bridge but not the ordinary composer or queued-message editor.
- Inspection of recovered responses found a separate metrics defect: journal
  progress kept original model timing, but the final answer measured replay time.
  A real-Qwen/PostgreSQL regression reproduced the discrepancy before correction.
  The durable adapter now publishes original checkpoint durations and first-text
  measurements with stable identities and a restored marker. The completed answer
  remains immutable on terminal replay. `aven-live-chat-journal-Lg3cxL` passed all
  five cases with eleven actual model requests, including failed-stream replay and
  saved-effect recovery without duplication. The fresh native run `c7oSL0` passed
  all three selected checks, including original per-model timing after recovery.
- Dispatcher attempt `jDYFsT` again failed first-attempt quality on invented tool
  names before recovering to a correctly published Skill. The tool-selection
  experiment `aven-live-tool-selection-c93ko2` tested a callable-name reminder on
  24 actual Qwen requests. The baseline passed 12/12 first-call checks; the reminder
  passed 10/12, adding an unnecessary state lookup twice. This small experiment did
  not reproduce the invented names or establish a remedy. Later inspection found
  the calibration did not retain the test host's effective non-reasoning default;
  it is not a controlled reproduction of that setting. The helper now records and
  reuses effective options. The reminder was not added to production; no compatibility
  aliases were introduced. `tvSG6X` reproduced invented/unavailable names in both
  reasoning modes (10/12 each), so enabling reasoning alone is not a remedy.
  `ukFGul` compared removal of an unconditional `registry_list` instruction: baseline
  9/12, candidate 12/12. That obsolete instruction is removed from the shared prompt;
  full fresh-journey qualification remains required.
- Total response timing is now owned by the durable journal's database clock,
  from first execution through recovery. It excludes the initial admission queue;
  a backwards clock yields unknown duration rather than invented precision.
  `aven-live-chat-journal-wvbei8` passed five cases with eleven actual Qwen calls,
  including exact start, accumulated elapsed time and immutable terminal replay.
  Native `WuAJTS`, `IL7WXQ` and `W6DxHw` passed the timing and saved-effect assertions
  but failed later restart/read checks, so none is a full passing native run.
  `W6DxHw` captured exchanged service IP addresses, an initial native timeout,
  a successful subsequent authenticated read and a further failed read. The service
  images now shorten Bun's DNS lifetime to five seconds. Fresh native `u9MYNc` passed
  all three selected tests, with the first authenticated post-restart read succeeding
  in 110 ms, no read retries, original timing retained and no duplicate effects.
  The same run reopened the native client and read unchanged terminal states.
  This remains a native work-bridge proof, not ordinary composer/editor qualification.
- The saved-plan audit in dispatcher `BywqjZ` returned user-facing prose instead of
  a verdict. Independent calibration retained all failures: faster structured modes
  passed only 10/12 when a held-out real generated review bypass was included;
  both accepted the bypass twice. A reasoned audit envelope at `B9Ua9A` passed all
  twelve original/revised/stale/bypass checks. The dispatcher now shares that test
  helper. Production answer verification is unchanged. `HteM8Y` failed earlier on
  invented catalog calls despite publishing the correct Skill; the test now defers
  recovered tool-quality failures until the end to expose later independent issues,
  without relaxing its passing criteria.
- Dispatcher `KVxzHs` then passed five actual saved-plan audits and all four Skill
  creation/refinement/variant/nesting stages without failed calls. The last case
  exposed a test error: a corrective successor appended exact quotations from the
  current refinement, but whole-array equality treated that as evidence replacement.
  The corrected test keeps every existing evidence record byte-equivalent, permits
  only appended quotations present in the current contribution, and still requires
  the semantic audit, immutable predecessors and one publication per explicit write.
  The failed run is retained; a fresh complete journey is required.

- Fresh dispatcher `WfqypX` passed with 110 actual Qwen model requests and 21 saved
  answers. It qualified the independent/FIFO work, exact-effect recovery, archived
  history, scoped artifact reads, stop settlement and four Studio authoring stages
  without recovered tool-quality failures. Six saved-plan audits passed; two needed
  one explicit corrective follow-up each before acceptance. This is not first-attempt
  semantic perfection, native composer qualification or delegated child execution.
- Durable admission now carries the same bounded feedback scope as foreground input.
  The regression first reproduced HTTP 400 for that material. `hosSAX` then passed
  six actual Qwen requests through the authenticated admission/feedback paths and
  isolated SQL: four languages, another destination, immutable replay, neutral
  completion, manual-clear priority and a reaction preceding its exact response.
  The new input's committed contribution ID is used for provenance, not the local
  input ID. The shared schema rejects unknown fields and malformed pending pairs.
  This closes a contract gap before composer cutover; assessment still runs in the
  existing client recovery lane. Queue status now exposes its admission-reserved
  response identity separately from a published output. `Jv5KcI` passed the six
  real-Qwen feedback checks using that reserved identity; the database suite checks
  stability through dispatch and final publication. Ordinary background UI wiring
  must still consume this identity rather than substituting an older answer.

- The new evolving SQL-backed conversation test generated thirty actual answers
  and reconstructed workers midway through twenty-six planning exchanges. Initial
  `VvDFyh` recovered the old correction but failed first-attempt quality: it tried
  to quote a search passage that was not retained. Message search already returns
  exact original SQL substrings, so those now carry explicit source/range metadata
  and share the engine's existing quotation bounds. Document summaries and unmarked
  snippets remain non-quotable. `eKWf4G` and `23W2Pq` then exposed missing ordering
  scope and an unsupported page-size argument, respectively. The public schema now
  declares the ordering dependency and offers bounded integer page sizes; it does
  not silently accept unknown fields or strings as numbers.
- History repeat `S8Kquh` failed its shortened-excerpt case after a short message
  unnecessarily lost its prefix. Short original messages now return whole. Fresh
  `zmAXyg` passed all eleven real-Qwen history scenarios without failed tool calls,
  including English/German/Spanish recall and long-message continuation. No native
  UI or general latency guarantee follows from this service test.
- Long-conversation `Hwr1aC` produced thirty real replies, recalled the current
  correction after it had left the model window, preserved reserved reply identities
  and made no failed tool calls. Its final assertion was wrong: Intent detail is a
  bounded recent view, not the complete transcript. The test now exhausts owned
  chronological message pages, checks exact response identities and rejects duplicates.
  That earlier run remains failed evidence; a fresh complete run is required.
- Fresh `Wk02Yg` passed the full evolving-conversation test: thirty actual Qwen
  answers, worker reconstruction after thirteen planning exchanges, exact corrected
  decision retrieval outside the recent model window, stable reserved reply IDs and
  exhaustive saved-history pagination. No tool calls failed and no tasks were
  created. The final recall used two searches and one evidence record. This is a
  signed service/SQL proof, not native composer or provider-capacity qualification;
  the separate context-edge and rejected-overflow proofs cover that latter boundary.
- Pending input now captures its original screen excerpt, typed saved references
  and timezone before routing begins. Navigation and recovery no longer substitute
  the currently displayed draft. `aven-input-navigation-usBGTj` passed six browser
  journey checks with seven actual Qwen replies, including recovered-screen identity,
  explicit navigation, independent view changes and a French SQL-only continuation.
  This uses the production browser controller with controlled persistence, not the
  native encrypted-store or background-composer cutover. The durable admission
  builder drops the display prompt and retains only typed references; unsaved editor
  changes still need an explicit handoff design before that cutover.

- The owned-turn progress endpoint projects only bounded operation names, phases,
  states and measured timings from the existing run record. It does not expose the
  execution journal, prompts or credentials. Missing turns and another subject's
  turns share the same not-found response. An expired lease remains visible as
  uncertainty, not a fabricated failure or zero-duration result. Native IPC pins the
  selected customer before and after the request.
- Progress qualification first caught a catalog-digest mismatch (`6a3eHx`) and
  a PostgreSQL timestamp format rejected after a heartbeat (`LxO0Gi`). Those runs
  remain failed evidence. The timestamp now passes through a typed database value
  and canonical ISO formatting. `5MeRh1` then completed all thirty model answers
  but failed quality because Qwen supplied an unsupported search field. Closed
  validation correctly rejected it; no unknown-field coercion was added. Fresh
  `R8NLDy` passed all thirty replies, worker reconstruction, corrected-decision
  retrieval, progress ownership and bounds, with no failed tool calls.
- Native `OT7Tq2` passed its earlier assertions, but evidence review found that
  terminal progress was empty: the final run write overwrote newer SQL progress
  with its stale in-memory record. Completion now preserves that SQL-owned field
  under the existing lease fence. The test explicitly requires nonempty model and
  calculator timings. Fresh native `7K6G0G` passed the strengthened Qwen journey,
  including process loss after saved effects, independent threads, exact queued
  cancellation, live operation visibility, retained timings after reopening and
  service restarts. Three selected native/platform tests passed; six unrelated
  scenarios were skipped. This qualifies the native work API, not the ordinary
  composer cutover or protected mail.

- **Provider rejection:** reproduce with synthetic bounded context after S0 reveals
  safe error categories; do not promise that increasing context/tokens is the fix.
- **Unpublished turn:** a repeated isolated dispatcher journey completed a model
  request for a new, broad topic without publishing its answer. The initial receipt
  did not retain enough runner/journal state to establish that particular failure's
  cause. A focused regression then reproduced a concrete progress-boundary crash:
  action-claim verification emitted an undefined phase, rejected by strict runner JSON.
  Verification now declares its phase; unknown optional phases are omitted. The same
  strict-boundary test and later dispatcher journeys pass. The original uncertainty
  remains recorded rather than being attributed to the later provider outage.
- **Speech latency under load:** the current experiments do not meet the proposed
  timeout gate. Reserved capacity and actual ASR/TTS must be measured before release.
- **Key service/deployment:** the JOSE envelope profile has cryptographic and
  real-model test-host evidence; the explicit local plaintext allowance is not an
  implemented fallback. Protected key provisioning, escrow, recovery and deployment
  remain release gates. In-memory key rotation is not a customer restore proof.
- **Mail provider support:** first qualify TLS/app-password authentication. OAuth
  consent/refresh and IDLE/flag synchronization remain explicit later capabilities.
- **Automatic inbox promotion:** first version requires human promotion or a narrowly
  reviewed rule. Confidence from mail content alone is not sufficient authority.
- **Paid-receipt association:** domain review must distinguish evidence linkage from
  payable creation; do not generalize a match into a financial action.
- **Usability:** automated checks and expert inspection do not substitute for a
  new-user walkthrough. This review did not run such a study.

The spec is implementable in gated slices. It is not evidence that unbuilt credential,
mail, durable-agent or speech behavior already works. The final release claim must
come from the combined real-model workday and adverse-condition gates above.
