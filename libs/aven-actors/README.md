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

The new Studio primitives in `src/studio` provide a closed `studio.skill@2` parser,
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
These are foundations, not a general production Studio executor. See the
[shared Studio specification](../../docs/skill-studio-shared-runtime.md) and its
acceptance gates before enabling additional Actor families.

`checkNamedPortResults()` and `buildPortResultRecords()` define the first v2
named-result boundary. The Artifact Store registers neutral port-result and
execution-receipt types, but the host still needs one fenced atomic publication
adapter before any additional Actor can claim durable v2 execution.
The Store also registers `studio.skill@2`; a tested Runner publisher can commit that
version through host-supplied authority, but the current editor and execution runtime
do not yet expose it.

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

## Import boundaries

Use the root package for the normal runtime and planner. Import
`@avenos/actors/sandbox` only when a host needs the sandbox's host-capability type; it
is kept on a subpath because that name is distinct from a planner capability.

The old application paths under `app/src/lib/actors` remain compatibility re-exports
while consumers migrate.
