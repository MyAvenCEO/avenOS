# Skill Studio: shared Actor discovery, composition, and execution

Status: proposed implementation specification; not implemented

Studio must let a person or their Aven discover every permitted installed Actor,
compose its capabilities, and understand what is needed to execute the resulting
Skill. Installing a conforming Actor must not require another Studio registration,
editor branch, or executor branch. Skills are first-class artifacts with a useful
visual preview in the artifact library, not opaque program JSON.

This document owns the integration contracts, clean-cut decisions, delivery
order, and acceptance criteria for that change. [Skill Studio](skill-studio.md)
owns the product experience and reports current coverage. The
[Actor architecture](generic-actor-registry-and-runtime.md) and
[runtime protocol](actor-runtime-formal-spec.md) own the shared machinery. The
[customer database boundary](customer-database-platform.md) continues to apply.
All new fields, types, protocols, tables, and controls below are proposed. They do
not describe APIs that clients can already call.

## 1. Review and decisions

The implementation baseline is Studio commit
`f1153e615fa5a711c7503eaaea0d9adaffa345a8`. The review also used the user-supplied
working copy of `docs/generic-actor-registry-and-runtime.md` in the
`credential-capability-design` worktree, including its “Studio uses the shared
Actor catalog” section. That uncommitted reference had SHA-256
`6d3596db3ad9650e2a1c5ff210ef0f0639658d9d748ca19da5b49978d4a5449f` at review.
This specification records the necessary decisions here without importing or
modifying that worktree. Its HTTP/IMAP and credential designs remain separate
dependencies; reading them does not install their proposed implementations.

The user explicitly removed backward compatibility as a requirement during review.
This supersedes the reference design's proposed v1 adapters: no legacy executor,
definition converter, dual protocol, or rolling-upgrade support is required here.
The new system must still preserve the provenance it creates. Permission to design
a clean cut is not permission to erase an existing environment during implementation.

The preceding proposal was directionally correct but insufficient to implement:

| Finding in the reviewed code | Decision |
| --- | --- |
| `STUDIO_CATALOG` drives the UI, discovery, and compiler; execution switches on two IDs | Replace all four consumers, not just the operation picker. |
| Registry extraction drops methods with no `produces` predicates | Inventory every method; distinguish discoverable methods from proof-producing capabilities. Never invent an output fact merely to retain a method. |
| Studio treats capabilities as one-input/one-output type conversions | Preserve logical requirements, named ports, cardinality, outcomes, and effect semantics. |
| Generic execution accepts only factory targets and `one` slots, and matches outputs positionally | Add live-target dispatch, explicit port results, optional/collection binding, and durable invocation records before advertising these as executable. |
| The production generic host is empty and denies everything | Configure trusted installations, application policy, schema/projector adapters, and factories at the host composition root. A permissive test authorizer is not a production implementation. |
| The generic Store adapter publishes JSON-only outputs, empty evidence, and payload digests | Extend it for bytes, authoritative artifact digests, structural references, causal invocation inputs, and field/byte evidence. |
| SQL runs have a run-level lease and mark expired running work uncertain | Do not call this complete per-invocation recovery or publication fencing. Add attempts, an outbox, and receiver-enforced fences. |
| Review is rejected by Studio; the continuation enum alone proves no approval | Use typed durable review requests, verified decisions, and protected secret ingress shared by all clients. |
| Registry revisions are process-local counters | Retain content-addressed contracts and execution resolutions across restart. A revision number is only a refresh hint. |
| Existing Studio definitions and subscriptions use a narrower model | Replace it cleanly; reject unsupported old programs explicitly. Do not build compatibility adapters or relabel old history as new execution. |
| Arbitrary new capabilities can introduce subscription cycles | Add causal cycle protection and aggregate admission limits before enabling v2 connections. |

Two scope corrections are important. “All Actors” is not “run every method during
discovery.” Also, a Source is a supervised lifecycle with finite capture attempts,
not an infinite step hidden inside an ordinary Skill run.

## 2. Completion contract and exclusions

There are three separately reported completion levels:

1. **Catalog coverage:** every installed, discoverable Actor and method appears in
   the inventory, including explicit missing-contract or unavailable-host states.
2. **Generic finite execution:** every eligible installed capability can be authored,
   planned, and invoked on a supported host without Studio-specific dispatch.
3. **Continuous operation:** admitted Sources survive restart and emit artifacts
   that trigger bounded, durable subscriptions without a foreground client.

Level 1 must not be presented as level 2. Levels 1–2 must not be presented as an
unattended worker. The full initiative includes all three, delivered in that order.
Concrete HTTP/IMAP packages become runnable only after their own security and
publication acceptance gates pass.

First delivery excludes arbitrary uploaded executable code, cross-customer Skills,
hybrid placement within a run, live migration of Actor memory, arbitrary scripting
in bindings, automatic installation, and automatically approving effects. It does
not promise every imaginable business outcome or model accuracy.

### Coverage inventory

Generate a method-level inventory from trusted package installation descriptors and
local bus advertisements. Do not instantiate model, microphone, network, or
effectful Actors merely to list them. CI compares the inventory with host installation
exports and explicitly registered client Actors; every method has a disposition.

| Existing family | Required integration |
| --- | --- |
| Document inspection, decomposition, extraction, classification, assembly, validation, normalization, transaction fan-out, reconciliation | Export manifests, schemas, fact projectors, and factories from the document package. Preserve convenient high-level document Skills while exposing individual eligible methods. |
| LLM, chat, Todo, registry, Studio, window, listening, speaking, and other client-registered Actors | Inventory all methods. Supply accurate operation mode, placement, privacy, retry, slots, and persistence contracts in the owning package before composition. |
| HTTP-resource contracts/acquisition helpers | Do not label helper functions as installed Actors. Integrate manifest, protected executor, publication/evidence adapter, and offers through the package installation path. |
| IMAP prototype and proposed mailbox Actors | Keep prototype import distinct from installed mailbox capabilities. Require bounded query/read contracts and protected credential use before admission. |
| Third-party or future domain package | Satisfy the same installation and conformance contracts; no Studio source changes. |

