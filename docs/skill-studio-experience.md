# Skill Studio: from a real case to a reusable procedure

Status: interaction specification and source review, 16 September 2026. The
categorized action drawer and first real-case authoring slice are implemented.
The remaining lifecycle redesign is proposed, not a claim of complete support.

People should be able to finish useful work with their Aven, recognize a procedure
worth repeating, and improve it as new cases arrive. Studio keeps the original work
and examples beside that procedure. Saving a Skill should be a natural continuation
of successful work, rather than the prerequisite for trying to do it.

This document owns the human and agent interaction contract. The
[Studio model](skill-studio.md) owns program, Source, subscription, and provenance
semantics; the [shared runtime specification](skill-studio-shared-runtime.md) owns
execution. The [verification record](skill-studio-verification.md) describes current
coverage. Temporary execution, captured procedures, case suites, and variant routing
below require implementation. There is no compatibility requirement.

## Review findings

The initial review used the native screenshots and Svelte, agent, composer, and
service source. It is an expert walkthrough, not observed usability testing with
new users. Existing browser tests exercise scripted success paths with simulated
native transport; they do not establish that people understand the interface.

| Priority | Finding and evidence | Required correction |
| --- | --- | --- |
| P1 | Input options render only `studioName(candidate)` in `Studio.svelte`; several emails have the same title. | Preserve the selected case; offer a searchable picker with sender/source, date, preview, and occurrence identity. |
| P1 | `save()` is called by publication, with no independent save control or autosave. `fresh()` and `openDraft()` replace local work. | Save resumable working state, visibly distinguish saving/saved/failed, and preserve unfinished work across navigation. |
| P1 | A run requires `publishedArtifactId`; there is no temporary execution path. | Separate checking, trying, and productive execution. Trying a draft must not require publishing a Skill. |
| P1 | `requestedArtifactId` is set by Artifacts but never consumed by Studio. `requestedSkillAction` is set but ignored. | Typed navigation must carry the case and distinguish inspect, use, try, and edit. |
| P1 | `ArtifactSkillPreview.svelte` says v2 cannot open/run and exposes actions only for v1. | Remove stale gates; present supported v2 actions with current readiness. |
| P1 | `conflict` only disables publication; there is no explanation or resolution. | Preserve both edits and offer a field-level comparison and resolution. |
| P1 | Connections say “Watching” although progress depends on visible Studio or authenticated agent synchronization. | Show the actual execution host and session dependence beside status and before activation. |
| P1 | Activity has a result/Trace button but no visible cancel, retry, failed-step explanation, or input/result comparison. | Give each run an inspectable case history and a recovery action appropriate to its actual state. |
| P1 | `state()` uses a fixed type list and a bounded shelf; candidate selection searches only that snapshot. | Use authorized paginated registry search, exact-ID resolution, and explicit incomplete-search states. |
| P2 | Explore, Compose, and Activity separate stages, while the artifact list mixes examples, Sources, Skills, attachments, and results. | Organize around a case, its procedure, and its results; retain one navigation context. |
| P2 | Ready filtering excludes authorable operations needing an input, including operations useful for the selected case. | Rank actions by applicability to the current case and show fixable prerequisites inline. |
| P2 | Contract preview is presented as “Ready to publish,” with no distinction between valid, runnable, and useful. | Keep structural validity, execution readiness, and observed case results separate. |
| P2 | Open goal and Review can be added although they prevent execution; hints are in hover text. | Keep unsupported authoring tools out of the primary path and explain the consequence before adding them. |
| P2 | Step labels can be edited, but removing/replacing/rebinding steps and selecting final outputs require JSON despite shared semantic operations. | Provide direct step controls, dependency-aware edits, explicit result selection, and undo. |
| P2 | The composer chooses the last matching port; adding a later step does not automatically make it the public output. | Show proposed wiring, resolve ambiguity, and keep the selected result visible. Never imply the last card is necessarily the result. |
| P2 | Errors appear as raw strings; empty lists can mean no items, unavailable state, or a failed request. | Use distinct loading, empty, unavailable, denied, and failed states with a useful next action. |
| P2 | Required settings are considered ready by key presence; controls do not consistently bind their displayed value to selected draft state. | Validate values against schemas, retain intentional false/zero values, and restore controlled forms on navigation. |
| P2 | Sample capture writes ordinary artifacts and can trigger connections; repeated samples create indistinguishable entries. | Put onboarding in a temporary example workspace with explicit retention and no production triggers. |
| P2 | Provenance is principally a raw JSON dialog; normal results are not directly presented for review. | Show input → work → result and relevant evidence first; keep full records in details. |
| P2 | The artifact rail disappears below 820px; no replacement picker is provided. Primary actions are below a large canvas. | Keep a case switcher and primary action available at narrow widths and increased text sizes. |
| P2 | The heading/subtitle share a row; small low-contrast secondary text and raw terms such as cardinality, v2, and create@1 dominate. | Use the application type/spacing tokens, concise task labels, and progressive technical detail. |
| P1 | There is no case-derived capture, generalization, retained regression suite, or applicability-aware variant workflow. | Implement the lifecycle below; visual polishing alone cannot satisfy this product goal. |
| P1 | The global text shortcut switches to Intents; the agent request does not carry the active Studio selection/draft as a shared work context. | Keep text/voice collaboration available alongside the canvas with explicit case context. |

Main `8310bc3f` addresses the exact-artifact handoff, distinct library use/prepare
actions, and v2 preview gates. The Studio rebase preserves those changes. These rows
record the initial review, not current unresolved defects. A passing definition/parser
test is not evidence of complete native navigation or human/agent workflow parity.

