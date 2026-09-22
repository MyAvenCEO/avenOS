# Learning new relationships from existing information

Status: researched implementation proposal, revised 18 September 2026. Typed
computation and bounded semantic reads now have an implementation; the relationship
maintenance protocols below remain proposed. Background mining is not enabled.

## Purpose and recommendation

A user should be able to teach Aven a relationship today and have it recognize relevant
evidence in documents collected months ago. Later relationships should build on that
understanding without rereading every document or treating earlier guesses as facts.
The same definitions should work in chat, a one-off query, a Skill and unattended work.

This is feasible with the proposed artifact model. Use immutable, evidence-backed
assertions plus a maintained query projection, not an ever-growing collection of
unqualified tags. Knowledge can accumulate, but the set of currently supported
conclusions must also shrink when evidence is corrected or withdrawn.

This is learning in the customer's stored knowledge, not retraining model weights.
Models discover the current vocabulary from schemas and retrieve evidence when needed;
another model or client can use the same definitions, assertions and explanations.

The [semantic collections proposal](semantic-artifact-collections.md) owns subject
identity, typed values, relationship meaning, query truth, revisions and intake. This
companion specifies how new relationship definitions become executable, how old data
is revisited, and how those conclusions remain current. There is no compatibility
requirement; replace superseded paths when the new vertical slices are proven. This
does not authorize a customer-database reset or an autonomous mining run.

## Evidence used in this revision

The latest local Intent contributions were inspected read-only, including complete
saved tool calls for the arithmetic exchanges. Customer identifiers, personal document
contents and financial details are not copied into this proposal. The useful cases are:

- A document-kind inventory reported a partial search and read individual documents.
  Inventory counts need a schema/projection receipt, not a quotation from every file.
- A reply distinguished a document referring to an agreement from the agreement
  itself. `refersTo` does not imply that the referred document is present or that the
  selected document has its type. Missing referents must remain unresolved.
- Two simple arithmetic requests ended with a 75-second no-stream-frame error. Those
  messages do not establish why the provider stalled. Persist stage, attempt and error
  receipts; an empty tool list must not be presented as evidence of completed work.
- A money-summing tool returned integer minor units, but the answer treated one result
  as major currency units and used the currency field for a token quantity. Another
  multiplication answer was independently checked and is numerically correct, but its
  saved calls contain only an empty research record, not the claimed calculation proof.
  Correctness, execution evidence and unit interpretation are distinct requirements.
- A new software-analysis Intent asked for missing code rather than pretending that
  an executable code source was available. Preserve that behavior: establishing the
  work context does not grant access to, or prove the existence of, its subject.

These observations add typed computation and truthful execution receipts to the exit
gates below. They are acceptance cases, not authorization to fix or rerun the live
conversations. A timeout's cause remains uninvestigated by this documentation work.

Research decisions are cited beside their rationale. PostgreSQL's documented behavior,
the existing Store transaction path, JSON Schema's validation distinctions and delegated
identity semantics inform the protocols. They do not prove this future implementation.

## Walk through three different additions

1. **A new association over values already extracted.** The user identifies an IBAN
   as a payment account designated by supplier Northwind, in buyer B's context. A
   deterministic indexed join can find old documents containing that normalized IBAN.
   Its narrow conclusion is that those documents mention an account associated with
   Northwind. It cannot conclude that Northwind issued every document, owns the bank
   account, or was already a supplier at the document's date.
2. **A new property not yet extracted.** The user wants to group invoices by the
   service period they cover. Describe that observation and an extraction recipe over
   existing text. Try it on examples and counterexamples, then admit a bounded backfill.
   Old text can be reused; original PDFs and OCR are needed only where text/evidence is
   insufficient. Missing service periods stay unknown, not the invoice issue date.
3. **A new structure involving several subjects.** The user defines recurring supplier
   charges from invoice issuer, service period, amount and currency. The system can
   suggest a pattern from those observations. It cannot promote recurrence into a
   contractual subscription, predict a debt as certain, or claim an invoice was paid
   merely because a similar payment exists. Those are different relationships with
   different evidence requirements.

All three can reuse old information. Only the first is necessarily a cheap join. A
description of the desired result supplies neither missing evidence nor an executable
implementation. An unavailable producer remains a visible ideal node; simulations
containing it cannot publish accepted conclusions or enable productive subscriptions.

## Separate meaning, derivation and activation

These are separate versioned artifacts, linked through the existing Store. They are
not separate registries maintained by the client, agent and server.

### Definition: what a relationship means

A relation definition contains:

- A customer-scoped stable semantic ID and an immutable definition revision; localized
  labels, description, positive examples and counterexamples are not identity.
- Subject and object schemas; objects may be typed literals or subject references.
- Named qualifiers such as buyer, document role, occurrence and valid interval. A
  relation can need more than two participants without introducing a general graph
  language: model those participants as typed qualifiers on the assertion.
- Multiplicity, comparison/normalization references, temporal interpretation and
  required evidence bindings. Shared values do not imply unique parties.
- Assessment categories and presentation hints, with no ability to weaken the
  platform's authority, provenance or sensitivity rules.

Install a small set of closed envelopes for definitions, assertions and decisions.
Adding a relation within their supported schema vocabulary then publishes definition
data; it does not add a Store type, database column or binary build for each predicate.
The Store's semantic admission resolves the exact definition, validates endpoints and
qualifiers, and checks evidence references before making an assertion queryable.
Arbitrary valid JSON in a generic envelope is not sufficient admission.

Reuse the shared descriptor vocabulary and bounded schema validator. No executable
JavaScript, arbitrary SQL, remote schema retrieval or unbounded validation expressions
are allowed in customer definitions. A new primitive value type, operator or executable
Actor still requires an implementation. Definition text is untrusted data, including
instructions a model might otherwise interpret as overriding its task.

A label change need not cause a backfill. A semantic change produces a new pinned
definition revision; an unrelated meaning gets a new semantic ID. Existing Skills
never silently follow a changed meaning. The system can propose upgrading them with
an impact preview; this is reproducibility, not previous-version compatibility code.

### Selected schema and validation profile