The generated inventory records definition ID, method/capability ID, package,
supported host, operation mode, readiness, and reason codes. Source-file presence
alone is not installation. Pure presentation methods remain usable as views but
are not inserted into solver proofs. Studio administration methods cannot recursively
grant themselves execution authority or silently create automation.

## 3. Trusted installations and registry identity

Add a shared `ActorInstallation` export contract in `libs/aven-actors`. Each owning
package contributes the following through a host-maintained installation allowlist:

- Versioned manifests and qualified method/capability IDs.
- Parameter and port schemas; schema-to-Store-type bindings with exact versions.
- Versioned trusted fact projectors and observation outcome contracts.
- Procedure/publication bindings, evidence rules, and implementation digests.
- Factory offers or live-instance adapters, with admitted placements and lifetimes.
- Authorization action/resource descriptors, retry and effect contracts, and any
  typed review, secret, stream, or Source contracts.

Separate serializable descriptors from host-resolved executable functions. A
manifest cannot choose an import path, database, protected service URL, or credential.
HTTP resource URLs are validated domain parameters, never runner dispatch addresses.
Code is installed through the existing reviewed build/release process, not the UI.

Keep `ActorRegistry` responsible for definitions, offers, and advertisements only.
Factories own construction and release; the dispatcher owns messaging. Extend
capability extraction so zero-output methods remain in the inventory. Only complete
proof contracts are passed to the solver. Missing mode/retry metadata yields
`contract-incomplete`, not an inferred safe transform.

Compute a `catalogDigest` from canonical, sorted installation descriptors, including
contract, schema, Store definition, projector, and implementation digests. Retain
that descriptor set in protected execution metadata. Reject two different contracts
under the same qualified ID/version. New contracts require a new version.

Live addresses, health, expiry, and local registry revision belong to a separate
availability snapshot. A frozen segment records both descriptor identity and selected
offer/instance identity. Digest equality is evidence of equality, not authorization.
Retain descriptors required by saved Skills and runs even after an offer is removed;
retaining a descriptor does not reinstall executable code.

## 4. Authorized discovery contract

Add a versioned `StudioCatalogPage` projection shared by the UI and agent. Do not
serialize the internal `AuthorizedRegistryView` directly: it can contain host
addresses, configurations, and decision metadata that are not public.

Each visible method entry contains:

- Qualified Actor and capability identity, version, labels, safe description/tags.
- Mode: `transform`, `observe`, `effect`, `stream`, or `view`.
- Resolved public parameter schema and named port schemas/cardinalities.
- Guaranteed predicates and declared observation cases, without private facts.
- Readiness: `ready`, `needs-input`, `needs-connection`, `needs-review`,
  `needs-assurance`, `host-unavailable`, `contract-incomplete`, or
  `unsupported-runtime`.
- Safe prerequisite reason codes and typed next actions; no account metadata unless
  separately authorized for disclosure.
- Supported placement labels, model/network/effect indicators, and known estimates
  with units; an unknown estimate remains unknown.
- `canAuthor`, `canPlan`, `canInvokeNow`, and required runtime feature identifiers.

The page carries `catalogDigest`, an opaque principal-scoped view token, capture
time, expiry, snapshot-bound cursor, and coverage counts for visible entries only.
Default page size is 50, maximum 100. Search operates server-side over the authorized
inventory, not a preloaded 128-row shelf. Unreadable items do not appear in counts,
search completions, goal suggestions, or error messages.

Policy evaluates discover separately from plan/spawn/invoke. A permitted “connect
account” explanation does not create a credential fact or authorize use. Definitions
can be authored while a host is offline; such drafts are not runnable. Publication
requires complete static contracts, not a currently live offer. Starting requires
current executable authority and a valid placement or declared continuation.

Clients refresh on entering Studio, explicit refresh, catalog invalidation, and
before publish/start. Expired cursors produce `CATALOG_REFRESH_REQUIRED`; no page may
mix snapshots. A cached catalog is presentation data only and is partitioned by
customer, subject, and device context. Logout/environment switch discards it.
The native environment rail is a routing selector for the interactive session.
Studio read, edit, and run requests use its exact selected environment, and an
in-flight response from the previous selection must not repopulate the next
customer's local Studio state. The selector does not widen membership, artifact
grants, or Source delegation.

Local advertisements come from the trusted native host, not webview JSON. A server
cannot treat a client-supplied manifest as an executable offer. For Device placement,
the native host combines installed local descriptors with application-authorized
decisions; server policy does not mint local hardware access. Both placements expose
the same projection and obtain fresh application/artifact grants before execution.

At Stage C, implement a concrete application authorizer, not just its interface.
Its inputs are authenticated subject/session or delegated source authority, current
customer membership/entitlement, the installation's registered action/resource
descriptors, exact public configuration, selected placement, and artifact grants.
An unconfigured policy action denies by default. It must evaluate parameter-specific
limits and protected resources at invoke time, not translate every member into an
allow-all Actor role. Device publication accepts only release-installed contract
digests also known to the application catalog; arbitrary local code cannot register
a new server-recognized proof contract by advertising it on the bus.

## 5. Versioned Skill and binding model

Register `studio.skill@2` with payload `version: 2` as the only supported program
format after cutover. The new version distinguishes its meaning; it is not a promise
to support `studio.skill@1`. Never mutate an already registered immutable type.
The shared program schema belongs in `libs/aven-actors`, not the Svelte component.
New control records carry `contractVersion`; no reader guesses a version from fields.

The v2 definition has `name`, named `inputs`, a public `parametersSchema`, `steps`,
named `outputs`, and `policy`. Its `requiredFeatures` is compiler-derived, not a
caller assertion. Input/output ports declare canonical schema ID, predicate pattern,
role, and `one | optional | many`. Schema adapters resolve exact Store keys/versions;
display labels never participate in compatibility. User-defined public parameter
schemas use the supported JSON Schema subset and bounded JSON values.

Each step has a stable `id`, `kind`, optional explicit `after` dependencies, typed
bindings, and a short label. The first v2 grammar has these closed variants:

