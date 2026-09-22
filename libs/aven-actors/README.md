# `@avenos/actors`

Transport-neutral actor primitives shared by the AvenOS UI, headless workers, and
future remote actor hosts.

The package owns:

- actor manifests, method contracts, mailboxes, and lifecycle;
- envelopes, the in-process message bus, registry discovery, and derived graph edges;
- Prolog-shaped predicates, parsing, and unification;
- state-machine and QuickJS sandbox execution; and
- the bounded capability planner.

For the full model—including qualified namespaces, spawnable factory offers,
principal-scoped authorization, dynamic actor lifecycles, staged replanning,
resumable human input, and the XRechnung/OCR substitution example—see
[`docs/generic-actor-registry-and-runtime.md`](../../docs/generic-actor-registry-and-runtime.md).
The normative JSON wire protocol and state machine live in
[`docs/actor-runtime-formal-spec.md`](../../docs/actor-runtime-formal-spec.md).

The LLM tool list contains registered named methods, with their argument schemas.
It does not add a generic `send` wrapper; internal envelope delivery remains available
through the message bus.

Bounded public parameter schemas may include a `description` of up to 1,024
characters on each schema node. The shared parser preserves this guidance for
models and forms. Descriptions do not change accepted values or parameter-binding
compatibility; unknown schema keywords, executable references and unbounded values
remain invalid. An ordinary data property named `description` is still validated.

Hosts may attach an `ActorCallContext` to a dispatch. It carries the originating
Intent, cancellation signal, a conversation-routing callback and a presentation
guard separately from model-supplied arguments. Handlers must use that context for
conversation ownership rather than reading a global selection. Background work can
produce results without changing the user's current view. This is in-process host
context, not a serializable wire contract or an authorization grant.

Each Actor mailbox remains serial. An aborted call waiting in a mailbox is rejected
before its handler starts. A running handler must explicitly support cancellation;
aborting an agent cannot roll back completed external effects. Independent agent
runners do not create parallel copies of Actor logic.

It deliberately does not import Svelte, Tauri, the Artifact Store, or an LLM
transport. Views in a manifest use a structural JSON type, while hosts decide how to
render them. LLM access and sandbox capabilities are injected ports.

## Registry to plan

Planning happens at method level because a runnable step must identify an envelope
target and method:

```ts
import { capabilitiesFromManifests, solve } from '@avenos/actors'

const capabilities = capabilitiesFromManifests(bus.actors().map((actor) => actor.manifest))
const result = solve(
  capabilities,
  [{ predicate: 'ceo.aven.docs.file(scan_7)', artifactId: sourceArtifactId }],
  ['ceo.aven.docs.extracted_text(scan_7, page_1, text_1)']
)
```

`capabilitiesFromManifests` prefers a method's `requires` and `produces` declarations.
For a single-operation actor it inherits missing sides from the actor-level contract.
Methods with no guaranteed output remain in the registry/Studio inventory but do
not create a guaranteed dataflow fact or a fabricated solver goal.

The planner produces a side-effect-free ad-hoc program. It does not execute envelopes
or persist run state; those responsibilities belong to a durable runner.

`executePhysicalProgram()` is the first host-neutral executor slice. Given an
authorized physical program, registry revision, security context, factory resolver,
and Artifact Store ports, it binds one schema-qualified artifact per declared slot,
rechecks spawn and invocation authorization, dynamically creates factory targets,
dispatches their envelopes, commits outputs before advancing, and releases each actor.
An optional trusted live-instance resolver can dispatch a selected running target
with a fresh invocation check. It intentionally does not yet implement wider slot
cardinalities, named results, leases, fencing, retries, continuations, or the
persistent run state machine. Those
remain visible boundaries rather than behavior hidden in a document coordinator.

An optional `ActorInvocationHost` brackets dispatch only after fresh invocation and
factory admission. It receives exact admitted input identities and a single-use
dispatch function, and cannot run that function after the hook returns. Cancellation
is checked before dispatch. This host-only port lets the runner retain live admission
evidence or require review without adding another portable execution path. It is not
a field that a model can put into a Skill.

The new Studio primitives in `src/studio` provide a closed `studio.skill@3` parser,
static named-port contract checks, an authorized presentation catalog, and a pure
saved-Skill projection. Catalog ports contain exact Store type bindings only when
they come from the matching trusted installation; a manifest plus an arbitrary digest
cannot make an operation authorable. The shared composer turns such an operation into
a valid v2 step, connects exact ports, exposes unmatched artifact inputs and required
public parameters, and leaves protected inputs to the host. A catalog entry is
runnable only when the trusted host explicitly declares runtime support; manifests
alone never imply that support.
`TrustedActorInstallations` now retains immutable, content-addressed package
descriptors that include Store type/projector and procedure/implementation identities;
an installation with different content under the same Actor version is rejected.
Executable functions and addresses are intentionally absent from those descriptors.
The shared `studio/program` interpreter executes bounded named-port programs through
host-provided invocation, exact child resolution and publication. It supports
nested Skills, serial fail-fast collection loops, presence checks and scalar
observation branches. Parent budgets and model permissions constrain all children.
See the [shared Studio specification](../../docs/skill-studio-shared-runtime.md)
for the remaining review, solver and unattended-source gates.

