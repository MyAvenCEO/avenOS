# Shared conversation engine

This package owns the conversation loop, model-stream decoding, bounded recent
context, tool-result tracking, source checks and answer repair. The desktop supplies
a Svelte state adapter and its authenticated native transport. The engine has no
desktop, browser-storage or provider dependency.

Native and server hosts share the gateway request builder, stream parser, cancellation
and stall watchdog. Hosts supply an authenticated byte transport and select an installed
model; tool arguments cannot choose service credentials or the gateway address.

The input router distinguishes a bare topic opening from an actual request using
the same bounded decision call. Its accepted `responseMode: clarify` restricts that
turn to a scope question with no tools; a subsequent request starts a normal turn.
An attempted tool call in clarification-only mode is rejected before execution.
Manual destination selection after an unavailable router may omit the classification;
this is an explicit failure-recovery path, not an old-format compatibility reader.

The foreground queue reads already-waiting contributions together before starting
the next answer. Original text and message IDs remain separate; the answer records
its `inReplyTo` IDs and the UI labels multi-message answers. Selection takes only a
contiguous waiting prefix with the same Intent, captured host context and anonymous
speaker, bounded to sixteen messages and 32,000 characters. An oversized first
message still runs alone. No debounce, extra model decision or text merger is used.
Later corrections can change the requested outcome before any tool runs. A partly
specified contribution marked for clarification does not block a later concrete
request in the same group; a genuinely incomplete group still needs clarification.

This does not absorb input into an already-running request, cancel committed effects,
or recover a foreground queue after process exit. Inputs still undergoing routing
are not available to execution. Durable outbox turns retain their individual admitted
authority; this queue change does not combine those separately authorized runs.

The desktop input adapter snapshots reactive data before handing it to the plain
input controller, including selected destinations, restored drafts and candidate
lists. No UI proxy may enter the controller's asynchronous jobs or encrypted-storage
snapshots. Native recovery tests exercise the actual buttons as well as persistence;
controller-only tests do not cover that framework boundary.

Restored conversations retain paired recent tool calls and their machine-readable
outcomes, not only the assistant's prose. At most four calls per restored answer are
included before the normal recent-message selection. Structured results up to 8,000
characters are retained without passing through the display formatter. Large task
results use the productivity package's validated projection: task identities,
revisions, user-visible values, scope and pagination remain available, with omitted
rows and metadata identified explicitly. Other oversized, truncated or uncertain
results ask for receipt/current-state lookup instead of providing broken JSON or an
invented ID. These are historical observations, not permission to run the calls again.
Full receipt lookup remains pending.

Hosts may supply up to 64 bounded record identities and display titles as structured
context references. The foreground captures plain values at submission, and the
writer, reviewer and answer repair receive the same snapshot. A receipt's exact ID
can therefore be shown under its known Intent name without an extra lookup. These
references are data, not instructions, execution receipts or permission; they do not
prove document contents, current access or complete workspace coverage. A changed
reference snapshot prevents otherwise adjacent queued inputs from being combined.
The engine supplies the accepted conversation identity separately: moving a Task
to another Intent does not move the conversation or redefine a later “here”.
The durable engine accepts the same contract; a server host must obtain its references
under its own authorized retrieval path, not manufacture them from model prose.

Answer review retains structured tool outcomes without a tool-name allowlist, so UI
actions and newly installed Actors do not lose their receipts. This does not itself
add another model review to a UI-only request. Explicit success, failure and unknown
status remain distinct. The current-turn budget is 128 outcomes and 64,000 serialized
characters; omissions are counted. A separate historical section retains up to eight
observations and 24,000 characters from the last twelve turns. Past actions can prove
past effects, never fresh authority or current state. Model-authored research
checklists are excluded from both receipt sections; they are not independent evidence.
Structured credential fields are redacted. These bounds do not establish complete
historical coverage or make every arbitrary tool output trustworthy.

Saved case proposals and their structural what-if plans have a separate review
budget: up to 110,000 characters per complete record and 220,000 in total. This
matches the larger case contract; the generic 8,000-character observation limit
must not erase acceptance conditions while leaving a success receipt. Whole older
records are removed when the aggregate limit is exceeded, with an omission count;
oversized individual records become explicit unavailable-evidence notices, not
partial plans. Observing a plan requires answer review even for a read-only what-if.
Case-specific audit guidance checks whether mandatory requirements stayed mandatory
without treating a saved proposal as execution or inventing additional approval
gates. A text-only answer repair cannot correct the saved plan; it must report such
an incomplete result honestly.

A host can mark a tool specification with `answerReview: 'required'` to put its
returned results through the same answer review and bounded correction loop, without
adding its name to the engine. This applies to failed or malformed results too and
survives receipt eviction. It only adds review; it cannot disable existing mandatory
checks. Merely displaying a UI receipt does not acquire that policy. The gateway
strips this host-owned field from provider function declarations, and tool output
cannot set it. Hosts still need to install and authorize the tool independently.