| Kind | Required semantics |
| --- | --- |
| `invoke` | Exact qualified capability ID, named inputs, public parameters, and optional approved configuration choices. |
| `skill` | Exact Skill artifact ID and version, named inputs and public parameter bindings. Preserve a child invocation boundary. |
| `achieve` | Goal predicates, explicitly admitted ingredients, permitted fact families, hard exclusions, and output-port declarations. Solver fills only this section. |
| `review` | Registered review subject schema, exact subject bindings, and a verified decision output from the shared continuation service. No free-form boolean approval. |
| `forEach` | One sealed collection, stable item name, exact child Skill, fixed companions, bounded parallelism, and fail/partial policy. No arbitrary body script. |
| `when` | Branch on a declared committed observation case or optional presence; explicit branches and same output interface. No evaluation of arbitrary text. |

An `invoke` with no domain outputs is valid when its declared mode and completion
receipt are supported; it contributes no fabricated facts. It may be ordered by
`after`. A `view` opens a projection without entering the dataflow proof. An
unbounded stream cannot be invoked as a finite step; it must use the Source contract.
Finite streams declare completion, interruption, and committed final-output rules.

Bindings are data, never executable expressions:

```ts
// Finite JSON admitted by the public schema; sensitive fields are not admissible.
type PublicJson = null | boolean | number | string | PublicJson[]
  | { [key: string]: PublicJson }

type PortBinding =
  | { kind: 'input'; port: string }
  | { kind: 'step'; stepId: string; port: string }
  | { kind: 'item'; loopId: string }
  | { kind: 'none' }

type ParameterBinding =
  | { kind: 'literal'; value: PublicJson }
  | { kind: 'parameter'; name: string }
```

Actual committed artifact IDs bind Skill inputs at activation. Reusable definitions
do not smuggle authority through fixed IDs. A reusable constant artifact must be an
explicit named input; subscriptions may pin its value. Field extraction and type
conversion are registered capabilities with evidence, not JSON-path coercions.
Sensitive slots cannot use literals, ordinary parameter bindings, or artifact ports.
They name a registered protected-input requirement resolved by the host at attempt
time. Neither secret values nor ephemeral handles are serialized into definitions.

`after` and port references form a DAG within each lexical body. A `when` condition
names a report binding plus a case ID declared by that observer's installed outcome
contract, or tests presence of an optional binding. Branches cannot inspect future
facts; only the chosen branch executes. Nodes outside a branch reference its declared
merged outputs, never an internal node of the other branch. An item binding is valid
only inside its named `forEach`. The compiler checks these scopes before solving.

Resolve user-editable configuration through the offer's public configuration schema;
private defaults stay in the host. Effective normalized configuration is included in
the resolution digest and review subject where relevant. A saved Skill never chooses
an arbitrary running instance or private address. Placement selects a currently
admitted implementation of the pinned capability contract.

### Named results and cardinality

Replace the executor's positional `RuntimeArtifact[]` result contract with named
port results. Each result has a port name, cardinality, and ordered members with
stable member keys and authoritative artifact references. `one` requires exactly
one member; `optional` zero or one; `many` a sealed list, including an empty list.
Duplicate member keys and undeclared output ports are invalid.

Register `os.aven:schema:actors:port-result@1`, mapped to Store type
`actors.port-result@1`. Publish a port-result artifact per declared output port
with the domain outputs in the same publication. Its payload records the invocation,
port, cardinality, and ordered `(memberKey, referenceOrdinal)` membership; structural
`member` references resolve local outputs or explicitly reused existing artifacts.
This records an empty result without claiming that a nonexistent domain artifact
exists. A zero-output invocation uses a registered execution-receipt artifact instead.

That receipt uses `os.aven:schema:actors:execution-receipt@1`, mapped to
`actors.execution-receipt@1`, with invocation, capability/implementation, terminal
outcome, and causal references. It proves recorded completion, not a domain fact.
Register new `studio.activation@2` and `studio.invocation@2` envelopes for the exact
new Skill/input/parameter bindings and parent/member identities. Raw review decisions
and credentials remain private records, not fields of those public artifacts.

Bind by `(invocation, port, memberKey)`, never the first artifact returned or an
incidental SQL order. Whole collections bind only to `many`; empty optional values
bind only to `optional`. `when` must prove presence before an optional feeds `one`.
`forEach` creates one child invocation per sealed member occurrence, even when two
members have equal bytes. Collection joins wait for every member's declared terminal
outcome; they do not query a changing set of “all known” artifacts.

The initial default is fail-fast collection processing. An explicitly selected
collect-results mode returns typed per-member succeeded/failed/skipped records;
failures never satisfy a domain predicate. Cancellation stops unstarted members and
requests cancellation of active children, retaining all committed outputs.

### Limits and nested policy

Initial host ceilings: 16 input ports, 16 output ports, 32 authored nodes per Skill,
8 nesting levels, 64 capability invocations across the activation, 256 members per
collection, 4 concurrent children, 3 attempts per invocation, 16 observation segments,
and 256 KiB of public definition JSON. No old budget semantics are carried forward.
These are configurable downward by policy, not upward by child definitions.

Separate limits for logical invocations, attempts, model calls/tokens, network bytes,
elapsed time, and concurrency. Reserve each applicable unit atomically before work;
retries consume attempt and actual-resource budgets, not another logical invocation.
Children draw from the root ledger and may only narrow it. A missing measurement
adapter cannot satisfy a strict resource ceiling: block with `UNMETERED_RESOURCE`.
No estimated “cost” is presented as money without a declared unit and trusted bound.

Validate cycles, forward references, named ports, schemas, parameter schemas,
guaranteed predicates, branch interfaces, nesting, transitive effects, placement,
and budgets before publication. Missing dynamic input becomes a named prerequisite;
missing static contract is a publication error. Server and client use the same parser.

## 6. Planning, alternatives, and what-if behavior

Planning must resolve and authorize committed input occurrences before using any
facts. Neither a caller predicate nor arbitrary artifact text is evidence. The shared
trusted projector supplies facts with source occurrence, authoritative artifact/blob
digest, projector version, and any applicability/freshness conditions.

The compiler preserves explicit invocation IDs, dependencies, exclusions, reviews,
and input bindings. It submits only `achieve` sections to logical and physical
planning. A zero-step goal is allowed only when authorized committed evidence proves
it. An observer guarantees its report; conditional facts become available only from
validated, committed outcomes. Merge the existing observation-solver seam into this
runtime rather than building an HTTP/IMAP-specific planner in Studio.