The categorized drawer addresses the flat-inventory finding and replaces its Ready
filter with a can-author filter that includes operations needing an input. This
revision also gives the no-route state browse/inspect actions, separates the heading
and subtitle, and prevents the global typing shortcut from stealing Space from
buttons/disclosures and changing views. The first real-case slice now adds a shared
bounded case context for voice/text, immutable confirmation and correction, ideal
steps, structural what-if, a resumable case-derived draft, and an independent Save
draft action. It does not make unintegrated Actors executable. The initial findings
above remain the redesign backlog; the verification record identifies implemented
coverage and outstanding limitations.

## Every existing Actor must be usable

All existing Actor implementations are in scope for completion. Inventory visibility
alone does not satisfy that requirement. Missing installation descriptors, event
contracts, device placement, public forms, or durable adapters are implementation
work, not permanent exclusions. Existing versions can be replaced cleanly; no old
Studio parser, compatibility executor, or dual UI is required.

The inventory must cover source-controlled definitions, factory exports, static
document manifests, configured Actors, session-local registrations, and event-driven
Actors with no callable methods. Join the installed inventory with current offers
and live instances. An Actor must not vanish because its device is offline or its
model/account has not been configured. Never instantiate a device or effectful Actor
just to discover it.

| Existing family found in the repository | Required Studio experience and proof |
| --- | --- |
| Document inspection/decomposition, native and visual extraction, page/kind classification, content aggregation/assembly | Select a real document and requested result; show observation outcomes and intermediates, then retain and reuse the procedure |
| Invoice and statement extraction/validation, CSV detection/admission, normalizers, transaction fan-out, reconciliation ranker | Support optional/collection outputs, empty outcomes, validation findings, multiple input roles, and representative difficult cases |
| Client reconciliation candidate/review Actor | Navigate from the exact candidate to the existing comparison/decision UI; preserve the attributed decision and resume its dependent work |
| LLM and Chat | Expose bounded model calls and conversation/event participation with settings, cost/data destination, cancellation, and a retained input/output boundary |
| Listener and Speaker | Expose their real session/event contracts, device/permission state, start/stop or attachment lifecycle, and bounded replay/simulation controls; preserve interruption behavior |
| Todo/ConfigActor and Intents | Work with typed entity references and state changes, preview mutations, use isolated trial state, and retain decision/effect receipts |
| Window Actors and activity StreamActor | Preview/select the actual view, target the current supported device, and record the action without inventing a domain artifact output |
| Registry and Studio Actors | Permit scoped inspection and authoring through their real contracts; distinguish administration from domain work and retain changes/authority without recursive self-authorization |
| Existing Studio email-brief Actor | Keep the simple case fully supported, but use it as one conformance example among the families above |

This is a family map, not the exhaustive generated inventory. Tests must reconcile
every definition, operation, and event endpoint against package exports and runtime
registration; newly added implementations fail coverage until they have a tested
disposition. HTTP/IMAP helpers and prototypes must be distinguished from installed
Actors and integrated through their owning packages when implementing Sources.

Use different controls for different behaviors: a bounded action, an observation,
a view, an effect, a review, or a continuing session/Source. The common contracts
carry named typed inputs/results, applicability, placement, authority, lifetime,
trial behavior, and provenance. Do not force all of them into an email-to-artifact
conversion. Typed values, entity references, session references, artifact occurrences,
and stream endpoints have different identity/lifetime rules; persistence boundaries
must be explicit. High-frequency stream messages need not all become artifacts.

Examples also fit the Actor: an input artifact for a transform, an Intent and desired
state change for Todo, a selected view for a Window, and a bounded session or recorded
event trace for voice. A saved live-device procedure can be portable as a definition
without claiming it can execute on a server with no device. Missing prerequisites
must provide a direct setup or host-selection action.

Mixed procedures must support declared device/server handoffs where existing Actors
require them, for example extracting a document and presenting or speaking its
result. Handoffs preserve the same admitted run, exact data references, policy,
cancellation, and trial isolation. A disconnected device produces a resumable waiting
state with a clear host requirement. Arbitrary host migration is not implied.

Full acceptance requires each existing Actor to be exercised through both the human
surface and agent contract in its appropriate mode. Environmental unavailability and
policy denial are legitimate states with recovery/inspection; a missing integration
or a generic “unsupported runtime” row does not count as completed support.

## One persistent work context

### Keep the flow readable

The interaction target is someone comfortable with flowcharts and basic spreadsheet
forms, not a programmer. The default view shows inputs, named steps, and results.
Show decisions as branches and repeated work as a grouped step. A reused Skill is
one step until the person opens it; its inner flow does not crowd the parent.

Connections, settings, evidence, and technical definitions belong in progressive
detail. Prefer a short field or selection over prose. Keep one obvious next action
for the current task, with a nearby reason and recovery path when it is unavailable.
Text and voice remain reachable without discarding the work underneath. Narrow
windows and enlarged text must preserve reachable controls, not merely hide overflow.
Automated layout checks complement, but do not replace, testing with new users.

### Retain the case across views

The entry point may be a remembered piece of work described to the Aven, an Intent,
a selected item, a result, or a previous run. A case is one meaningful episode with
inputs, a desired outcome, actions, decisions, and results. Its evidence can span
several conversations, Intents, emails, files, and services. The current Intent owns
the reconstruction and authoring work; references preserve the original contexts
without moving or merging their histories. A case is not another mandatory container
users must create, and finding an artifact first is never a prerequisite.

Keep three linked views within that context:

| View | Question it answers | Primary action |
| --- | --- | --- |
| Explore: “What could this become?” | What useful outcomes are possible for these particular items? | Explore an outcome, try a procedure, or ask the Aven |
| Procedure | What should repeat, and under what conditions? | Try on the selected case; save as a Skill when useful |
| Results | What happened, and does it meet the need? | Keep the result, correct it, or add the case to the examples |

Keep “What could this become?” as the primary exploration entry point. A selected
item or a reconstructed episode anchors the case; Procedure and Results are linked views of that same work rather
than replacements for exploration. People can browse visually without knowing an
Actor name or authoring a program first.

The Skills library and Automation area are destinations for managing reusable work
and recurring behavior. They do not replace the context of an unfinished case.
History is available within each case/Skill as well as in a global activity view.

Always retain a compact context bar: the current case, selected Skill revision or
unsaved procedure, and execution mode. The title identifies the human outcome, such
as preparing an email brief. Technical operation identifiers belong in details.
Selecting Procedure keeps the same example visible; returning to Explore restores its
selection, scroll position, parameter overrides, and latest result.

“This email” and “Similar emails” are distinct scope views, not execution controls.
The first shows exact bindings. The second shows the reusable input contract and
applicability rule, with matching and nonmatching examples. Merely changing views
must not run a batch, widen a rule, or enable automation.

An artifact picker ranks the current case first, then related items, then other
compatible items. Rows show a type icon, meaningful title, sender/producer/source,
event date with time-zone detail, and a content preview. If metadata still collides,
show a short unique occurrence suffix and a comparison preview. Missing metadata
must remain missing. Separate arrivals with equal content remain distinct; group
them visually when useful without silently merging identity or provenance.

Exact selected inputs remain visible even when they are outside the current search
page. Unavailable access appears as an unresolved binding, not a different selection.
Offer explicit Upload/Choose related item actions when the input is missing.

### Find a remembered case, confirm it, and build from it

The person can describe past work in ordinary language, for example a supplier
invoice they checked, queried by email, and eventually corrected. They should not
have to remember which chat contains it, collect the attachments, or reproduce the
sequence themselves. The Aven takes responsibility for assembling the candidate case.

1. **Find.** Extract the intended outcome and useful clues from the request. Search
   the current conversation and linked work first, then expand across accessible
   chat history, Intents, email conversations, sent messages, attachments, document
   versions, decisions, tool/Actor runs, and other connected work records. Rank by
   contextual relevance, identifiers, participants, time, and causal links; recency
   alone is insufficient. The search range includes relevant user activity outside
   Studio and activity that was never performed by an Actor.
2. **Reconstruct.** Assemble a compact episode: what started it, what material was
   used, what the user and others did, important decisions, and what resulted. Link
   each supported step to its source, including a stable message/turn or document
   version reference. Keep observations, user-reported actions, and inferred links
   distinguishable. Chronological proximity alone does not establish causality.
3. **Confirm the case.** Show one concise candidate card with identifying context,
   a short sequence, and clickable evidence. Ask whether this is the episode the
   user meant. Allow correction of an included item, a missing step, the boundary,
   or the desired result. If two episodes plausibly match, show their distinguishing
   details rather than choosing silently. The person confirms the case as a whole;
   do not demand a separate approval for every retrieved source.
4. **Build.** Once the case is confirmed, proceed directly with the requested
   skillification: create the working procedure, bind the original example, propose
   generalization, and show the result in Studio. Do not return only a plan or require
   the person to rebuild the graph. Preserve links from each proposed step to the
   evidence and decisions that motivated it.
5. **Exercise and refine.** Check the procedure, run supported steps in the trial
   workspace under existing authority, compare against the original desired result,
   and surface the meaningful differences or missing parts. The original episode
   becomes a retained example for future changes.

Confirmation establishes that this is the intended case and records any supplied
corrections. It does not certify every inferred fact, grant new source access, or
authorize real-world effects. Within an already requested skillification task, the
confirmed case is sufficient direction to build and check the draft. Productive
effects and recurring use still follow their declared authority. Additional questions
are needed only for choices that materially change the intended procedure, not for
ordinary composition work the Aven can resolve and explain.

The evidence view stays compact by default: a case title, identifying date/context,
the principal steps, and a few source chips. Details expand beside the procedure.
The person can say “that other email,” “start after this decision,” or “we also checked
the contract”; these are semantic edits to the reconstruction, retaining their
attribution and the earlier case revision. A corrected case invalidates affected
bindings and comparisons instead of silently keeping a stale procedure.

Search is scoped to authorized, connected, retained data, not a claim of universal
memory. Responses record searched sources, time ranges, continuation/index coverage,
unavailable sources, and unresolved gaps. Relevant accessible history remains
searchable beyond the current artifact shelf or first result page. Expand a bounded
search when useful; do not ask the user to restate evidence the system can retrieve.
If evidence cannot be retrieved, ask for the smallest missing clue or material and
allow an attributed user account of the manual step. A case can be useful without a
complete machine execution log; the procedure marks which parts are reconstructed
or unverified rather than inventing historical receipts.

Reconstruction separates the original inputs, intermediate observations, decisions,
and final outcome. A later email or corrected file is not available at an earlier
step merely because it exists now. The historical answer is an expected result for
comparison, not a hidden input that makes a trial appear successful. Where an old
external state is unavailable, mark the historical replay limit; a fresh observation
is new evidence and may legitimately lead to a different result.

A manual habit is not automatically a reusable rule. Preserve the user's purpose,
identify what varies, and show intentional simplifications or improvements. A
one-off exception, recipient, approval, or account does not become a default for all
future cases. Already existing Skills and Actor capabilities should be reused where
they fit. Gaps become explicit review steps, authoring decisions, or prototype
capabilities with examples and acceptance checks.