Use a closed semantic descriptor AST, not arbitrary user-authored JSON Schema. Its
initial nodes are installed value-schema references, subject references, closed records,
bounded lists and discriminator-tagged alternatives. Fields declare required/optional,
role and evidence location. Unknown is an assessment state, not a string or a null
that can accidentally satisfy a value comparison. Ordinary reference fields must point
to admitted subjects; an unresolved mention uses a distinct mention record until linked.

Initial configurable server maxima are 64 KiB per descriptor, depth 8, 64 fields per
record, 8 alternatives and 128 list members. These are admission defaults, not capacity
claims. Reject over-limit descriptors; paginate observation sets instead of silently
truncating them. Permit only acyclic exact local definition dependencies. Disallow
customer regular expressions, recursive references, remote resolution, custom code,
coercion and implicit defaults. Localization changes labels, not IDs or parsed values.

The Store is the authority for semantic validation. Generate transport types and client
form hints from the same contract; TypeScript checks are convenience, never independent
admission. Resolve every referenced definition and verify subjects, temporal scope,
field evidence, allowed producing recipe and assessment authority server-side. Cache
compiled descriptors by exact digest under a bounded cache. Rust and TypeScript share
accepted/rejected fixtures for all supported nodes and limit boundaries.

Generate ordinary closed JSON Schema for existing transport/model tooling, but do not
delegate IBAN, date, currency or quantity meaning to a `format` hint. JSON Schema
distinguishes format annotations from optional format assertions; application validators
must explicitly enforce our installed value contracts. See the
[JSON Schema validation specification](https://json-schema.org/draft/2020-12/json-schema-validation#section-7).

### Recipe: how a conclusion can be obtained

A derivation recipe declares input requirements, output relation revision, subject
bindings, evidence mapping, validity rules and assessment policy. It uses one of:

- A bounded positive join/filter/projection over existing observations and assertions.
- An installed extractor, including the LLM Actor with a schema-bound output contract.
- An existing Skill, possibly nested, with pinned dependencies and the same contract.

Recipes can be authored in chat or Studio. The installed interpreter and existing
Actor registry provide execution; a model cannot register arbitrary executable code by
describing a relation. A compiler validates types, bound variables, bounded expansion,
supported operators, dependency cycles, output subjects and available producers.

Start with positive acyclic rules. Every returned subject/value must come from a bound
input or a declared, validated extraction. Comparing an observed destination against
Berlin and Munich is allowed; concluding a relationship from the absence of a matching
row is not. Closed-world negation, unrestricted recursion and general entity merging
are outside the first implementation. Aggregates consume an explicitly sealed query
snapshot and remain reports, not a back door for absence-based inference.

Normalize recipes into one portable relation IR: required observation/relation bindings,
typed comparisons, explicit joins, output bindings and support policy. Initially allow
equality joins, bounded interval comparisons, membership in a bounded literal set and
projection. Every join must bind an indexed subject/context or normalized value; reject
Cartesian products. Initial limits are 8 input bindings, 4 relation hops and 32 filter
terms. Require an explicit small scope for a nonselective bounded scan.

The Store compiles and evaluates that IR for both virtual queries and materialization.
The installed rule Actor invokes this same evaluator and publishes its checked result;
it is not a second interpreter with subtly different truth rules. The solver plans
only the installed producers needed for missing observations. No model calls occur in
query evaluation. At admission, expand nested recipe dependencies and reject cycles;
at execution, enforce work/input identities and cascade budgets as a second boundary.

Temporal joins intersect known valid intervals. A current association can support a
current-role query about an old document, but an event-time association needs evidence
that covers that event. Unknown dates cannot establish the overlap. A relation marked
single-valued yields a conflict when accepted values disagree in an overlapping context;
multiple-valued relations retain all supported values. Multiplicity is not a license
to pick the first match. Never derive general negation from a missing row.

### Activation: where and under whose authority it runs

Publishing a definition or recipe does not start a scan. An activation separately pins:

- Recipe/definition/assessment versions, customer and buyer context, permitted data
  scope, source kinds and source/revision visibility.
- Whether it covers future arrivals, old data, or both; the captured backfill boundary.
- Execution mode, permitted Actors/model use, concurrency and resource budgets.
- Review/acceptance rules and a revocable unattended delegation, if background work
  is requested. Delegation references contain no credentials or renewable user token.
- Whether resulting knowledge changes may update a maintained report. External
  business actions require their own subscription and authority.

The activation is inspectable, pausable and replaceable through the same Actor tools
used by Studio. Multiple activations can share valid computation results, but must
retain their own coverage, authorization and delivery state.

## Lazy and materialized evaluation share one meaning

| Mode | Work performed | Contract |
| --- | --- | --- |
| Read-only virtual relation | Bounded joins over already available observations | No model call, artifact write or background job; return snapshot and coverage |
| On-demand enrichment | An explicitly admitted run obtains missing observations | May use approved extractors/LLM; later query sees committed results |
| Maintained relation | Backfill followed by incremental evaluation under an activation | Durable conclusions and proofs; visible lag, budgets and lifecycle |

These are policies for the same relation, not three incompatible kinds of fact. For
the same source snapshot, definition and assessment policy, virtual and materialized
evaluation must return the same accepted semantic results. Materialization changes
cost and freshness, not truth. A bounded/truncated evaluation reports partial coverage;
it cannot report an empty complete set because its budget ran out.

A virtual result can carry an explanation without creating an artifact. A command
using it productively freezes a selection/proof bundle and exact source references
before invoking the Skill. Nondeterministic extraction is never a virtual relation;
only its committed, assessed output can be queried. Read-only callers are offered a
separate enrichment action when prerequisites are missing.

Default to virtual indexed joins for infrequent questions. Materialize relations used
by subscriptions or repeated expensive queries. Extract costly missing observations
on demand, or within a separately approved background budget. Automatic switching of
storage strategy can come later; start with explicit modes and measured query plans.

Default assessment policy is also explicit: authenticated human assertions retain
human attribution; deterministic rules preserve their inputs' support limitations;
new LLM extraction recipes initially produce candidates, not confirmed business facts.
A reviewed low-risk recipe can be activated for automatic acceptance over a stated
domain. Its evaluation corpus, model/configuration and policy revision are recorded.
No universal confidence threshold substitutes for that review. Show candidates in
previews, but exclude them from confirmed totals and effect-triggering matches unless
the receiving Skill explicitly admits that assessment. Model reruns are not independent
votes. Model identity plus provider deployment/configuration epoch must be recorded;
an unversioned provider cannot support a claim of reproducible inference.

An agent's translation of a human statement into a structured relation retains both
the human contribution and the agent's interpretation. It is not falsely labelled a
human-confirmed structured assertion. An explicit human command/approval can confirm
it; a low-risk policy can accept an unambiguous interpretation without another prompt,
while retaining its actual origin. Quoted instructions inside a document cannot stand
in for authenticated human authority.

### Typed computation and execution proof

A first slice is implemented: one installed pure Calculation Actor serves chat and
Skills, replacing the chat-only simple-sum tool. It accepts add, subtract, multiply,
divide, compare and explicit round over a bounded list of exact decimal operands.
Ledger reconciliation remains a separately named evidence-aware operation; it is not
ordinary arithmetic with implicit payment semantics. Neither tool executes supplied
code or accesses a network.

The richer expression model below remains proposed. The current Actor supports up to
64 operands, 128 coefficient digits and scale 32, scalar quantities, currencies and
dimensionless values. Compound units, denominator schemas and formula trees are not
implemented. A separate shared Knowledge Actor queries the existing indexed document
projection; it is not a formula engine or arbitrary relation evaluator. Calculation
rejects incompatible units rather than
guessing a conversion. See [the shared Actor](../libs/aven-actors/README.md) for the
current contract and [live verification](operations/build-and-test.md) for its tests.

### From model-assisted Skills to specialized Actors

Prefer an installed, specific Actor when its declared contract covers the work.
Use the LLM to interpret incomplete inputs or fill genuinely missing capabilities,
not to replace exact arithmetic, schema queries or deterministic validation. A
successful model-assisted procedure can later be implemented as a composition,
a sandboxed script/Wasm module, or a compiled Actor library. Script/Wasm execution
is a future host option, not an enabled runtime today.

Keep the same visible inputs, outputs, effect declarations and evidence obligations
at each transition. Changing implementation creates a new version with an explicit
implementation digest; it does not rewrite old Skill definitions or receipts.
Replay the user's examples, counterexamples and adverse cases against the replacement
before redirecting a published Skill. Model interpretation remains distinguishable
from a deterministic computation or a human-confirmed assertion. Optimization must
not silently strengthen what a result claims or expand its authority.

Values carry decimal-string magnitude and a registered unit: dimensionless, a currency,
or another quantity. Unit price has an explicit denominator. Money minor-unit values
also name their scale; a token symbol is not accepted as a currency merely because it
has three letters. No JavaScript floating-point transport for exact decimal operands.
Initial limits: 128 expression nodes, depth 16, 128 coefficient digits and scale 32.
Overflow and division by zero are errors. Non-terminating division requires requested
precision/rounding; retain the unrounded expression. Addition requires compatible units;
currency conversion requires a separate rate/date/source input and approved operation.

Each result binds expression, exact operand values/source fields, units, rounding and
the existing Actor execution receipt. Literals supplied by the user bind to the chat
contribution; pure arithmetic needs no fabricated document quotation. The answer
reviewer checks a claimed computation against this receipt. An empty research checklist
does not prove calculation, and an LLM's explanatory text does not prove an Actor ran.
Keep terminal timeout/error outcomes in the contribution even if no tool started.

## Evidence and current support

### Store claims and derivations without multiplying apparent evidence

Retain four distinct concepts:

1. An **observation/assertion** records a claim and its source, including an exact
   human chat contribution when the user supplied it.
2. A **derivation** records one justification: exact input claims and decisions,
   recipe/configuration versions, output claim, time basis and producing run.
3. An **assessment decision** accepts, rejects, retracts or flags a claim under a
   named policy. Human origin, model origin and policy acceptance remain distinct.
4. A **current projection** selects supported interpretations at a stated boundary.
   It is rebuildable and never independently edited as customer truth.

Deduplicate a semantic result by its defined subject/occurrence, relation revision,
normalized object, qualifiers and validity. Keep different supporting derivations
separate. A new run UUID or ingestion timestamp must not make an identical conclusion
new knowledge. Conversely, duplicate-looking source documents are not automatically
one real-world event; business deduplication needs its own evidence.

Use shared proof nodes rather than copying full transitive evidence into every result.
Index direct dependencies and preserve access to leaf evidence. Two model answers
derived from the same PDF are not independent corroboration. Do not recursively mine
generated summaries as independent support for their own underlying claims. Synthesized
artifacts keep their causal ancestry, and confidence is not multiplied along paths.

Limit proof depth, join fan-out and alternatives explored. Hitting the limit is a
coverage limitation, not evidence that another justification cannot exist. One
accepted proof can support a result under policy, but an undiscovered alternative
cannot be assumed absent when the known proof is withdrawn.

### Corrections require dependency maintenance, not another extraction pass

An accepted conclusion can become unsupported after a user correction, a new conflict,
a source-head change, a normalizer/rule change, expiry or access revocation. Dependents
must be reconsidered in topological order. A result remains supported if a genuinely
independent accepted proof survives; otherwise it becomes pending, conflicted or
unsupported. Do not silently delete its historical claim or original run.

For the initial implementation, use a conservative **scope/relation generation fence**:

1. The Store atomically commits a relevant decision/head change and marks the affected
   projection generations dirty using the registered dependency map. If the affected
   region cannot safely be narrowed, dirty the broader scope. New potentially
   conflicting evidence also counts as an invalidating change.
2. Current queries cannot present affected old rows as freshly accepted until their
   support has been checked against that boundary. They may return a clearly labelled
   historical snapshot or pending coverage. Never label a stale snapshot current.
3. Workers recompute the bounded affected region; validated generations are published
   with a compare-and-set against the captured fence. A racing correction prevents
   promotion and schedules another pass. Unaffected regions remain usable.
4. Productive actions check current permission and the relevant support fence at
   admission. Domain-specific effects retain their existing final authorization and
   reconciliation checks; arbitrary external services cannot share a Store transaction.

This intentionally sacrifices some availability before implementing fine-grained
incremental truth maintenance. If broad invalidation is too expensive, optimize the
reverse indexes and generations, not the truth rule. Current access checks override
historical snapshot access; revocation must not wait for a projector to catch up.

Observation time, validity time, document date and processing time remain separate.
Queries involving "now" capture evaluation time and timezone. Active time-dependent
relations schedule their next known expiry or reevaluation; no data arrival is needed
for time alone to change membership. Unknown historical validity remains unknown.

Implement the fence as an integer generation per semantic input family and scope, with
a synchronously maintained acyclic reverse dependency map. A relevant base publication
bumps the family and dependent dirty markers inside the Store publication transaction.
Projection writes do not bump their own input family; published derived claims affect
only downstream families. A candidate generation records its input-generation vector,
source watermark, policy and evaluation clock. Promotion compares that vector while
holding the same Store scope lock used by publishers. If it differs, keep the completed
work as historical evidence and queue a newer evaluation, not an accepted current view.

Do not hide an endless retry loop: after three failed current-view promotions, expose
lag and use a debounced bounded catch-up. Broad, high-churn dependencies may remain
pending for current effects while as-of queries still work. Fine-grained subject/value
partitions are an optimization after measurement, not required for first correctness.
All source read paths must consult this gate; denying one API while chat reads stale
rows through another would defeat the design.

## Background lifecycle and recovery

### Admission, backfill and new arrivals

An activation follows draft, validated, admitted, backfilling, catching-up and watching
states. Paused, budget-limited, needs-review, blocked and retired are explicit states,
not a spinner. Coverage is tracked independently for inventory, required observations,
assessments and projection lag.

1. Describe schemas and inventory first. Estimate candidate volume, prerequisite
   coverage and likely model work without sending every source to the model.
2. Preview a few relevant and difficult examples. Show what the recipe concludes and
   what it does not. The user can adjust scope or allow background work under policy.
3. Persist activation and a boundary in the Store's committed publication order. Obtain
   a retained snapshot/manifest for old candidates and a feed cursor for later changes.
   Scan candidates by prerequisites, not by the target property that does not exist yet.
4. Page old candidates into durable work, capturing exact inputs. Poll the publication
   feed for later arrivals, corrections, decisions, definitions and time-based work.
   Insert work and advance the local cursor atomically in the Runner's owned schema.
   Treat bus notifications as wakeups only; replayable Store publications are the source.
5. Evaluate and publish through the normal Actor/Store path. Query joins use indexed
   values; missing observations require an admitted extractor invocation. Each batch
   records coverage and stopping reasons even when no relation is found.
6. After the initial scan, capture a later feed boundary and finish processing through
   it before claiming completeness at that boundary. Account for blocked/unknown items
   explicitly. "Watching" means maintaining an active feed, not a guarantee of zero
   lag or fully understood data.

### Selected snapshot and feed protocol

Reuse the existing Store publication sequence. The current
[publication transaction](../services/artifact-store/crates/postgres/src/lib.rs)
locks the scope row, updates its ordinary `next_sequence` column and inserts the
publication and artifacts before releasing the transaction. A second publisher cannot
commit a later sequence while the first remains uncommitted. Preserve this invariant
for new semantic decisions and head changes. Do not replace it with `nextval` or
timestamps: PostgreSQL sequences have different transaction semantics, documented in
[transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html).

The protocol is:

1. Pin Store epoch E, a committed input watermark W0, recipe/policy versions and the
   evaluation clock. Use the latest contiguous semantic-projector watermark no greater
   than the feed boundary; report lag rather than claiming unevaluated publications.
2. Store semantic rows with introduced/withdrawn sequence intervals, including head and
   assessment changes. Page candidates by stable subject/occurrence key with the W0
   predicate on every join. Record candidate inputs durably as they are queued. No
   transaction or database snapshot is held open while an Actor runs.
3. Begin feed consumption after W0. Each local transaction inserts unique dirty/work
   records and advances the Runner cursor together. The Store cursor is replayable;
   the Runner does not need an atomic transaction spanning both services.
4. After scanning, capture W1. Finish accounting for feed work through W1, including
   explicit blocked/unknown outcomes, before reporting coverage through W1. Changes
   after W1 remain normal tail work. Bootstrap has its own progress and cannot be
   starved by an indefinitely advancing completion target.

Pin the index generation separately from W0. A pure join materialized later can answer
an as-of-W0 query if its inputs/assessments are exactly those visible at W0; record both
its later computation time and evaluated watermark. New LLM extractions published after
W0 are new evidence and require a newer input watermark. A historical "what was known
then" query also pins the then-existing definitions/decisions and excludes claims first
recorded later. Do not conflate source age, evidence visibility and computation time.

Keep interval history until all active read/backfill pins release it. Initial pins
expire after 24 hours without renewal; a worker renews at most hourly while doing useful
work, with a configured cap on concurrent pins and index storage. Reject new work or
pause at capacity; never prune a live pin silently. If a pin expires, mark the backfill
`resnapshot-required`, retain completed work, capture a new W0 and rescan with the same
exact-input deduplication. Do not call that continuation of the expired snapshot.
No history compactor is needed for the first slice; storage limits still apply.

This avoids using exported PostgreSQL snapshots as durable job checkpoints: they rely
on the exporting transaction remaining open. See
[snapshot synchronization](https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-SNAPSHOT-SYNCHRONIZATION).
On a Store recovery-epoch or routing-generation change, suspend the activation, discard
old permits/cursors, reconcile completed receipts and require readmission. Knowledge-only
work can be resnapshotted under its existing policy; ambiguous external effects remain
blocked until reconciled. Restoration must never manufacture new arrival events.

### Idempotency and budgets

Persist work in the Actor Runner's customer-owned schema, using its run/lease model.
Add unique work identities for exact source membership/revisions, recipe and producer
configuration, normalization/evidence policy, evaluation-time window when relevant,
and security context where it affects computation. Do not use a chat request ID for
multiple commands or confuse a new attempt ID with new semantic work.

Compute reusable observations once for those inputs; track activation coverage and
assessment decisions separately. Receipt lookup handles uncertain publication before
retrying. Pure calculation can be retried; an LLM call may still be billed twice after
an ambiguous network failure. External effects require their own idempotency support
or reconciliation and are never blindly replayed on lease expiry.

Workers claim bounded batches with leases and fencing. No database transaction stays
open during a model/network call. A stale worker cannot promote a current generation
or commit an accepted conclusion after effective Store-fenced cancellation/revocation.
Publication carries
the admitted work identity and scope so a crash between Store commit and Runner
checkpoint can be reconciled rather than publishing another logical result.

A Runner cancellation flag alone cannot enforce this across service boundaries. Use
the following Store-owned publication admission protocol, not a distributed transaction.

### Selected lease and publication protocol

Keep job scheduling in the Runner. The Store holds only the authority needed to admit
publication: activation ID/generation/status, a work-key admission row, the highest
admitted attempt generation/deadline and its committed receipt, if any. This is not a
second job queue. All fields are customer-scoped; work identity includes the exact
recipe/configuration, sources and intended output contract.

1. Runner atomically claims a job, increments its attempt generation and reserves its
   budget. `FOR UPDATE SKIP LOCKED` is suitable for claiming queue rows, not inventory
   or completeness queries; PostgreSQL explicitly distinguishes those uses in
   [SELECT](https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE).
2. Before invoking a producer, the trusted Runner requests Store admission for that
   work/attempt under a fresh delegated grant. The Store rejects a lower generation,
   a changed work digest, a closed activation or an old Store epoch. A completed work
   key returns its recorded result. Repeating the same admission returns its existing
   permit; renewing requires the same still-current attempt. A newer attempt fences
   the older one. The permit expires no later than its bounded execution lease.
3. Run outside database transactions. The Runner heartbeats its lease and renews the
   matching Store permit through fresh authority. Failure to renew stops work; a stale
   result can never extend its own permission. The model may already have incurred cost.
4. Commit evaluation through a narrow Store command. In one transaction, acquire locks
   in the global order: Store-state fence, publication idempotency lock, scope row,
   activation admission, work admission. Recheck grant/deadline with the current clock
   after waits, epoch, activation/attempt generation and support-generation vector.
   Validate outputs and exact evidence, then insert artifacts, derivations, receipt and
   publication together. There is no accepted result without its receipt.
5. If the response is lost, query the work receipt before retrying or invoking again.
   Runner records completion after observing that receipt. A different retry output
   cannot overwrite the committed winner. Return the existing receipt explicitly;
   never imply that the losing attempt's output was stored.

All generic publication paths must enforce semantic admission too; otherwise a worker
could bypass the narrow command by publishing the same assertion type directly. A
trusted installed producer may publish candidates, while accepting a claim additionally
requires the pinned acceptance policy or authenticated human decision.

Cancellation first closes/increments the Store activation fence under the same lock
order and records its decision. Only then acknowledge effective cancellation; Runner
queue cleanup follows idempotently. If cancellation wins the lock, late commits fail.
If publication wins, its result is already durable and cancellation does not erase it.
If the Store is unreachable, display cancellation requested/pending, stop launches and
revoke new delegated grants; do not report that in-flight publication is already fenced.
Resume uses a new activation generation, so a delayed old cancellation cannot close it.

HTTP command identity, logical work identity and attempt identity remain distinct.
Reusing a command ID with changed bytes fails; retrying lost identical bytes returns
the original receipt. This follows the idempotency distinction described in the
[AWS Builders' Library](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/).
Store receipts and exclusions remain available through the lifetime of the work or a
replacement tombstone/epoch boundary; pruning an operational queue never clears the
publication deduplication record. Exactly-once provider billing is not promised.

Reserve shared per-activation and per-environment budgets atomically before launching
work: model calls/tokens, source bytes, elapsed work, retries and concurrency. Nested
Skills inherit the root budget. Prioritize interactive requests, then new arrivals,
then bulk history; retain some bounded capacity for history to avoid starvation.
Backoff, cancellation, pause/resume and model-provider concurrency limits are required.
Periodically rereading every document with an LLM is not the default background loop.

A new definition has a zero model-work budget until activation. The activation must
set a finite model-call/token allowance and permitted model; query-only work needs no
model allowance. Start with at most two background jobs per environment, below the
provider-wide limit, and at most three automatic attempts for a retryable failure with
backoff. These configurable defaults are not throughput promises. Reserve the maximum
admitted response tokens before a model call and reconcile usage afterwards. If actual
cost is unknown, retain the reservation until reconciled rather than refunding it and
allowing unbounded retries. Pause admits no new work but does not imply provider billing
has stopped. Failed/blocked attempts never become evidence that a property is absent.

### Selected unattended authority and discovery protocol

Extend the shared customer-platform authorization path, not a Studio-specific bearer
token. The existing [grant contract](../libs/aven-customer-contracts/src/grant.ts)
binds a human session and limits grant lifetime to 60 seconds. Introduce an explicit
authority-kind union: interactive session, delegated execution, and internal dispatch
discovery. Do not populate a fake session ID or make original identity proof optional
for ordinary interactive calls. Each service validates the selected branch explicitly.

For the first release, only a current customer owner/admin may create or expand an
unattended delegation. That is a new explicit action in the membership matrix, not
an inference from today's generic artifact-write permission. Others can draft recipes
or perform permitted interactive runs. Store the authenticated approval and its exact
recipe, source scope, allowed Actors/model use, output destinations, budgets and expiry
in the customer database. Grant use is the intersection of that approval, current
membership/entitlement, installed capabilities and the requested operation.

Use two bounded paths:

1. **Discover work.** The platform directory assigns ready, execution-enabled customer
   environments to the registered Runner workload. Store only operational environment,
   runtime and routing-generation metadata centrally. Issue a short-lived internal
   discovery grant restricted to listing activation headers in the Runner, and where
   needed resolving those exact activation/delegation headers in the Store. It cannot
   read blobs, arbitrary claims or chat, invoke Actors, or publish customer results.
   Page assignments and activation headers with a bounded pool and idle backoff; no
   database enumeration or platform-admin credentials. Activation requests enable this
   operational assignment idempotently; a failure remains waiting for assignment.
2. **Execute delegated work.** For a selected activation, the facade resolves its exact
   approval through the narrow service path and rechecks the approving user's current
   membership, environment entitlement/readiness and routing generation. It then signs
   an audience-specific grant with delegator subject, acting workload, activation and
   delegation generation, permitted action/resource bounds, recipe digest and expiry.
   Services independently verify it and enforce bounds at each data/model/output hop.
   A missing approval or unavailable authority denies issuance; cached worker state
   cannot revive it. No browser refresh token or human identity-token renewal is used.

Delegator and executing workload remain distinct in receipts. RFC 8693's actor claim
provides that identity distinction, but token exchange does not itself propagate later
revocations. Adopt those semantics in our grant contract without implementing a general
OAuth token-exchange server. See [RFC 8693](https://www.rfc-editor.org/rfc/rfc8693.html#section-4.1).

Choose a 30-second worker-grant lifetime, never exceeding the shared 60-second maximum.
Membership/entitlement changes block new grants immediately; an old grant can admit
calls only until its expiry plus the verifier's bounded clock tolerance. A call already
admitted may finish later; token expiry does not recall a provider request. Publication
requires freshly checked authority independently of when computation began. Activation
revocation is stronger for Store publication: after its fence is durably closed, no
old permit can commit. Do not promise instantaneous cancellation of an external model
request or erase data already sent to a provider. A globally immediate revocation
guarantee would require additional coordinated barriers and is not claimed here.

Every batch and permit renewal obtains fresh authority. Routing-generation changes,
execution suspension, expired approval or missing authority fail closed. Keep the
existing per-function customer roles; the provisioner remains responsible only for
database/component lifecycle. Update the normative customer-platform grant/action
contract alongside implementation; this proposal does not silently weaken its current
interactive identity-proof requirement.

## Changing definitions and using discoveries

An edited recipe starts a new generation. Freeze its dependencies and backfill into a
separate projection generation, while the old version remains explicitly pinned.
Catch up changes, report coverage and compare results, then switch an activation's
generation atomically. Never mix conclusions from old and new semantics under one
unversioned label. A faulty definition can be deactivated immediately; historical
answers remain explainable. Retiring a relation also exposes affected Skills instead
of breaking them silently.

Dependency indexes map changed properties, relations, normalized values, parties and
support IDs to relevant recipes and materialized results. A new supplier association
can revisit matching IBAN observations without re-extracting every invoice. A new
recipe without a selective index can require an explicit bounded full backfill; the
UI must not promise that every new concept can be applied cheaply.

Knowledge changes carry their cause: source arrival, backfill, correction, policy
change or projection rebuild. Subscriptions deduplicate semantic membership transitions,
not receipt counts. Rebuilding an unchanged projection emits no new business event.
Gaining another proof for the same result is not another arrival, though an explicitly
requested assessment change can be observable.

Historical knowledge can refresh a Markdown index or business report when its approved
maintenance policy allows it. It does not automatically send old emails, reassign old
Intents, pay invoices or run every attached Skill. For action-relevant changes, expose
a preview and admit the selected historical work. Keep source-intake triggers separate
from "newly understood existing item" triggers. Loop checks include subscription and
generated-artifact feedback paths, not only the relation-rule graph.

The agent may also propose a previously unnamed relationship after seeing patterns.
Store this as a hypothesis with examples, counterexamples and proposed validation work.
Proposal and extraction can be automated within a budget; activation and acceptance
still follow policy. A schema-valid model hypothesis is neither a confirmed fact nor
permission to create additional unbounded mining jobs.

## Fit with the current implementation

| Existing foundation | Reuse | Necessary change |
| --- | --- | --- |
| [Observation solver](../libs/aven-actors/src/observation-solver.ts) | Shared unifier, bounded frontiers, exact facts and receipt lookup | Compile relation requirements and schedule producers; add persistent dependency maintenance outside its per-run, fact-accumulating loop |
| [Studio catalog](../libs/aven-actors/src/studio/catalog.ts) and [exploration](../services/actor-runner/src/studio-exploration.ts) | Installed capability discovery and typed ports | Describe semantic requirements/coverage; do not equate an available definition with an installed producer |
| [Runner repository](../services/actor-runner/src/sql-runner.ts) | Runs, leases, execution fencing and recovery | Durable activation/work keys, budgets and checkpoints; preserve uncertain-effect reconciliation |
| [Runner initialization](../services/actor-runner/src/index.ts) and [Studio dispatch](../services/actor-runner/src/studio-service.ts) | Verified customer contexts, publication-driven dispatch | Environments are currently initialized through grants; add unattended assignment/delegation rather than assuming session dispatch survives all restarts |
| [Store type DTO](../services/artifact-store/crates/contract/src/dto.rs) and [built-ins](../services/artifact-store/crates/core/src/builtins.rs) | Immutable registered schemas, exact references and production evidence | Fixed semantic envelopes plus data-defined relation descriptors, admission and indexed projections; ordinary relation additions must not require recompilation |
| [Party](../artifact-types/types/contact.party.v1.json) and [assertion](../artifact-types/types/brain.assertion.v1.json) catalog sketches | Existing intent to model parties and claims | Replace the broad predicate enum/intrinsic supplier-role assumptions, not maintain a parallel compatibility graph |

The Artifact Store owns semantic admission, projections and scoped reads. The Runner
owns scheduling and execution state. Services use their shared APIs, not writes into
each other's schemas. Shared contracts prevent divergent TypeScript/Rust validation;
native and web clients call the same facade and do not implement a second reasoner.

No graph database or general rule engine is necessary for this first slice. Indexed
PostgreSQL joins plus bounded declarative rules are sufficient for the proposed cases;
scale beyond them must be measured, not assumed.

Use one bounded Runner worker pool with durable logical activations, not one operating
system process per relation or entity. Filter candidates in the Store before passing
a bounded batch of exact facts to the solver; do not load the entire customer graph
into a model prompt or the solver's in-memory frontier.

### Persistent layout and indexes

Keep immutable definitions, claims, decisions and derivations as Store artifacts.
Their projections need typed rows for subject/object bindings, current assessments,
direct support edges, descriptor dependencies, coverage and generation boundaries.
Use the main proposal's semantic projection contract rather than copying observations
into a second fact store. The initial index set should cover:

- Relation revision, subject/occurrence, buyer/role context and validity.
- Relation/property, identifier scheme and canonical value for inverse matching.
- Input support ID to dependent proof IDs, and output claim to alternative proofs.
- Prerequisite descriptor to recipes/affected projection generations.
- Scope/generation/publication boundary for current and snapshot-paged queries.

Use bounded JSON only for non-indexed qualifiers and preserve original lexical values
in evidence. New predicates populate these tables rather than requiring runtime DDL.
Index admission and query plans must prevent unconstrained Cartesian joins.

The Runner owns activation checkpoints, unique work keys, attempts, leases, budget
reservations and delivery records. Those records are operational truth, not disposable
query caches: rebuilding a projection must not erase which work/effects already ran.
Queries and result descriptions live as artifacts, not copied private worker configs.

## Implementation sequence and exit gates

These steps elaborate the relationship slice of the main proposal. Subject identity,
typed values, snapshots and query contracts are prerequisites, not work to duplicate.

1. **Contracts and admission.** Define the closed definition, recipe, assertion,
   derivation, decision and activation contracts. Align existing party/assertion
   sketches, install the generic envelopes, and validate exact definitions on writes.
   Add normalizer/evidence/time references and the supported rule grammar. Exit: add a
   new relation through the ordinary API without a rebuild; malformed, unauthorized,
   cyclic or unsupported definitions are rejected with an actionable reason. Deliver
   the bounded schema/IR conformance fixtures and typed calculation Actor in this slice;
   calculation receipts must retain units and distinguish computation from source proof.
2. **One read-only vertical slice.** Publish a supplier/account association from an
   exact human contribution, compile a role-aware join over existing IBAN observations,
   and expose query, schema, examples and explanations through chat and Studio. Exit:
   historical matches work without model calls or source-blob reads; shared accounts,
   multiple buyers and unknown validity do not produce false issuer/ownership claims.
3. **Materialization and correction.** Persist proof nodes, reverse indexes, assessments
   and projection generations. Add idempotent derivation work and conservative
   invalidation before optimizing it. Exit: virtual and materialized results agree at
   the same boundary; retracting one support removes only unsupported conclusions;
   corrections racing with a worker cannot republish stale accepted results.
4. **Unattended backfill and watching.** Implement the selected delegated-grant and
   assignment branches with the platform, Store publication admission, Runner recovery,
   budgets and the pinned-watermark bootstrap. Exit: close the client, restart services
   midway, add and correct sources,
   exhaust budget, pause/revoke/resume; no input is lost, double-counted or processed
   without authority. This gate blocks calling the feature continuous background work.
5. **New extraction recipes and authoring.** Extend the installed LLM/extractor path to
   emit definition-bound observations with evidence; expose the contract in Skill
   inputs/outputs and the solver. Add prototype, compare, activate and ideal-node
   states. Exit: teach service-period extraction from chat and old examples using real
   Qwen, preserve ambiguous dates as unresolved, reuse existing text, and keep missing
   implementations hypothetical. Nested Skills share the same budgets and evidence.
6. **Dependent knowledge and productive use.** Admit a second acyclic rule over the
   first, integrate semantic membership events, and maintain a current Markdown index
   or business report through the main proposal's revision mechanism. Exit: adding knowledge
   finds old matches and updates the approved report, but does not replay unrelated
   actions; changing a recipe produces an inspectable result diff before activation.
7. **Hardening and replacement.** Measure bulk behavior, refine indexes, verify
   authorization/restore boundaries, and remove superseded session-only semantic
   dispatch and duplicated business logic. Update the owning current-state and
   operations documents as behavior lands. Do not call the proposal implemented until
   the live native/customer-platform gates pass.

For human authoring, show the meaning, a few matched/non-matched examples, missing
pieces, old-data scope and cost estimate first. Put rules and evidence behind inspection.
After activation show useful results, pending coverage and a pause control, not a graph
of every claim. Agents get the same preview, inspect, edit, activate and explain
operations with revision checks. No privileged prompt-only shortcuts.

## Proof plan

Use the configured real Qwen gateway for every agent/conversation/LLM-extraction E2E;
record the actual model/configuration and receipts. Do not substitute scripted model
replies. Deterministic compiler, concurrency and query-algebra tests supplement these
journeys; deterministic joins should themselves require no LLM.

- **Teach after collection:** ingest mixed documents, manually research them, then teach
  a new supplier association in chat. Discover supported old matches and later arrivals
  with no re-upload. Verify exact human evidence, context and role; add a shared-account
  counterexample and confirm no automatic identity merge or issuer attribution.
- **Teach a missing extraction:** add service periods over multilingual invoices and
  ambiguous date formats. Demonstrate definition-only/no-producer, prototype with the
  LLM Actor, review results, then backfill under budget. Files with insufficient evidence
  remain pending or unknown. A model response alone cannot set coverage to complete.
- **Layer a relationship:** derive a recurring-charge candidate from supported invoices,
  then build a nested Skill maintaining a Markdown report. Correct an IBAN association,
  retain one genuinely independent proof, withdraw another and inspect the result diff.
  No payment or contractual obligation is inferred from recurrence alone.
- **Compare modes:** use identical pinned snapshots and policies for virtual and
  materialized queries, including multiple proofs, missing inputs and conflicts.
  Assert matching semantic result sets and evidence validity, not identical model prose.
- **Compute and account for work:** test the same general behaviors with independently invented source
  documents. A capability question must not trigger unrelated financial research.
  Multiply `234567 * 87654.21 * 4321` through the shared calculation Actor and assert
  the exact decimal `88843152318019.47` and its receipt. A sum of seven amounts of
  2300 USD minor units is 161 USD, not 16100 USD; token quantities are not currency.
  Empty research records cannot validate claimed tool execution. Exercise a provider
  timeout and retain its failure stage without inventing successful work.
- **Race and recover:** arrivals during old-data paging, reversed commit timing, worker
  crash before/after Store commit, lease expiry, two workers, concurrent correction,
  projection rebuild and restore epoch. Verify durable work identities and no unsafe
  replay of uncertain effects.
- **Bound unattended work:** kill the desktop and restart the Runner, pause or revoke
  authority during a slow model call, exceed budget, and resume. Test two customer
  environments with identical identifiers and role changes; no cross-scope counts,
  evidence, cache reuse or derived-data leakage.
- **Adversarial evidence:** misleading PDF instructions, model-invented predicates,
  forged quotations, derived summaries fed back as support, output loops and broad
  join explosions. They cannot authorize work or promote unsupported knowledge.
- **Scale and usability:** at least 10,000 source documents with repeated identifiers,
  multiple relations and concurrent interactive queries. Publish cold/warm latency,
  query plans, queue lag, proof/index size, model calls and bytes read on stated hardware.
  Establish budgets before claiming a performance target; verify progress and recovery
  from the native UI, not only successful backend requests.

These are acceptance tests to implement, not tests run for this proposal. The
[build and test handbook](operations/build-and-test.md) remains the command authority.

## Thought experiments and protocol consequences

These are design walkthroughs, not executed E2E tests. Each becomes an automated
fault/conformance case and, where it involves conversation, a real-Qwen user journey.

| Experiment | Result required by the selected protocol |
| --- | --- |
| Publisher A pauses after allocating a sequence; B tries to publish | The existing scope-row lock makes B wait. A commits or rolls back before B allocates its committed successor; a feed cursor cannot skip an uncommitted earlier publication. |
| An old document changes after W0 while the historical scan passes its key | Interval selection returns its W0 state; the later publication queues the new state. Both are accounted for, but effect admission uses current support. |
| An LLM discovers a new service period after W0 | The new observation belongs to a later knowledge boundary. A virtual deterministic join over W0 may run now, but it cannot import this newly learned value into that old snapshot. |
| Two workers attempt one logical job; the first lease expires | Attempt generations and Store permits fence the old worker. At most one logical result receipt commits; duplicate provider computation/cost can still occur. |
| Store commits but the Runner crashes before recording completion | On restart the same work-key lookup finds the committed receipt. Queue recovery records completion without another logical publication. |
| Cancel and publish arrive simultaneously | Whichever obtains the Store admission lock first defines the outcome. Cancellation acknowledgement comes after the fence; an already committed result remains visible in history. |
| A member is removed while a model request is in flight | New grants fail; old grants permit new admissions only until expiry/tolerance. An admitted call may finish later, but publication needs fresh authority and an open activation fence. Already transmitted data cannot be recalled. |
| One of two independent supports is retracted | Current acceptance is dirty until rechecked; the surviving accepted proof can retain the result. Two summaries of one PDF do not count as independent supports. |
| New data keeps changing a broad dependency during recomputation | After bounded promotion retries, report pending current coverage and a usable labelled as-of snapshot. Never spin forever or mark stale results current. |
| A query says destination is not Berlin but the document has no destination | Required presence fails; the document is unknown/non-matching, not selected by negation. |
| A definition attempts to call a URL, adds an uninstalled operator, or feeds its conclusions back as independent evidence | Closed descriptors, installed capability checks and dependency/cascade limits reject it. An ideal node is visible but cannot activate productive work. |
| A correct numerical answer claims a calculator check but has only a research receipt | The result is not tool-verified. Recompute with the typed Actor or explicitly label the answer's evidence; do not fabricate a receipt or currency interpretation. |
| A backfill learns a supplier relationship for hundreds of old invoices | Update the approved knowledge/report selection. Do not send old messages, pay old invoices or generate a fresh arrival for each alternative proof. |
| A service restart occurs after an approval was revoked or the database restored | Discovery obtains fresh authority; old generations/epochs cannot run. Reconcile receipts and resnapshot knowledge work rather than replaying effects. |

## Remaining limits and validation gates

The former design blockers now have selected protocols: closed descriptor validation,
delegated authority/discovery, Store-owned publication fencing and retained-watermark
backfill. They are **implementation and proof gates**, not claims of working code.
The remaining questions have safe defaults rather than blocking the first vertical slice:

| Remaining issue | Decision for the first release | What still needs measurement or later work |
| --- | --- | --- |
| Natural-language meaning and model quality | New extraction recipes yield candidates; reviewed low-risk policies may accept them | Domain-specific held-out examples, false-positive/false-negative measurement and drift monitoring; no universal confidence threshold |
| Shared identifiers and company history | Preserve alternatives and role/time context; no automatic entity merge | Fuzzy matching, succession and reviewed identity merge/split are later operators |
| Busy scopes and broad invalidation | Fail closed for current effects; bounded retries and labelled as-of queries | Measure whether per-subject/value partitions are needed on the bulk corpus |
| Query/proof growth | Acyclic bounded IR, indexed joins, explicit partial coverage | Tune admission limits using query plans; do not promise discovery of all possible justifications |
| Fine-grained privacy | Enforce existing customer and source ownership constraints throughout every proof | Arbitrary per-fact ACLs are not introduced. A new source boundary requires an explicit read/derivation policy before that source participates |
| Retention and deletion | Preserve operational receipts; expired pins require resnapshot; source erasure invalidates dependent knowledge | User-facing retention durations and erasure workflow need a separate approved policy; don't silently retain sensitive copied evidence or derive permission to delete from this proposal |
| External effects and model billing | Idempotent receipt admission, separate effect permissions and reconciliation | Exactly-once remote execution/billing and instantaneous recall of sent data are not promised |
| Provider reproducibility | Record model/configuration epoch and exact outputs | An opaque mutable provider needs an operator-supplied deployment epoch; identical future outputs cannot be guaranteed |
| Latest observed timeouts | Persist stage/error and never present failed work as completed | Diagnose provider/gateway/client timing separately; the inspected contributions are insufficient to assign a cause |
| Open-ended mining | Budgeted hypotheses with evidence and proposed recipes | General recursion, automatic ontology expansion and automatic entity merging remain out of scope |

The recommended first proof is narrow: teach a new supplier/IBAN relationship after
documents exist, recognize old and new mentions, correct the relationship, and maintain
one approved report while the desktop is closed. If that works with full provenance,
recovery and honest coverage, service-period extraction and additional relation chains
can extend the same architecture rather than introduce another system.