Preview response: `valid`, `runnable`, structured issues and prerequisites, exact
input digests, definition digest, catalog/view reference, placement, deterministic
resolved prefix, observation boundaries, transitive effects, and budget estimates.
No preview invokes factories, Actors, model inference, network probes, or Sources.
Reading already-authorized catalog/artifact metadata is permitted. A metadata read
that would require a credential-use probe must instead report a missing prerequisite.

Return at most three deterministic alternatives initially. Order by policy preference,
declared logical cost, then stable capability/offer IDs. Enumerate within explicit
solver bounds and deduplicate equivalent resolutions. Return coverage, truncation,
and stopping reason; no “all possibilities” claim after a bounded search. Guaranteed
and conditional routes are visibly distinct. The current single-result solver needs
an alternatives interface; repeatedly guessing unavailable Actors is not an alternative.

Use a protected preview record with a 10-minute expiry, bound to subject, scope,
definition, inputs, constraints, catalog, and placement. Start supplies the preview
ID and expected resolution digest. Refresh policy and all relevant facts before
admission. Reject changed material resolution with `PLAN_CHANGED` and an authorized
diff. Never silently replace a pinned capability, broaden effects, or move placement.
Unrelated new registrations need not invalidate an otherwise identical resolution.

After admission, each observation commits, projects facts, and closes a plan segment.
Only the unfinished open goal may replan under the admitted policy and remaining
budget. Frozen explicit steps do not change. Exhaustion, unavailable offers, denied
authority, or incompatible catalog changes produce visible blocked/partial outcomes,
not invented successful goals.

What-if uses a separate planning overlay, with up to four variants and clearly marked
hypothetical facts. Its results are not run inputs or normal projected evidence. It
does not execute, publish, spend model budget, or mutate the baseline draft. Starting
real work discards hypothetical facts and repeats evidence resolution. Saved scenario
artifacts remain a separate later feature; they are not necessary for this integration.

The 10-minute preview token applies to interactive starts only. A subscription does
not reuse that token for every arrival: enablement validates and records a bounded
execution policy, and each delivery performs fresh planning/admission against that
policy. New requirements outside its approved contract become waiting work. Explicit
steps stay pinned; open goals may select current authorized offers only within the
recorded effect, placement, capability, and budget bounds. A manual preview is never
renewable unattended authority.

## 7. Shared admission, attempts, and publication

Extend the portable protocol with proposed
`os.aven:protocol:actors:plan-runner@3` for authored Skills. Convert first-party
callers and tests in the same cutover; this initiative requires no @1/@2 reader.
The new command contains protocol, requestId,
idempotencyKey, requestedAt, exact Skill artifact ID, input port artifact references,
public parameters, placement, preview ID, and expected resolution digest. The trusted
subscription dispatcher uses a separate internal admission variant with exact
subscription generation and delivery identity instead of the interactive preview ID;
that variant is not accepted from the public start endpoint. Neither variant
contains authority merely because it references an activation or subscription. It never
contains asserted principal, tenant route, grants, facts, factory code, or endpoints.
The authenticated host resolves the definition and stamps authority as today.

The Studio `start` API translates the public command; it does not introduce a second
execution engine. The existing runner API owns status, continuations, retries, and
cancellation. Device and Server implementations use the same compiler, executor,
binding, and publication core. A run has one placement; all child Skills inherit it.
Device-only actors never silently execute on Server or vice versa.

For each ready invocation:

1. Resolve exact inputs and current read/publish grants. Acquire a fenced attempt
   and reserve root budget. Check customer execution barriers and routing generation.
2. Resolve the retained contract and selected implementation. Reauthorize the exact
   parameters/configuration at spawn and invoke; normalization that changes an
   approval-relevant value requires a new review before execution.
3. Reuse an eligible live advertisement through a trusted dispatcher, or admit/spawn
   its installed factory. Record the ownership/release handle metadata. Renew or
   release resources through the owning factory, never through registry mutation alone.
4. Obtain required verified review/assurance and protected inputs. No secret crosses
   an ordinary Actor's untrusted interface. Suspend durably when prerequisites fail.
5. Dispatch one attempt. Validate named results, schema versions, blob authorities,
   declared outcomes, evidence, and resource usage. Persist a complete publication
   intent plus durable non-secret byte staging before sending it to the Store.
6. Publish the outputs, port-result/receipt records, causal inputs, and evidence
   atomically under the stable logical publication ID and active fence.
7. Acknowledge committed publication, record output bindings, reconcile budget,
   checkpoint, and only then expose outputs as ready inputs. Release resources.

### Durable data and transaction ownership

Define the new schema in the `aven_actor_runs` customer component, using the normal
component provisioning and digest-pinning mechanism on a clean database.
These are shared runtime tables, not a parallel Studio workflow database:

| Proposed record | Key and required invariants |
| --- | --- |
| `run_catalogs` | Digest-keyed retained descriptors; private host details are not public run JSON. |
| `run_segments` | Unique `(run_id, ordinal)`; immutable plan/resolution digest, inputs, placements, and decision references. |
| `run_invocations` | Unique root activation/call-path/member binding key; exact contract, child relationship, state, named results. |
| `run_attempts` | Unique `(invocation_id, number)`; monotonic fence, owner, expiry, resource reservations, outcome and uncertainty. |
| `run_publications` | Unique publication ID and intent digest; pending/committed/acknowledged state, durable staging references. |
| `run_continuation_requests` / `run_continuation_decisions` | Typed subject/revision/digest, reviewer, expiry, CAS lifecycle; no secret values. |
| `run_budget_reservations` | Root activation and attempt; unique reservation per unit, reserve/reconcile transitions. |
| `studio_previews` | Subject/scope-bound expiring plan records; never reusable authority. |

Reuse the existing run/draft/connection concepts, not their old storage shapes.
No data conversion from the old tables is required. FKs and uniqueness enforce
ownership and replay invariants. The worker role owns
attempt/outbox mutation; the API role has only admitted command/control functions
and authorized projections. Neither role owns schemas or credential material.
Add movement, backup, restore, and execution-barrier coverage for all new records.