### Explore outcomes and fill the gaps with the Aven

Show a few relevant outcome cards for the selected case, each with a short title,
recognizable result preview, and the next needed action. Separate outcomes available
now from those needing an input, connection, observation, or implementation. The
user can inspect alternatives and extend the bounded search. Do not equate “no
direct installed conversion” with “nothing useful can be done.” Multi-step routes,
nested Skills, and related material belong in the opportunity search once their
shared runtime support is available.

Text and voice input remain available throughout Explore, Procedure, Results, and
tool browsing. They use the same Intent and working context, with a visible chip
identifying the selected case/procedure. A category drawer must not trap the user
away from asking for help: keep the input reachable within the drawer or provide
an action that focuses it and restores the current drawer position afterward.
Voice requires its ordinary device permission and shows listening/transcription
state; text remains available without a microphone.

When the desired outcome is absent, the Aven receives authorized references to the
current case, active draft/revision, selected steps, latest result, and exploration
limits. It resolves contents through normal read authority. It can distinguish:

| Gap | Helpful next step |
| --- | --- |
| Another input is needed | Show a compatible related item or ask for the specific missing material |
| An available tool needs setup | Open the exact account, model, device, or permission setup |
| Existing capabilities need composition | Propose and explain a procedure in the current canvas |
| The desired decision is unclear | Ask one concrete question using the case or an example |
| An implementation is missing | Create a typed prototype step with inputs, intended result, examples, and acceptance checks |
| A proposed assumption needs evidence | Show the observation or review that could establish it |

A prototype step is visually distinct and preserves its origin. The Aven can try
the supported prefix, propose alternatives, or simulate a clearly marked missing
result in an isolated scenario. The downstream comparison stays hypothetical until
real evidence exists. Generated code or a manifest is not an installed capability;
turning a new Actor into runnable work follows the trusted package installation and
runtime conformance path. This is development of the missing part, not arbitrary
code execution from a chat message or artifact.

The no-route view retains the item and offers a direct next action: ask the Aven,
browse relevant actions, supply a named missing input, or inspect the material.
The explanation identifies the actual discovery boundary. “Install another Actor”
alone is not a user-facing recovery path. Asking the Aven opens a proposal in the
same work context and does not publish, execute, or enable automation by itself.

### Categorized action browser

Use a shallow disclosure hierarchy: category → tool → action, with a tool's detailed
contract behind an optional inspector. The initial categories are Documents & files,
Email & messages, Finance & bookkeeping, Tasks & workspace, AI/chat/voice, Views &
navigation, and Skills & system. Unknown tools remain visible in Other tools. Keep
administration discoverable without making it the default suggestion for domain work.

The implemented drawer derives presentation categories from authorized tags and
names, retains every operation and event-only Actor, searches category/tool/action
text, opens matching branches, and filters on ability to author rather than immediate
invocation readiness. These categories do not affect authorization or dispatch.
In the wider contract, package-owned presentation metadata should provide category,
human action labels, search terms, and optional concise previews. New domain
categories must be possible without another Studio-specific executor or Actor list.

Keep category counts and explicit availability cues. Do not duplicate a wall of Actor
cards above an unrelated list of actions. Use native keyboard-accessible disclosures;
reserve tree-widget ARIA semantics for an implementation with the full tree keyboard
model. Search preserves browse expansion state and clearing it returns to that state.
Browsing or expanding never starts an Actor, microphone, model, or Source.

## Work first, then save the procedure

1. A person opens a real case, or describes past work for their Aven to reconstruct
   and confirm. Suggested actions use the
   authorized catalog and available evidence. Both manual choices and Actor work
   produce an inspectable working trace linked to the Intent.
2. After useful work, “Make a Skill” proposes a procedure from selected steps and
   their causal dependencies. The person can start this at any point; repetition
   may justify a contextual suggestion but never automatic publication.
3. Show the proposed generalization against the original case. Each input or choice
   is classified as varying per case, fixed reference material, a reusable default,
   a derived value, or a human decision. Highlight the few unresolved choices.
4. The originating case becomes the first example. Retain what the user judged
   useful, the expected outcome, and relevant checks. More examples can be added
   immediately or later, including counterexamples that must not match.
5. Try the draft on the example, inspect the result, then save the Skill. Offer use
   on another item and automatic use as separate next steps.

The Aven can reconstruct a procedure from chats and manual work without claiming
the historical steps were Actor executions. It retains actual receipts where they
exist, input/output links, source messages, and attributable human accounts and
decisions. Unrecorded or unsupported manual actions remain explicit gaps that need
a supported step or review. User corrections are evidence of the intended result,
not proof that an Actor produced that result.

Generalization must not embed the example's person, date, account, or artifact ID as
a reusable constant merely because it was present. Nor may it silently broaden a
case-specific instruction. For several same-type inputs, retain semantic roles
such as original invoice and corrected invoice; type compatibility alone is not a
decision about meaning. Show any missing dependencies before selecting a subtrace.

Blank authoring remains available for experienced users and agents. It asks for a
representative case or a clearly marked hypothetical case before claiming tested
readiness. Observation-only procedures can use a representative request or capture
as their case; zero-input capability does not mean zero context.

Saving working state is distinct from saving an immutable Skill revision. Autosave
the working procedure with revision checks and visible status; allow incomplete
work to resume. Saving a Skill creates an immutable revision. Neither action enables
automation. Ordinary users need not understand the term publication.

## Ideal nodes: design the procedure before every capability exists