`checkNamedPortResults()` and `buildPortResultRecords()` define the first v2
named-result boundary. The Runner atomically publishes outputs and sealed membership
records, including empty collections, and verifies exact membership on replay.
The Store registers `studio.skill@3`; the editor and agent use the same scoped
publisher and runtime. Definitions are data, not execution authority.

`studio/agent` supplies the Studio tool contract and authoring adapter for both
native and server hosts. The host injects authorized requests and, optionally, a
case-presentation callback. Each subrequest retains the originating Intent, operation
and cancellation context; cancellation stops subsequent requests, not an already
committed effect. `studio/author` and `studio/compose-authorized` are the same draft
and catalog logic used by the visual editor. New case proposals and revisions are
distinct agent tools: a revision requires its predecessor even for a structural
rewrite, and never confirms the proposal. Native presentation remains host-owned and
is suppressed when that conversation is not the active surface.

The generic `ActorRegistry` additionally distinguishes versioned definitions,
spawnable factory offers, and live instances. `authorizeRegistryForPlanning()` creates
a principal-specific view, and `solveAuthorized()` returns a physical program whose
steps target either a running instance or a factory offer. Factory admission and
per-envelope invocation authorization must still be repeated by the runner.

Static catalog IDs use `authority:kind:namespace:name@version`; construct them with
`resourceId()` rather than concatenating strings. Display labels are not identities.
First-party manifests must choose their authority explicitly: `id.aven` is limited to
principal, authentication, assurance, authorization, and grant evidence; `os.aven`
owns product-neutral actor and execution protocols; and `ceo.aven` owns avenCEO
product, domain, artifact, skill, entitlement, LLM, and action vocabulary. There is
deliberately no legacy or unversioned default.

A physical plan also chooses one `executionEnvironment` (`local` or `server`). Offers
and live advertisements declare where they run, so the same logical proof can be
placed on either host without serializing actor objects or moving durable state out of
the shared Artifact Store.

`ACTOR_RUN_PROTOCOL`, `PlanRunStartCommand`, `PlanRunner`, and the portable-value
validator define the desktop/server seam. `os.aven` owns that generic protocol. All
LLM interaction remains application behavior under `ceo.aven`, even when its HTTP
transport is OpenAI-compatible.

The deterministic conformance test in `tests/executor-conformance.test.ts` exercises
this core for both `local` and `server` physical placements and compares canonical
outputs. Both currently run in-process, so that test proves portable executor behavior,
not the remote HTTP/persistence path. The latter requires the server conformance rail
defined in
[`docs/actor-runtime-proof-strategy.md`](../../docs/actor-runtime-proof-strategy.md).

## Shared value and knowledge Actors

`createCalculationActor()` is the shared exact-decimal implementation used by the
chat bus and the installed Studio runtime. `calculate` accepts bounded decimal
strings, explicit dimensionless/currency/quantity units, and an explicit rounding
choice when needed. It never executes expressions as code, calls a model, converts
currencies, or interprets amounts as cents. Addition/subtraction/comparison require
identical units; multiplication accepts scalar factors and at most one measured
operand. Compound units and arbitrary formula expressions are not yet supported.
The runtime's `values.calculation@2` result retains operands, operation, rounding,
exact result and causal input artifacts. A chat invocation instead retains its
structured result in the conversation's existing tool trace; it does not silently
create an Artifact Store publication or claim independent source verification.
Contextual calculations can supply a result `purpose` and each operand's `label`
and `source` (a human label, optional artifact ID and JSON pointer). These annotations
survive arithmetic unchanged. They describe the selected inputs; they do not prove
that the values match the referenced fields, are complete, or are disjoint.
The card separates those claims from exact arithmetic, exposes supplied source
fields on demand, and explicitly identifies inputs without descriptions or stored
references. Quantity units distinguish counts from money; equal units alone do not
establish that the selected populations should be summed.

`createKnowledgeActor()` likewise has one contract for chat and Skills. Hosts supply
an authorized Store transport; the Store owns schemas, predicate semantics and
snapshot selection. A query reads existing observations without opening source files
or invoking extractors. A productive Skill saves `knowledge.result@1`, including its
query, Store epoch and watermark, with source references for returned rows. Chat
keeps the same result in its tool trace without publishing a new artifact.
Row responses carry the Store's selected collection schema. Only fields declared
`integer-minor` become `items[].money` values; summary groups expose `sumMajor`.
These exact decimal values retain `minorUnits`, `minorDigits` and their currency
unit. Unknown amounts or currency scales produce null, never an invented conversion.
The library and Actor use the same currency-scale helper. Raw source observations
and query predicates still use integer minor units.

## Shared workspace retrieval

The shared retrieval Actor returns explicit continuation arguments with an opaque
search cursor, preserving the original filters. Unfiltered, Intent-scoped message
history also identifies its newest-first ordering and distinguishes contribution
sequences from message ordinals. These are navigation instructions, not automatic
retries or evidence that a source has been fully read.

## Import boundaries

Use the root package for the normal runtime and planner. Import
`@avenos/actors/sandbox` only when a host needs the sandbox's host-capability type; it
is kept on a subpath because that name is distinct from a planner capability.

Application-local re-export modules reference this same library; they do not contain
a separate Actor implementation or runtime version fallback.