Run state remains the portable lifecycle. A blocked prerequisite maps to
`waiting_for_input` with a typed reason/continuation; a true execution failure maps
to `failed`. Progress text is not a durable checkpoint. Resuming reacquires current
authority; persisted security metadata and an old identity token are not renewable
permission. Session-bound work waits for an authenticated request after restart.

### Fencing and crash semantics

Run-level SQL ownership is insufficient to fence an HTTP publication. Extend the
Store publication boundary with a trusted execution fence registered per customer
scope/routing generation/logical invocation. SQL claim allocates a monotonically
increasing fence. A trusted lease authority verifies the current owner/attempt/fence
under the claim's CAS boundary and issues an audience-bound, expiring publication
claim. The claim includes scope, routing generation, invocation, attempt, fence,
publication ID, and intended publisher. A stale worker cannot mint a claim from its
service token or advance another attempt's fence.

The Store retains the highest admitted fence and expiry; it verifies the trusted
claim and current fence in the same transaction as publication commit. The worker
first claims SQL ownership, then registers/confirms its claim at the Store, then
invokes. Repeated registration of the same claim is idempotent; lower fences are
rejected. Renewal requires a fresh check of SQL ownership and cannot extend beyond
the admitted execution lease. Clients and Actor result payloads cannot provide
publication authority. Signing/verification and protected claim issuance are part
of Stage C's runtime/Store boundary, not a new permission in a Skill definition.

A replacement worker must confirm the new Store fence and reconcile publication ID
before executing. Publication that committed before fence takeover remains evidence;
publication under the old fence after takeover/expiry is rejected. A stale worker
cannot acknowledge or checkpoint because the SQL CAS also checks its fence. Define
and test this Store protocol extension before enabling durable generic execution;
an in-memory owner check is not an acceptable substitute.

| Crash point | Required recovery |
| --- | --- |
| Before dispatch | Reacquire authority and reservation; no effect has been attempted. |
| After dispatch, before durable result | Replay pure/idempotent work only under its contract; reconcile effects or mark `EXECUTION_UNCERTAIN`. |
| After staging/outbox, before Store commit | Resend the identical intent and recoverable bytes under a newly admitted fence. |
| After Store commit, before acknowledgement | Lookup the same publication and verify its intent digest; do not invoke again. |
| After child completion, before parent checkpoint | Recover the recorded child identity and committed named outputs. |

An external system may not support fencing or idempotency. Exactly-once external
effects are not promised. Such methods require a declared reconciliation strategy
or stop as uncertain; never blindly retry `idempotency: none`. A new attempt gets a
new attempt ID, while its logical invocation and publication identity remain stable.
Different activations, child call sites, and collection member occurrences remain
different invocations even if all bytes match.

## 8. Provenance and protected inputs

Every generic publication must carry root activation, exact Skill revision, current
invocation, parent invocation where applicable, exact causal input occurrences,
implementation contract/digest, and declared structural references/evidence. Preserve
domain-specific field, page, MIME-part, byte-range, and source receipt evidence.
An input mentioned only inside payload JSON is not a provenance edge.

Extend `ArtifactStoreRuntimePort` to use the Store's artifact digest and blob
digest/length, not a JSON-payload hash as an identity for file bytes. Support bounded
durable blob staging and upload/reuse authority. Reusing old output creates an
explicit selection/reuse record referencing its original producer; it cannot turn
that old artifact into a newly produced result of this run. Provenance traversal
reauthorizes every hop and reports inaccessible ancestry honestly.

Required review uses proposed shared schemas
`os.aven:schema:actors:review-request@1` and
`os.aven:schema:actors:review-decision@1` as private runner records. The domain package
owns its review subject schema. The request binds exact invocation, inputs/digests,
normalized public parameters, scope/routing generation, policy, expiry, and permitted
retry units. Reviewer identity is verified at the authenticated boundary, not copied
from a submission. Decision CAS includes request revision and subject digest.

Approve and deny are terminal for that review revision; postpone is durable but
grants nothing. Duplicate identical submissions return the existing outcome;
conflicting submissions return conflict. Expiry or changed review-relevant values
requires a new request. Denial does not cause an automatic new approval prompt or
a broader alternative. Child calls and replans preserve review obligations.

A positive human decision is necessary where policy requires it, never sufficient
authority by itself. Every attempt still rechecks policy, grants, credential version,
and resource claims. Approval is not a boolean artifact produced by a general Actor.

Credential selection uses redacted references and the owning protected HTTP/IMAP
executor. Ordinary Studio/runner roles cannot read plaintext credentials. One-time
secrets use separate protected ingress and attempt-scoped handles; restarting loses
the handle and reopens the request. Redact values, handles, tokens, sensitive URLs,
and account metadata from parameters, artifacts, traces, errors, and model context.
Setting a persistent credential, approving use, and supplying a one-time secret are
distinct operations with distinct authority. The proposed credential component must
be implemented and verified before credential-backed capabilities become runnable.

## 9. Studio and agent interface

Keep Explore, Compose, and Activity. Add an Operations drawer within Explore/Compose,
not another disconnected application. Its default is relevant ready operations;
All operations includes permitted blocked entries and searchable Actor groupings.

| Situation | Required interaction |
| --- | --- |
| Empty or unknown artifact | Offer inspect, choose another input, and authorized catalog search; retain the artifact. |
| Several compatible inputs | Show named ports and artifact chips; require explicit selection where ambiguous. |
| Optional/collection input | Display “optional” or item count; open a bounded member picker. |
| Unmet prerequisite | Short status plus a direct action: select input, connect account, open review, choose placement, or inspect missing contract. |
| Alternative plans | Compact differences in operations, placement, effects, and known/unknown cost; preserve the current draft. |
| Nested Skill | Collapsed card with named boundary ports; expand or inspect exact revision. |
| Observation boundary | Show “inspect first” and declared cases, not a guaranteed future output. |
| Waiting/retry/uncertain result | Specific reason and allowed recovery action; never generic Retry for a permanent denial or uncertain effect. |
| Conflict or stale preview | Keep local edits; show changed fields and reload/copy/re-preview choices. |

Generate forms from a validated JSON Schema subset: object properties, required
fields, enum, string, boolean, bounded numbers, arrays, and supported discriminated
unions. Defaults never become silent consent. Remote `$ref` resolution is forbidden;
schemas come from the retained installed catalog. Unsupported schema features produce
an explicit authoring issue, not a lossy form. Raw JSON is an optional inspector,
not the required way to use conforming supported contracts. Render descriptions as
text, never trusted HTML or instructions to the Aven.