An ideal node is an explicit specification of a missing capability inside the
working procedure. It lets the person and Aven explore what would become possible
if that capability existed. It is neither an installed Actor nor evidence that a
step was performed in the historical case. The first authoring slice persists ideal
steps with required inputs, desired outputs and acceptance criteria as descriptive
text. Its structural what-if never executes anything. Typed simulated outputs and
dependency-graph trials below remain proposed; the executable v2 grammar rejects
ideal nodes.

Before proposing one, distinguish missing historical evidence, missing inputs,
unconfigured existing capabilities, and genuinely missing implementation. An
existing tool that needs an account should retain its real setup requirement.
An unobserved fact requires an observation or an explicit assumption. Neither
problem should disappear behind a fabricated new capability.

Each ideal node has a stable identity and retains:

- its purpose and relationship to the user's case;
- named, typed inputs and expected outputs, including cardinality;
- required behavior, success checks, and relevant positive/negative examples;
- proposed observations/outcomes, review needs, effects, placement, and resource
  bounds, with unknowns explicitly marked rather than inferred safe;
- any hypothetical output fixtures or assumptions used to exercise downstream work;
- origin evidence, author/agent attribution, specification revision, and eventual
  implementation references or work status.

Keep the node in the actual procedure drawing at the point where it is needed.
Use a distinct outline/icon plus the short label “Needs implementation.” Selecting
it opens the intended behavior, its example, and what remains unresolved. A compact
procedure-level indicator reports the number of missing capabilities. The user can
see a useful whole procedure while immediately recognizing the unfinished parts.

The what-if mode asks what the procedure could do under explicitly assumed ideal
contracts and outcomes. A structural simulation can check connections and possible
routes without executing anything. It cannot invent a concrete report simply from
the node's name. To exercise downstream Actors in a trial, supply explicit sample
outputs matching the ideal contract, either chosen by the user or proposed by the
Aven and labelled as synthetic. These stay in the isolated trial/scenario namespace.
Real model calls used to make examples remain separately identified and budgeted.

Hypothetical status propagates through dependencies. Every downstream result that
uses an assumed output is marked as depending on that ideal node, even if its own
Actor executed successfully. Independent implemented branches can have real trial
evidence. The result view distinguishes checked structure, real trial observations,
simulated outputs, and untested branches; the whole run is never presented as a
successful production execution. Alternative ideal outcomes can be compared,
including failure, empty output, and an uncertain observation.

The shared authoring service persists incomplete procedures and ideal-node contracts
as resumable drafts/scenarios across clients. This requires a typed authoring
envelope; unsupported nodes must not be smuggled through arbitrary JSON fields,
Actor IDs, or an executable string. Human and agent edits address the same stable
node IDs. Saving the concept does not make it runnable. Production admission rejects
unresolved ideal nodes, assumed bindings, and their hypothetical evidence, including
inside nested Skills. The temporary execution boundary enforces the same restriction
on real effects; a UI badge alone is insufficient.

When a missing capability is implemented, bind the ideal node to an exact installed
Actor capability or nested Skill revision. Validate its interface, behavior checks,
authority, effects, placement, and limits against the intended contract. Explain
material differences; then replace the assumption in a new draft revision and rerun
the original and regression examples with real outputs. Retain the ideal-node origin
and all prior hypothetical runs as such. Resolving one node removes hypothetical
status only from newly evaluated results whose other assumptions are also resolved.

An ideal node can become an implementation work item with its specification and
examples already attached. Reuse a shared prototype explicitly where several Skills
need the same missing capability; equal labels alone do not establish equivalence.
The Aven should be able to explain the dependency that blocks useful work and propose
which missing node to implement first. Generated code still follows the trusted
package installation path before any production execution.

## Check, try, and run have different meanings

| Action | Behavior | Result |
| --- | --- | --- |
| Check plan | Inspect contracts, available evidence, assumptions, effects, and prerequisites; invoke no Actors or models | A feasibility report, not evidence that the task succeeds |
| Try on this case | Execute admitted steps in a bounded temporary workspace | Inspectable temporary results and a trace; no ordinary library/feed publication |
| Run and keep | Execute under current authority and commit ordinary results | Artifacts and provenance visible to normal consumers |
| Use automatically | Enable an explicit matching and admission rule for future cases | Bounded productive runs; distinct from saving or trying a Skill |

Temporary execution requires a real runtime mode, not a cosmetic “test” label or
production artifacts hidden by a UI filter. The execution host, nested calls, Store
adapter, blob staging, and effect adapters must all enforce the mode.

- A trial has its own authenticated customer-scoped namespace and exact program,
  catalog/implementation identities, input snapshots/references, parameters, policy,
  calls, results, and evidence. Reads of real artifacts remain authorized. Writes
  cannot enter the production publication feed, opportunity index, or subscriptions.
- Reusing the current immutable inputs avoids unnecessary copies. Trial payloads
  and bytes have bounded storage and an explicit expiry. The client shows expiration
  and offers discard or retention; temporary does not mean storage-free.
- Real model calls and external reads are shown with data destination and available
  budget information and use the caller's authority. They are not simulated merely
  because outputs are temporary. Side-effecting operations require a trusted
  simulation adapter; without one they stop at that boundary. A trial cannot send a
  real message or perform a real payment. Simulated outcomes are labelled as such.
- An unsupported step can still yield a checked plan or partial trial. The UI names
  the untested part. It must not claim the whole Skill passed.
- The temporary provenance graph remains fully traversable during the trial. Saving
  the Skill records its originating case and any retained test evidence. Retained
  test evidence is explicitly typed and excluded from ordinary domain triggers.
- Keeping a trial output requires an explicit promotion operation. It rechecks
  authority, freshness, exact bytes, implementations, and the full required causal
  closure, then commits the necessary receipts and intermediates atomically with
  production provenance. A simulated or hypothetical result cannot be promoted as
  real evidence. If promotion is unsupported, offer a fresh productive run and
  explain that it can produce a different result.