`executeDurableChat` runs the same engine through a customer-owned I/O journal.
Recovery reuses completed model responses and tool receipts. Pending mutations
require an exact receipt resolver and are never blindly repeated. Declared read-only
observations may be read again under fresh authority; their duration is labelled as
a new read, not the unknown original duration. The host supplies a pinned
turn clock, engine digest, conversation snapshot and scoped tool implementations.
`SqlChatJournal` in Actor Runner fences its records with the existing run lease.
Server dispatch and the durable tool host are still being integrated; the journal
alone does not make existing desktop conversations unattended.

Shared history previews retain bounded exact excerpts under their original message
IDs, including source roles and timestamps. Exact message-search excerpts also carry
their source identity, code-point offset, total size and next offset, so their displayed
range supports quotations without a redundant fetch. Unmarked snippets and document
search summaries cannot. Invalid range metadata is not retained. Partial excerpts remain partial, and
message continuation offsets count Unicode code points consistently with PostgreSQL.
Reading an assistant's old claim proves what it said, not that the claim was true.

Search evidence retains bounded titles and IDs across observed continuation pages,
separate from quotable document content. The last page's size is not the total.
Message results do not need a document title: their role and contribution sequence
remain available to the reviewer. Sequences order all contributions, including
activity, and must not be interpreted as message ordinals. Chronological selection
needs the requested role and the search's scope/coverage, not just a sequence number.
Fresh queries replace their earlier snapshot; omitted metadata stays explicit.
The reviewer and checklist builder receive the same metadata, so a title list does
not require downloading every document. Source-page continuation and whole-source
text coverage remain distinct. Historical document-index gaps do not qualify an
unrelated capability search or an already read source.

Model checkpoints and progress distinguish answer generation, source-checklist
construction, verification and repair. They record elapsed time and the first
nonempty public text/tool fragment when present; that is not time to first audio or
the time a verified answer became visible. The first text delta is measured separately
from a tool fragment. Completed response metrics use these same journal measurements,
not the duration of replay. A recovered call has a stable journal identity and is
labelled as restored; it is not counted as a fresh provider request. A terminal answer
replayed after a lost publication acknowledgement remains byte-identical to its first
saved outcome, including those metrics.
For a durable turn, total elapsed time starts at its original journal execution,
not the latest worker attempt. The PostgreSQL journal measures both ends with its
own clock, including interruption and recovery time but excluding initial admission
queue time. It is wall time, not the sum of model/tool durations or a cross-host
clock subtraction. A backward clock adjustment leaves duration unavailable rather
than inventing zero. The original start and final duration are checkpointed with the
answer; terminal replay does not recompute them.
The action-claim check is also verification. A caller without a phase label omits
that optional field so the strict runner JSON boundary remains valid.
Foreground hosts also expose the actual active model phase and start time. The chat
groups progress and result cards in one disclosure: the collapsed heading shows the
current step and total elapsed time. Expanded steps interleave model requests and tools
by their recorded start time, with results at the corresponding tool and newest last.
Usage and raw details stay behind individual step disclosures. Old observations without
start times remain available but cannot be interleaved reliably. The two chat surfaces
follow layout/content growth by default; scrolling up parks the reader until they scroll
back to the bottom. A model request includes possible provider waiting; it is
not a claim that the provider is generating tokens continuously. Recording source
quotations is labelled separately from the later model verification.
The auditor is explicitly separate from the assistant addressing the user. Both
its initial assessment and bounded retry keep model reasoning and strict result
validation. A faster non-reasoning candidate failed repeated source qualification
and is not used by the engine.

The journal contains private content and belongs in the customer database. Ordinary
performance telemetry must not copy it. Tests use independently invented inputs and
an isolated database; see the [build and test handbook](../../docs/operations/build-and-test.md)
for validation commands and their limits.

Response feedback preserves its origin. Router-inferred annotations identify their
saved source message and use the same append/edit path as explicit votes. A manual
vote, clear or unfinished reason takes precedence. The foreground host saves an
accepted input before starting or queuing its agent response; an inference is not
applied to an unassigned draft. This does not turn the foreground queue into a
durable background worker or provide automatic queue recovery after a process exit.

Feedback capture includes an active, not-yet-saved response with its exact identity
and admitted request anchor, even before its first text appears. The client defers
the vote until that response is durable and wakes it on persistence/hydration;
unrelated feedback continues. A failed or cancelled target is not reassigned to an
older answer. Target selection precedes multilingual evaluation: acknowledgments,
consent and unfinished fragments are not praise. These guarantees require the matching
API input contract and Intent-service chronology checks, not a frontend-only rollout.

When an admitted contribution moves between Intents, it can retain at most four
800-character excerpts from the saved origin dialogue captured at submission. The
shared input receipt keeps their message IDs, capture time and shortening flags;
foreground and background engines use the same rendering. These excerpts resolve
references such as “that”, not verified facts or permission to replay old requests.
The UI exposes the captured excerpts beside the user message. Unsaved, queued,
pending and attachment-only turns are not copied, and a same-Intent contribution
does not carry another copy of its history. Native draft recovery retains the bounded
snapshot; a changed screen does not replace it with unrelated context.

Explicit navigation follows successful persistence of the accepted contribution.
A newer input or intervening screen change prevents a delayed routing result from
stealing focus. The selected screen remains independent of execution.