### Skill previews in the artifact library

A published Skill must be discoverable and previewable directly in **Artifacts**,
without first opening Studio. Add a `Skills` filter alongside `All` and `Files`;
the all-artifact listing must include non-blob Skill artifacts and derived Skills,
not just byte-bearing roots. Use the authorized artifact query/index with paginated
type/name search. Do not implement this by increasing a file-only browse limit.

There are two presentations of the same definition:

- **Library card:** Skill icon, name, input-to-output chips, a compact route of up
  to three steps plus an overflow count, and significant model/network/effect/review
  indicators. No generated illustration or model call. Its name comes from the
  Skill payload, not a guessed filename or `localKey`.
- **Selected-artifact preview:** readable named inputs and outputs, parameters with
  safe defaults, a compact step graph, nested Skill cards, conditional observation
  boundaries, limits, effects, and exact revision identity. Expand one child at a
  time; preserve breadcrumb navigation and the selected artifact on return.

Use a deterministic shared `SkillPresentation` builder from the validated program
schema and permitted contract metadata. Proposed fields: artifact ID/digest,
definition version/name, input/output summaries, node/edge summaries, nested
references, declared policy, effect summary with `known | unknown` coverage, and
structured issues. Do not store HTML, executable view definitions, runtime addresses,
or secrets in a Skill. A server/agent can obtain the same structured preview; each
client renders it with its own native components.

Distinguish **definition preview** from **execution preview**. The library renders
the exact saved definition; open goals remain open, with any suggested route clearly
labelled as a current plan rather than part of the artifact. Viewing a card or
expanding a child must not run the solver, execute Actors, spawn factories, sync
subscriptions, publish artifacts, or call a model. An explicit Prepare run action
can request the separately authorized planning preview from section 6.

Actions on the selected Skill are:

- **Open in Studio:** open the exact published artifact read-only, then offer an
  explicit Edit as new revision action. Never silently open a newer mutable head.
- **Use in a Skill:** create a new unsaved draft calling this exact child revision.
- **Prepare run:** choose actual inputs and placement, obtain a fresh plan, then
  present the normal explicit Run action. Viewing is never execution.
- **Provenance:** use the normal artifact lineage view for authorship, predecessor,
  nested references, activations, and visible consumers. Do not mix unrelated runs
  into the immutable definition preview.

The renderer is selected through the artifact semantic-view dispatch for
`studio.skill@2`; `ArtifactsPage.svelte` must not pretend every selected item has file
bytes. Use `ArtifactSkillPreview.svelte` and a reusable compact Skill card, sharing
the presentation builder with Studio. Keep the raw inspector optional.

Static presentation can be cached by artifact digest and renderer version. Transitive
metadata caches also include exact child digests and authorized catalog/view identity.
Reauthorize access on each selection; clear subject/customer caches on context change.
Current execution readiness is a separate expiring overlay and must never be baked
into an immutable thumbnail. Offline, show cached permitted definition content with
readiness unknown; do not imply that an Actor is currently available.

Missing or inaccessible children stay as collapsed placeholders; do not leak their
names, contents, or private requirements. Show an incomplete effect summary, never
“no effects,” when dependency inspection is incomplete. Unsupported program versions
receive a safe Unsupported Skill version card and authorized raw/provenance inspection,
not a legacy executable renderer. Malformed definitions show a bounded error and
preserve access to the artifact's identity/history.

Bound recursive presentation to the program's depth limit and 128 expanded nodes;
detect cycles defensively even though publication rejects them. Render only visible
cards, batch authorized summary reads for a page, and fetch child details on expansion.
No eager recursive fetch of the entire library. Text labels and a keyboard-readable
step list accompany the diagram; color and tiny wiring must not carry the only meaning.

### Shared controls and agent operations

Preserve keyboard paths, focus on validation errors, accessible names, non-color
status cues, reduced motion, and small-window usability. Normal discover/compose/run/
review/recover journeys must not require opening JSON. Agent changes open the same
draft and semantic diff; optional specialized Actor views cannot hide mandatory controls.

Extend the existing customer-scoped Studio transport with versioned operations:

| Operation | Behavior |
| --- | --- |
| `catalog`, `describe` | Authorized paginated methods and resolved contract details. |
| `explore` | Exact input occurrences, desired goals/filters, bounded routes, prerequisites, and coverage. |
| `preview`, `compare` | Non-executing validated plans and overlays, with retained preview identity. |
| `present` | Pure structured definition preview of an exact Skill artifact, with bounded authorized child summaries; no solving or execution. |
| `draft`, `edit` | Revision-CAS replacement or atomic semantic edits by stable step/port IDs; return revision and diff. |
| `publish` | Exact draft revision to the new immutable Skill contract; no execution. |
| `start` | Authenticated interactive authored-Skill admission with expected preview/resolution. |
| `inspect` | Authorized definition, invocation, segment, outputs, and provenance projections. |
| `connect`, `control`, `sync` | Versioned subscription admission and control, never an implicit service identity. |

Continuation submission and run controls delegate to the existing runner boundary.
Add typed request/decision references to that versioned protocol rather than trusting
an unvalidated generic `value`. All mutations use a request ID; reuse with different
material data conflicts. Agent tool schemas are generated from these operations,
not maintained as a second capability list. No arbitrary method name passes through
to a bus handler. Publishing, effects, secret submission, and enabling automation
retain their distinct authorization requirements.

## 10. Sources and subscriptions

Expose finite stream Actors as bounded runs first. A Source installation additionally
declares a versioned source contract: public configuration schema, capture capability,
output ports, cursor schema, occurrence identity, scheduling/limits, authority mode,
and lifecycle implementation. The supervisor resolves these from the trusted registry.
Source code, credentials, sockets, and renewable grants never enter Skill artifacts.

Register `studio.source@2` and `studio.subscription@2` for the new Source contract.
A Source definition pins its source contract and capture interface. A subscription
pins its Skill revision, trigger output/type, source/producer selector, fixed companion
inputs, execution generation, placement, and rate/backlog policy. Initial v2 bindings
are trigger plus fixed inputs; related-artifact joins/windows remain separately gated.