- Discarding/expiry removes temporary payloads according to the declared retention
  rule. Minimal operational audit records may remain. No later screen may claim
  that discarded content is still available as complete reproducible evidence.

The current implementation supplies contract preview and productive execution only.
Trials must remain unavailable until isolation is proven at the runtime boundary.
Any productive run offered before then must be labelled as keeping real results.

## Refinement through examples

Every saved Skill opens with its purpose, when it applies, a compact procedure,
representative cases, and observed results. The first action is to try/use it, with
editing and automation available nearby. An item can explain why a Skill matches,
what remains unknown, and which input or observation would resolve that uncertainty.

From an unsatisfactory result, “Improve this Skill” creates a draft based on the
exact producing revision and keeps that case selected. The Aven proposes a compact
change and rationale. Unchanged steps collapse; affected steps, expected result
changes, and changed effects remain visible. Undo applies to authoring changes;
it does not pretend to undo completed external effects.

Each retained example records exact inputs and bindings, expected applicability,
expected output properties, user judgments, and optional comparison results. It can
represent a successful case, a known difficult case, or a case that must be excluded.
Case expectations have their own revision and attribution. Changes to them are
visible in the comparison, so relaxing a check cannot silently make a regression
disappear.

Compare the current and proposed revision on the selected case and a bounded suite.
Separate deterministic checks, user judgments, and model-assisted assessments.
Use pass/fail/needs-review/not-run/blocked states; no invented confidence score.
Record models, observations, evaluation time, and nondeterminism. A previous result
can be reused only with its original provenance and an explicit reuse label.

Case count is evidence coverage, not a general success rate. A Skill checked on two
emails has been checked on those two emails. Empty, inaccessible, stale, or untested
cases must never appear as passing. Allow sequential testing of a selected case
before offering a suite with its expected work and limits.

Saving an improved revision does not silently change existing callers or automatic
rules. Show affected uses, their pinned revisions, and the relevant comparison.
Updating selected uses is a separate revision-checked action with a defined cutover.
Keeping a published Skill manually usable without tests is allowed when its contract
and policy permit, but it remains visibly untested.

## Variants and scope

| User intent | Appropriate operation |
| --- | --- |
| Make the same procedure work better for its existing scope | Improve the Skill: new revision in the same family |
| Handle a distinct class differently | Create a variant: independent revision history linked to its origin |
| Choose a step after learning something inside one procedure | Add a branch based on a typed observation |
| Reuse part of the work in several procedures | Extract/call a nested Skill with exact inputs, outputs, and revision |
| Change one run without changing future work | Apply an explicit case-only override |

Creating a variant retains the originating case, base revision, selected useful
examples, and derivation provenance. Subsequent edits do not mutate its parent.
Users can compare or deliberately port a later improvement; inheritance must not
silently alter execution. A copied name or a “special” tag is not a routing rule.

For example, a general email brief and an invoice-specific brief form a small
family. “Use invoice brief when invoice evidence is established; otherwise general
brief” is an explicit routing choice. The author previews which examples would
select which revision, with links to the evidence and the exclusion cases.

Rules use typed facts/fields and operators supported by trusted contracts. Free-text
requests can propose those rules but are not executable selectors by themselves.
Classification that needs a model or another observation is work with cost and
provenance, not a free title matcher.

Applicability has match, no-match, and unknown states. Unknown is not false. If a
preferred special case cannot be evaluated, default to waiting for its observation
or a user decision rather than silently selecting the general procedure. A deliberate
alternative fallback policy must be visible and recorded.

Use an explicitly ordered, versioned rule set with one selected route by default.
The author must resolve known overlaps and see the fallback. Specificity is not
inferred from names, predicate count, or model confidence. At admission, freeze the
rule set, selected Skill revision, evidence, and bindings. Multiple-output fan-out
is a distinct choice with budgets and duplicate-effect protection. Overlap with
other automatic rules must also be shown; conflicts that cannot be statically
decided remain explicit rather than claimed impossible.

A special route failing at runtime does not trigger the general route as an implicit
fallback. It may already have produced results or effects. Recovery follows its run
state. Routing revisions affect future admissions at an explicit cutover; they do
not relabel old work or replay it automatically.

The initial implementation may support manual variant choice before automatic
routing. It must still save applicability, examples, lineage, and current support
status so that the foundations do not require another conceptual reset.

## Automation is an additional decision

Similarity, selecting several existing items, and watching future arrivals are
different scopes. The interface must offer them separately. A batch has a frozen
selection and count. A future rule has a Source/producer selector, applicability,
target Skill revision, input-binding rules, effects, and admission bounds.

Before enabling a rule, show compact matching and nonmatching examples, selected
variant/fallback, how missing or ambiguous companions behave, and whether previous
arrivals will be processed. Default to future arrivals. Historical processing is a
separate bounded action. Show source identity and actual execution host, including
whether the desktop must remain available.

An automation card names what it watches and produces. It exposes active, paused,
waiting, failing, offline, or limited states and the last successful arrival/run.
Each state has a direct action. Pause stops new admissions; cancel controls accepted
runs. Resume explains retained backlog. A rule update previews affected bindings,
cases, and current work before its explicit cutover.

An agent may enable automation within existing delegated authority; otherwise it
returns a ready-to-review proposal. Neither repetition nor saving a Skill is implied
permission to enable a rule. Avoid repeated confirmations for already authorized
bounded work.

## Interaction quality and recovery

Keep one primary next action per working context. Show the result beside its input
where space allows; use a case/result switcher on narrow windows. Put operations in
a contextual drawer, grouped by useful outcomes. Full permitted catalog inspection
remains available for people and agents, with missing requirements explained.

Use short labels with icons, readable secondary text, and selected-state outlines.
Do not use icons or color alone to convey scope or status. Help should appear next
to a decision when needed; persistent tutorial paragraphs should not crowd the work.
Use application layout/type tokens and namespaced component classes to avoid global
style collisions. Keep actions reachable at 200% zoom and narrow desktop sizes.

| State | Required behavior |
| --- | --- |
| Initial/empty | Offer recent work, choose/upload an item, or a temporary example; never require composing a blank graph |
| Loading | Preserve current work, show progress, and prevent duplicate submissions |
| No route | Retain the item and offer inspect, additional input, a supported alternative, or an explanation of the current limit |
| Multiple candidates | Show a choice with meaningful previews; do not silently pick a same-type item |
| Unsupported construct | Explain what can be checked or tried and identify the unsupported step before publication |
| Save failure/offline | Keep unsaved state with retry/export/recovery appropriate to the available storage guarantees |
| Concurrent human/agent edit | Show changed fields and retain both proposals; apply nonconflicting edits only with revision checks |
| Run waiting/failure | Open the exact missing input or failed step, retain completed results, and explain allowable recovery |
| Uncertain effect | Inspect/reconcile the original attempt; no generic rerun button |
| Stale result/preview | Explain changed inputs/contracts and offer recheck; never silently substitute a new route |
| Access removed | Keep a labelled unresolved reference; offer authorized alternatives without leaking denied content |
| Nested navigation | Breadcrumb back to caller/case, preserving edits and scroll position |

Every disabled action needs a nearby explanation and, where possible, a remedy.
Every dialog restores focus on close. Pickers support keyboard search/selection and
screen readers. Removing a step previews dependencies and offers repair or undo.
Choosing a new final result updates the visible output contract. Public form values
stay bound to the actual case/draft; empty, zero, false, and unset are distinct.

## Shared human and agent contract

Both interfaces operate on the same customer-scoped case and revision-checked
working procedure. The agent must be able to discover the active case, inspect its
history, propose semantic changes, and open the exact result/diff in the UI. A tool
that returns a large JSON document is not sufficient collaboration on its own.

The following are proposed semantic capabilities, not existing endpoint names:

| Capability | Structured result |
| --- | --- |
| Inspect work context | Intent/case, exact input bindings, active procedure/revision, mode, unresolved decisions, allowed next actions |
| Find/reconstruct a case | Candidate episodes, ranked supporting source references and snippets, observed/reported/inferred steps, conflicts/gaps, search coverage and continuation |
| Confirm/correct a case | Exact reconstructed-case revision, included/excluded evidence, corrected scope/outcome, user attribution, resulting confirmed snapshot |
| Capture/generalize work | Selected causal steps, proposed variable/fixed/default bindings, unresolved gaps, origin references |
| Specify/simulate/resolve an ideal node | Stable node and contract revision, missing behavior, example assumptions, affected downstream results, implementation requirements, validated replacement and comparison |
| Check applicability | Match/no-match/unknown, evidence, missing observations, bounded search coverage |
| Try and compare | Trial identity/status, exact inputs/program, named results, checks, cost/usage where known, differences |
| Retain an example | Versioned expectations and judgments, input refs, retained evidence and attribution |
| Improve/create variant | Base revision, atomic semantic changes, applicability, inherited examples, provenance, affected uses |
| Save/apply changes | Expected revision, resulting revision, changed fields, validation issues, UI reference |
| Propose/activate routing | Exact rule set and targets, overlap/fallback analysis, selected scope, admission policy and cutover |
| Inspect/control work | Run/trial status, completed work, waiting reasons, permitted cancel/reconcile/retry actions |

Responses carry stable references, structured reason codes, concise explanations,
and available actions with prerequisites and effect classes. Long tasks return a
durable handle and can be resumed or observed from another client. Mutations carry
expected revisions; side-effecting requests carry stable idempotency keys. A changed
case or user edit invalidates the agent's stale proposal and produces a useful diff.

Semantic edits should support a validated atomic batch so a legitimate restructure
does not need to pass through an invalid intermediate graph. The Aven can propose
changes without applying them, apply authorized changes, and undo draft changes
through the same interface. Artifact content remains untrusted data, not permission
or executable instructions. Protected values never enter case literals or examples.

## Delivery and acceptance

The following records make the experience durable across clients. Exact type names
and versions require registration before implementation; these are proposed owners
and contents, not additions to the current closed Skill grammar by implication.

| Record | Owner and contents |
| --- | --- |
| Working case | Intent-linked Studio record: stable ID, outcome, cross-history source references and retained versions, reconstructed steps and evidence status, confirmation/corrections, exact bindings, selected procedure, overrides, working trace, current revision |
| Procedure draft | Studio record: base Skill revision, origin case/steps, semantic edits, unresolved decisions and ideal-node contracts, author attribution, revision |
| Skill family and revision | Mutable Studio family/head index over immutable Skill artifacts; exact derivation/predecessor and nested references retained |
| Example and evaluation | Revisioned expectations plus immutable retained evidence: input identities, applicability expectation, checks/judgments, evaluation environment and exact compared revisions |
| Trial | Customer-scoped runtime record and isolated byte/graph storage: mode, frozen definition, calls/results, expiry, retention/promotion state |
| Routing and activation | Immutable rule-set revision with pinned targets and explicit order/fallback; mutable enabled state, generation/cutover, delivery/run ledger |