Use a durable source-control ledger in the customer runtime schema: definition head,
enabled state, revision, lease/fence, cursor, next poll/backoff, and last safe error.
Each acquisition has a stable occurrence identity, exact source revision, publication
intent/staging, and commit state. Checkpoint a capture only after its publication is
known committed. HTTP change detection and IMAP UIDVALIDITY/UID handling belong to
their packages and must satisfy the Source adapter contract.

The supervisor uses authorized customer discovery and bounded worker roles; it cannot
enumerate arbitrary customer databases. Session mode requires fresh session proof.
Unattended mode requires a separately issued, scoped, renewable delegation specifying
source, capture capabilities, allowed downstream Skills, budgets, expiry, revocation,
and credential-use policy. A workload identity alone is insufficient. Disallow
unattended activation until those policy and credential dependencies exist.

Definitions and enablement are separate. Source states are disabled, active, backing
off, waiting for authorization/input, draining, or failed. Pause stops new captures;
an already transmitted bounded capture may finish. Resume retains cursor. Identity or
output-contract changes require an explicit new revision/cutover and affected
subscription review; ordinary scheduling changes do not silently reinterpret history.

Dispatch consumes complete Store publications. Commit feed position and delivery
intent together, then admit with a stable generation/anchor idempotency key. New
connections start after the current high-water mark; resume catches up from retained
position. Historical replay is an explicit bounded generation, not a cursor reset.
Source-specific filters use declared emission references/receipts, not a scan for a
hard-coded `studio.email` payload. Remove the old protocol-specific Studio filter.

Before enabling a connection, reject known source/Skill cycles. At dispatch, also
track causal subscription generations: reject a repeated generation in the ancestry,
and enforce a maximum chain depth of 8. Dynamic artifact types make static cycle
analysis alone insufficient. Feedback loops are unsupported in this delivery.

Default v2 controls: 64 enabled connections per subject, 32 admissions per sync batch,
256 pending deliveries per subject, 8 concurrent source acquisitions per customer,
and 60 automatic root admissions per minute per customer. Enforce limits transactionally
across service replicas. Queue saturation retains the unconsumed checkpoint and shows
backpressure; it never drops committed publications. Transitive run budgets also
apply. User-visible limits may be narrowed by policy. Generations from the new
contract retain their identities across pause/resume, not across an incompatible reset.

## 11. Clean cutover and recovery

There is no requirement to execute, convert, or incrementally migrate old Studio
Skills, drafts, runs, or subscriptions. Remove the fixed catalog, dedicated dispatch,
old program reader, and obsolete client call paths when the replacement gate passes.
Do not retain aliases for `document.understand@1` or `report.brief@1`. Register useful
high-level document/brief operations as normal first-party capabilities or newly
authored Skills, not as compatibility wrappers.

Move first-party callers and deterministic test fixtures together. During development,
use a separate disposable environment for the new contracts. Until the cutover is
ready, the user's running local build remains untouched. Switching an existing
environment requires an explicit target and informed approval if it removes data.
Stop admissions and drain or explicitly cancel/reconcile old work before replacing
workers; never reinterpret an old pending row as a new run.

Existing artifact history, if retained, remains opaque immutable history with generic
inspection. Unsupported old Skills are not executable or composable. There is no
automated conversion requirement. A clean cut does not permit modifying an existing
artifact/type definition or presenting a new execution as an old occurrence.

Provisioning order for the new environment: register all immutable Store types with
the matching provisioner; install runtime tables, role grants, and component catalog;
verify exact type-definition digests; start the new hosts; then enable authoring and
execution families whose gates passed. Document concrete commands and any destructive
cutover in the operations handbook when implemented. Missing registered types block
readiness/admission with `CATALOG_NOT_PROVISIONED`, before a user publication can fail
with a foreign-key error. Test this failure by deliberately omitting a type on a fresh
fixture, not by depending on a legacy upgrade path.

Fresh-schema bootstrap may be redesigned. Do not edit migrations already applied to
an environment that is being retained; explicit reprovisioning or a new component
schema version is required there. Compatibility with old data is not a release gate.

Rollback after new-contract writes is not a promised downgrade to the old binary.
Disable admission and use a matching retained release or repair forward. An old
binary must not claim unsupported rows. Recovery of the new system must restore its
catalogs, drafts, cursors, attempts, staging, and review metadata; execution remains
paused under the customer recovery barrier until authority is renewed. Restored
approval/delegation cannot survive a routing-generation change as executable permission.

## 12. Implementation sequence and file ownership

Each stage is a separately reviewable change with an exit test. Later UI can expose
blocked entries early, but cannot claim functionality from a stage that has not passed.

| Stage | Work and owners | Exit condition |
| --- | --- | --- |
| A — contracts and inventory | `libs/aven-actors`: installation/method inventory, catalog projection, new grammar, feature negotiation, digests; owning packages export descriptors. Register new Store types and define the fresh runtime schema. | Every current registered method accounted for; new contracts validated; unsupported contracts explicitly blocked. |
| B — planning, authoring, and artifact preview | Shared compiler/planners and Skill presentation builder; `studio-service.ts`, native `studio_request`, `studio.actor.ts`, `Studio.svelte`, and artifact query/card/semantic viewer. | Same authorized catalog for user/agent, generic named-port forms, CAS edits, non-executing plan previews, and first-class visual Skill previews in Artifacts. |
| C — durable generic core | `executor.ts`, `run.ts`, `host.ts`, `sql-runner.ts`, Store runtime port/server, and provisioner migrations; configure real application policy and trusted factories. | Independent pure multi-output fixture executes with real Store/SQL; crash/fence/revocation tests pass. No allow-all production fallback. |
| D — observations and composition | Shared observation solver, port-result publisher, nested/collection/review contracts and protected ingress. | Optional/empty/many results, bounded fan-out, child review/restart, shared budgets, and byte evidence proven. |
| E — Actor family rollout | Document package, client bus/native host, finite stream/effect packages, HTTP/credential integration. | Generated inventory has an executable or justified non-dataflow disposition for every installed method; document regression corpus and Device/Server parity pass. No generic executor method-name switch. |
| F — continuous operation | Shared source supervisor, v2 subscriptions, delegation integration, HTTP/IMAP capture adapters, Activity controls. | Restart with no client, capture fencing, revocation, duplicate delivery, cycles, and backpressure pass in isolated fixtures. Live account use remains opt-in. |