Control records are not reconstructible solely from Skill artifacts; they must join
the customer backup/export and recovery boundary. Retained example evidence follows
normal artifact access rules but cannot establish ordinary domain facts simply by
being a test expectation. Removing access to an originating case does not grant
access through the Skill's preview or its agent description.

Deliver in reviewable stages. Fix misleading navigation and states first; do not
wait for the full runtime before correcting those defects. Do not expose later
features as working merely because their UI or schema exists.

| Stage | Required result |
| --- | --- |
| 1. Preserve the case | Typed navigation, distinguishable artifact picker, resumable draft, correct v2 preview actions, visible conflicts/recovery, truthful readiness/session state |
| 2. Reconstruct past work | Context-ranked retrieval across authorized histories, candidate episodes, source-level evidence, compact confirmation/correction, exact confirmed-case snapshot |
| 3. All Actors and captured work | Generated complete inventory, package-owned execution/event contracts, device/server placement and handoffs, Intent-linked trace capture, generalization, examples, shared human/agent edits, usable nested/result editing, typed ideal-node drafts |
| 4. Try and improve | Enforced temporary execution, bounded retention, isolated feeds/effects, explicit ideal-node assumptions and dependency marking, result comparison and regression examples, explicit keep/promote behavior |
| 5. Variants | Derived Skill families, applicability, negative cases, manual variant choice, explicit ordered routing and ambiguity behavior |
| 6. Automatic use | Verified source supervision and delegated authority, bounded batches/future admission, cutovers, affected-use updates, full source-to-result provenance |

Structural checks do not substitute for observing the intended user journey. The
acceptance suite must include all of the following, in native Tauri as well as the
shared service/agent boundary where applicable:

1. Open one of several same-title emails from Artifacts or an Intent. Recognize it
   from contextual metadata, inspect attachments, return without losing selection,
   and see it already bound when trying a compatible procedure.
2. Complete work with the Aven, select the useful steps, save a generalization with
   the original case, and use a second case without inheriting its incidental values.
3. Try an unpublished draft. Assert zero production publication/feed changes, zero
   subscription admissions, no real effect calls, bounded temporary storage, and a
   complete temporary trace. Include nested calls and failures at each boundary.
4. Discard, expire, retain evidence, and keep eligible trial results. Check exact
   provenance closure, idempotent promotion, denied promotion of simulated results,
   and truthful treatment of expired payloads.
5. Correct a difficult result, retain the new example, and compare it with earlier
   cases. Show a regression, changed expectation, blocked case, and unrun case
   distinctly. Saving the improvement leaves pinned live uses unchanged.
6. Create a special variant with a positive example and a counterexample. Prove
   overlap handling, unknown applicability, fallback selection, no automatic second
   execution after a failed special route, and immutable routing provenance.
7. Have the agent inspect, capture, generalize, try, modify, compare, and propose a
   variant through the shared API. Display each proposal/result in the person's
   existing context. Race an agent edit with a human edit and preserve both.
8. Distinguish one case, a frozen batch, and future arrivals. Check activation,
   pause/backlog/resume, missing companions, update cutover, and recovery after
   interruption against the actual supported host lifecycle.
9. Exercise unavailable services, revoked access, stale inputs, no routes, failed
   save, missing settings, cancellation, uncertain outcomes, and changed catalog.
   Every screen must identify the state and preserve a navigable route forward.
10. Use the flow with keyboard only, a screen reader, narrow layout, and 200% text
    zoom. Verify focus restoration, labels/contrast, long/localized names, multiple
    outputs, empty collections, and deep nesting without inaccessible controls.
11. Reconcile every existing Actor and event endpoint with generated coverage.
    Exercise its human and agent paths in the appropriate action/session/Source mode,
    and prove representative mixed procedures such as document → summary → native
    presentation, reconciliation → review, and voice → bounded work → speech. Check
    device disconnect, interruption, cancellation, denied authority, and isolated
    trial behavior. A blocked catalog entry is not execution proof.
12. Start from “What could this become?” with an outcome outside the currently found
    routes. Use both text and voice to ask the Aven, verify exact case/draft context,
    and prototype the missing part without losing the selected work. Confirm that
    assumptions, simulated outputs, and unavailable implementations remain visibly
    distinct from real executable steps and evidence.
13. Start only with a natural-language recollection of manual work spread across
    separate chats, an email thread, attachments, and a user-reported action. Find
    evidence beyond the first search page; distinguish two similar episodes; handle
    unavailable evidence and contradictory records. Confirm the intended episode,
    correct a step, and create a visible procedure without asking the user to locate
    or re-enter available source material. Retain all source and confirmation lineage.
14. Trial a procedure reconstructed from history. Prove that later observations and
    the historical final answer are not silently supplied as original inputs. Keep
    unverified manual steps explicit, compare the new result with the expected one,
    and reuse the confirmed case when refining the Skill. No real email or other
    effect is repeated merely to reconstruct or demonstrate the past procedure.
15. Build a case-derived procedure with two ideal nodes and an independent implemented
    branch. Inspect exactly what each missing node must do, simulate several explicit
    outcomes, and prove that hypothetical status reaches every dependent result but
    not the independent branch. Production admission, automation, and promotion must
    reject assumed evidence. Bind one node to a real implementation, check contract
    differences, and rerun examples; only newly evidenced results lose the assumption,
    and the remaining gap and complete design history stay visible.

Usability sessions should ask unfamiliar users to work on a case, retain a useful
procedure, improve it from a difficult example, and create a scoped variant without
teaching the navigation first. Observe whether they can explain what will run, which
items it affects, what is saved, and whether it will run again automatically. Record
wrong turns and moments needing help; these are release findings even if the
scripted functional tests pass.