Stages C–D are security prerequisites, not optional hardening after actors are enabled.
Adding Stage E packages may start earlier behind unavailable-runtime gates. Stage F
depends on the credential/delegation work, not on extracting tokens from saved runs.

Maintain `docs/skill-studio.md` current-coverage section as each gate passes. Update
runtime protocol/schema ownership, package READMEs, and generated inventory together.
The operations handbook owns executable rollout/test procedures and recovery promises.
No claim of “all actors supported” while inventory entries remain contract-incomplete;
report counts and reasons instead.

## 13. Required acceptance evidence

Use deterministic independently owned fixture packages, not new branches in Studio.
The main proof package has a two-input transform with named multiple outputs, an
observer with recognized/absent cases, a sealed collection producer including empty
results, and an effect requiring verified review. Include a local-only view/stream
adapter and a separate synthetic Source installation.

| ID | Test and required assertion |
| --- | --- |
| REG-1 | Install the fixture outside Studio. Catalog refresh, agent discovery, explicit composition, goal solving, and real execution work with no Studio source modification. |
| REG-2 | A zero-output method and a view remain discoverable; neither produces an invented solver fact. An incomplete manifest is visible only where policy allows and is not runnable. |
| AUTH-1 | Different principals see ready, prerequisite-blocked, and hidden projections; paging/search/counts/errors do not disclose hidden definitions or account metadata. |
| AUTH-2 | Revoke between preview, spawn, invoke, and publication. Each affected boundary fails closed; reauthentication cannot resurrect changed approval or credential versions. |
| PLAN-1 | Supply a forged input predicate, unknown schema, wrong Store version, or altered catalog digest. No zero-step or nonzero-step plan accepts it as evidence. |
| PLAN-2 | Preview/compare cause zero Actor/factory/model/network calls and zero artifact writes. Assumed observation outcomes never enter real execution. |
| BIND-1 | Swap output return order, use equal-schema ports, return optional absence, empty/multiple members, and duplicate byte content. Named occurrences and membership remain exact. |
| BIND-2 | Required input cannot bind absent/collection data; explicit presence branch and bounded per-member child calls work. Unknown outputs and duplicate member keys fail validation. |
| RUN-1 | Kill workers at every crash point in section 7, including a child call. Lookup/replay yields one publication per logical invocation and no substituted plan. |
| RUN-2 | Race two workers and expire an old fence while publication is in flight. Store and SQL reject stale ownership after takeover; committed-before-takeover evidence is reconciled. |
| RUN-3 | Unknown external-effect outcome is uncertain, not blindly retried. Pure retries preserve identity and consume the configured attempt budget. |
| REVIEW-1 | Nested review survives restart; approve/deny/postpone/expiry/conflicting duplicate submissions require the correct subject digest, reviewer, revision, and current authority. |
| SECRET-1 | Seed canary secrets, tokens, handles, and authenticated URLs. Assert their absence from artifacts, SQL records, logs, traces, UI projections, scenarios, and ordinary Actor inputs. |
| PROV-1 | Two origins with equal bytes, two activations, two child call sites, cache reuse, and retry retain distinct causal occurrences and the original field/byte evidence. |
| LIMIT-1 | Concurrent descendants and replicas cannot overspend root budgets, source quotas, or customer admission limits. Exhaustion retains visible pending work. |
| CATALOG-1 | Restart with a new registry counter, add an unrelated Actor, remove a selected factory, and change a contract illegally. Retained resolution is verifiable; unavailable work blocks and version collisions are rejected. |
| CUTOVER-1 | Old program/protocol requests receive a specific unsupported-version result. No fallback, conversion, alias dispatch, or accidental admission of old persisted work exists. New-contract history and pinned references survive restart. |
| PROVISION-1 | Omit a required type from a fresh fixture. Readiness detects the exact missing contract; reconciliation installs the complete catalog before sample or generic publication. |
| SOURCE-1 | Synthetic source survives supervisor restart with no foreground client under a bounded delegation. Expired/revoked delegation stops new capture/admission. Session-only mode remains honestly paused. |
| SOURCE-2 | Duplicate emission, lost acknowledgement, pause/resume, contract update, new generation, cycle, full queue, customer movement, and Store epoch change preserve exact delivery/cutover semantics. |
| UI-1 | Keyboard-only and small-window journeys discover, compose, select multiple ports, nest, compare, run, review, trace, and recover without JSON; focus and accessible labels remain correct. |
| LIBRARY-1 | A newly published non-blob Skill appears under All and Skills, has the correct name and compact route, and opens a visual preview without Studio navigation or JSON. File previews continue to work. |
| LIBRARY-2 | Card render, selection, and nested expansion cause zero solver/Actor/factory/model/network-probe calls, subscription syncs, and artifact writes; authorized metadata reads alone are allowed. |
| LIBRARY-3 | Missing/private child, unsupported version, malformed definition, stale readiness, deep nesting, and offline mode have honest accessible previews. Cross-subject cache reuse cannot disclose metadata. |
| LIBRARY-4 | Open/Edit, Use in a Skill, Prepare run, and Provenance preserve the exact selected artifact revision; publishing an edit creates new history and never mutates the selected artifact. |
| PARITY-1 | The same portable fixture executes through native Device and separately hosted Server paths with equivalent canonical outputs/provenance and explicit placement differences only. |

Use the existing unit/compiler and customer-platform suites while iterating. Add
database/Store acceptance to the persistence and full native platform proofs described
in [Build and test](operations/build-and-test.md). Fresh-install success does not replace
PROVISION-1's missing-type failure proof; simulated native IPC does not replace the
real transport journey. HTTP/IMAP
network fixtures use loopback services and test credentials; external provider tests
remain separately authorized and reported.

Completion evidence must identify source revision, installation/catalog digests,
schema versions, host placement, passed test IDs, and remaining inventory gaps. The
decisive outcome is not a larger picker: it is an independently installed Actor
working through the same authorized, inspectable, recoverable system used by existing
Skills, without changing Studio source.
