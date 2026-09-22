# Actor runner service (`os.aven`)

This service hosts the portable `os.aven:protocol:actors:plan-runner@2` contract on a
server. It supports exact, exploratory and goal-then-enrich execution; unsupported
protocol versions are rejected rather than adapted. Exploration grants no effects. It is an
authenticated downstream of `api.aven.ceo`, never a route inside `aven.id` and never
an open proxy.

## Trust boundary

The public app sends its short-lived `aven-services` access token only to the
environment-scoped `/api/environments/{environmentId}/actor-runs` facade route. The
facade:

1. verifies the identity token and authorizes access to the selected customer environment;
2. removes caller `Authorization`, cookies, and every `x-aven-*` trust header;
3. derives the customer database and routing generation from trusted platform state;
4. signs a short-lived tenant grant restricted to the actor-run component and action; and
5. authenticates to this service with a fixed service bearer while forwarding the
   original signed identity token and tenant grant.

The runner independently verifies the identity token and tenant grant, including their
subject, session, and role agreement. A command is strict JSON and cannot contain
`security`, a principal, entitlements, grants, a tenant/database name, or a physical
storage route. The runner stamps `PlanRunSecurityContext` only after admission.

The SQL runner supplies an ephemeral lease guard to installed executors. Renewal,
progress and terminal writes require the matching **unexpired** lease; a stalled
process cannot revive expired ownership. An optional host-owned execution prerequisite
keeps accepted input work inactive until its outbox binds the exact run, including
after recovery. This check holds no SQL lock across another component call. Repeated
same-key admission can wake an accepted run, while normal lease acquisition still
prevents duplicate execution.

Shared reviews retain an immutable typed proposal and append-only human decisions.
Only a leased worker can propose; only the interactive API role can decide. Both use
guarded functions rather than table access. The decision binds the request revision,
subject digest, owning user and session. A model-produced boolean is never approval.
`GET /api/actor-runs/{run}/reviews/{review}` reads the owned request; `POST` records an
approve, deny or postpone decision with an expected event version. The existing
continuation endpoint then resumes after checking the retained decision. Lost decision
acknowledgements are resolved by reading the same record, not by assuming failure.
Postponement survives restart; denial and approval are terminal for that revision.
Changing the physical generation or expiring the request prevents use of old evidence.
Studio's empty-output Review step uses this gate, reloading decisions on each pass.
It does not expose a model tool for approving work. Its native card is implemented;
full native qualification is still pending. Connection policy is tested against the
actual SQL review and admitted-invocation guard; remote execution and deployment are
qualified separately.

The optional connection runtime installs HTTP and IMAP Actors into the same catalog
and Studio interpreter. Pure request-building steps never contact a provider. Capture
steps enter the shared runtime's trusted invocation hook; only that hook can register
the active input identities used by `/internal/v1/invocations/read`. The private guard
also checks owner, session, generation and the live SQL lease. Registrations disappear
after dispatch, cancellation or restart. The hook opens the shared review before the
Actor receives dispatch; the Actor cannot approve itself.

Protected proxy results keep their original Store publisher and bytes. A host-only
committed-output handoff tells Studio to publish typed membership references rather
than duplicate those results. Portable Actor JSON cannot supply that handoff. See
[connection configuration and qualification limits](../../docs/operations/local-stack.md#connection-integration-status).

Saved-content Actors are independent of the protected executors: HTTP inspection and
file derivation consume saved responses, while `mail.message-parts` consumes committed
raw mail. Their typed file outputs feed the existing LLM/document Actors. Mail files
retain exact raw-part byte-range evidence and manifest references; equal bytes never
merge separate attachments. The bounded native mail parser is included in the runner
image. Development builds must build it explicitly; see the
[test procedure](../../docs/operations/build-and-test.md#fast-development-checks).

Recovery uses a bounded keyset sweep, including past work waiting for an outbox
binding. A sweep waits only for lease admission, not for model completion; an earlier
slow Actor cannot stop later sweeps. Generic recovery still never repeats an uncertain
effect.

The chat executor, journal and delegated-work lease checker run together in the
isolated real-Qwen proof. A registered journal executor may resume an expired run
only with its exact installed engine digest, with at most three total attempts.
Generic Actors, changed engines and exhausted attempts still become uncertain.
Recovered mutations require an exact receipt; they are never blindly dispatched
again. Declared read-only observations may be repeated with fresh scoped authority,
with their new timing labelled as a recovery read. A trusted method declared both
`transform` and `pure` may be recomputed, with timing labelled separately. A generic
transform or an idempotent effect still requires its original receipt. Validation
failure in a pure transform is a settled rejection, not an uncertain external write.
The final answer, diagnostics and timings have their own checkpoint, so a
lost publication acknowledgement cannot change the saved response. An already
published result closes the run from its exact outbox receipt without another model
call. Movement-fence cleanup also checks the owning execution: an old process cannot
clear a successor's fence.

Each tool checkpoint retains the exact command name and argument string beside its
result. Completion verifies those bytes against the claimed command digest; replay
checks the same binding. These records remain private to the fenced worker, not the
content-free status endpoint. They make saved actions inspectable without extracting
commands from model prose, but do not yet transfer receipts into an edited active turn.

The private settled-receipt reader uses the same exact-run observation as supervision.
It requires the subject, input identity/revision, command digest, physical environment
and routing generation to match, then locks the ended run while checking every retained
command/result pair. It refuses active, uncertain, malformed or oversized histories;
it does not return a partial action list. Only the worker role can read these private
records. This is an internal foundation, not a model tool, HTTP endpoint or enabled
active-edit workflow. A future caller must derive the prior run from an authorized
same-Intent replacement, rather than accept a model-supplied run ID.

The content-free turn-status projection distinguishes a terminal run label from
settled execution. A movement fence means an executor may still be active; a pending
tool checkpoint or explicit uncertain-effect failure means an outcome still needs
reconciliation. Only a terminal, unfenced run with no unresolved tool checkpoint may
release a requested stop. This is not evidence that saved actions were undone. Child
Skill ownership and settlement must be integrated before the full Studio host is enabled.

`chat-model` uses the same request builder, stream framing, cancellation and stall
watchdog as native Chat, with service authentication instead of a desktop session.
It does not install a second agent loop or silently change the selected model.
`ChatTurnHost` loads the exact accepted input and pinned history through the signed
Intent-service transport. It checks the recovered certificate against the stored
subject/session, environment/generation and input digest before constructing the
Actor tools. It retains routing and anonymous-speaker context on follow-ups and
marks omitted history explicitly. Tests and the opt-in background composition share
this loader; there is no test-only conversation reconstruction path.

`createChatActorTools` dispatches installed Actor contracts and resolves original
mutation receipts without a tool-name-specific execution loop. Its shared retrieval
Actor advertises only record types the host can search and read. The server adapter
uses delegated Intent-service history commands, not direct access to Intent tables.
Exact preview excerpts share message identities with full reads; archived history,
feedback and long-text continuation remain available without changing the accepted
conversation destination. This is not yet the complete server-side Studio tool host.

The background artifact reader is a fixed Store transport, not a model-selected URL
proxy. Every read obtains a fresh execution-bound artifact grant through the facade;
the grant supplies the physical database and must match the host's workspace and
generation. The Store retains its existing private-service authentication boundary.
The adapter rejects writes, other scopes, administrative routes and redirects, has a
30-second request deadline, and bounds metadata to two MiB and content to sixteen MiB.
It sanitizes upstream errors and never falls back to a cached login or unguarded
service call. The separate host-only publisher uses the same bounded transport with
fresh write grants and checks the publication's scope, identity and admitted user.
Lost write acknowledgements are uncertain, not reported as failed saves. Its isolated
real-Store test reconciles the original immutable publication and rejects changed
material. This transport does not itself expose a Chat tool. Complete Studio
operation receipts and child Skill lifetime controls remain prerequisites for the
full tool host.

`createWorkStudioAuthoring` is a restricted adapter over the same Studio Actor and
service used by the editor. Each internal read or write exchanges fresh work authority
and checks the current physical lease. It exposes authoring and publication, not
child execution, Source controls or human case confirmation. Draft edits commit an
immutable, invocation-bound snapshot in the same transaction as their revision check.
The worker can recover that original result without replaying the edit, even after a
later edit; the API role cannot read or change these receipts. Skill publication
recovery reads the exact immutable Store commit for the requested draft revision and
repairs its published head only if that revision is still current. It never resends
the publication or overwrites a later edit. Missing receipts remain uncertain.
Studio validation before dispatching any write is a settled rejection, so the model
can correct a malformed command. After write dispatch, a missing acknowledgement
remains uncertain until the exact receipt is found; HTTP error text alone cannot
prove that a mutation did not happen.
Case-proposal recovery uses the same Actor to resolve an immutable predecessor and
looks up the exact proposal; this path is undergoing real-model qualification.
Retained case-evidence IDs keep their source kind, source reference and quotation.
New statements or corrected quotations require new evidence IDs. Both the shared
authoring Actor and the service enforce this before publication; interpretations
may change and removed evidence remains in the immutable predecessor.
The real-model journey
exercises creation, refinement, variants and nested authoring, but the
complete production/native host stays gated on operation recovery and child lifetime.
Publication receipts distinguish an editable draft from its immutable versions, so
the next edit can retain the same Skill identity instead of creating an unwanted variant.

The executor reports bounded model/tool progress without copying prompts, arguments,
credentials or model reasoning. Original tool durations survive replay; receipt-check
and recovery-read timing are distinguished from execution timing. These are implemented building blocks,
not an enabled unattended chat service. The signed HTTP admission, lifecycle and
context/publication transports are exercised in the real-model composition.
Opt-in production startup composes the shared journal, Chat engine, signed work
transport, Tasks, Intent-history retrieval, knowledge queries, calculator and Studio
authoring. It requires the complete background configuration and a built entrypoint;
the engine pin hashes that bundle and model identity, not an unrelated Git HEAD.
Background discovery runs independently of foreground requests. The live-Qwen
composition check proves independent Intents, per-Intent FIFO, cold discovery and
those shared tool paths against signed services and disposable SQL/Store instances.
It is not a separate-process, deployed-stack or native handoff proof. Document-text
retrieval, child execution/lifetime, renewal UX and native projection remain
prerequisites before the desktop migrates to server-owned turns.
The read-only internal work-verification
endpoint is wired into this service. It requires a signed component grant, the matching
work certificate, and the exact live physical workspace and execution lease. It
returns no customer data and cannot run an Actor.
The separate turn-admission handler accepts only a pre-lease, dispatch-bound grant
and no request body. It constructs the installed chat command from the accepted
work certificate; callers cannot choose a Skill, prompt, principal or parameters.
It is registered only with the opt-in chat host and its outbox-binding prerequisite
together; the default generated deployment does not enable that host.

`IDENTITY_ISSUER` remains the token's immutable public issuer. Deployments may set
`IDENTITY_JWKS_URL` to an internal route for the same issuer's public keys; this changes
key retrieval, not issuer validation. `aven.id` therefore remains responsible only for
identity evidence. Product entitlements, actor admission, and tenant resolution remain
`ceo.aven` application concerns at the facade boundary.

## HTTP contract

The public facade projects its environment-scoped route to these private service paths:

```text
POST /api/actor-runs
GET  /api/actor-runs/{runId}
GET  /api/actor-runs/{runId}/events
POST /api/actor-runs/{runId}/continuations/{continuationId}
POST /api/actor-runs/{runId}/cancel
POST /api/actor-runs/studio/query
POST /api/actor-runs/studio/command
```

Unknown and other-user run IDs both return `404`. The events endpoint currently emits
one revision as SSE; it is not yet a live database subscription.

The continuation endpoint accepts one of two strict commands. Postponing keeps the
request visible without supplying a value:

```json
{"requestId":"...","continuationId":"...","action":"postpone"}
```

Submitting carries the typed value only for that executor invocation:

```json
{"requestId":"...","continuationId":"...","action":"submit","kind":"secret","value":"..."}
```

For `secret` continuations, the value is never copied into the run record, checkpoint,
failure message, or Artifact Store publication. A failed unlock must return another
open metadata request; persisting the password to make retries convenient is forbidden.

## Skill Studio

Studio commands use a strict `{ operation, data }` envelope. The query route allows
catalog and saved-Skill presentation alongside state, inspect, explore, preview and
compare, under `actor-runs:read`. The
command route requires `actor-runs:write`; neither accepts caller-supplied security.
The native `studio_request` command and agent `studio_*` methods use this same path.

The Runner's shared catalog lists release-owned Actor manifests for an authenticated
customer without constructing Actors for discovery. Every permitted method is visible;
only methods with complete trusted installation, Store and procedure descriptors are
authorable/executable. Installed server operations include email brief creation,
19 document Actors (21 methods), schema-first knowledge queries, exact decimal
calculations, and Markdown writing and patching. Document
composition invokes the existing ingest handlers through a named-input adapter;
it does not maintain a second set of extraction algorithms. Other client-only
Actors remain visible with explicit execution limits.

The native inventory merges a shared manifest with its server installation. A
missing local Store binding does not conflict with the server's verified binding;
different concrete types or manifest contracts still fail closed. Discovery never
promotes the uninstalled local copy into an executable placement.

The calculation factory adapts resolved Skill parameters to the same Actor used by
chat. Optional model-completion and previous-calculation input ports preserve source
lineage; public operands remain explicit decimal strings and units. A Markdown write
can bind the calculation port and its `/text` field to save a readable result without
another model call. Arithmetic validity does not verify an extractor's interpretation.

`StudioV2SkillPublisher` is the v2-only publication path. It
requires an authenticated CAS-read draft, subject-specific Skill reads, discover
authorization for every transitive Actor call, complete trusted installations, and
the exact registered `studio.skill@3` type digest. It writes immutable Skill payloads
with exact child references and causal producer inputs, including predecessor history.
The native editor, Studio Actor and production host use this same seam.
`StudioV2Drafts` and `StudioV2Authoring` provide the corresponding fresh v2 draft
CAS and immutable-head orchestration. Creation is serialized per subject, exact
revision updates never overwrite another client, and a Store commit that loses the
draft-head race reports the committed artifact ID for recovery. No v1 reader or
definition conversion exists in these seams. The authoring boundary also provides
subject-scoped list/get and the shared side-effect-free preview; replay of an already
published head verifies the returned artifact's exact identity and scope.
`StudioV2SkillValidator` is shared by publication and the side-effect-free v2
authoring preview. It resolves exact readable children transitively and validates
every nested Skill interface and Actor call against the same trusted installation
set. Preview reports structured issues and never invokes an Actor, model, Source or
effect. Unsupported control-step/runtime combinations return structured preview
issues and cannot be published as runnable Skills.
Model requirements come from trusted procedure descriptors. Preview and publication
also reject a model-using descendant beneath any Skill with model access disabled;
the error identifies the restrictive Skill. Permissions are never enabled implicitly.

The shared bounded interpreter is exported from `@avenos/actors/studio/program`. Immutable Skill
definitions pin child artifact IDs, while activations pin the exact root Skill and
input artifact IDs. Execution revalidates the current trusted installation contracts
before execution. Every child invocation and Actor publication retains its causal
inputs and stable step identity.
Named ports carry one, optional or many artifacts; empty collections are sealed
results, not missing output. Serial fail-fast loops, exact nested Skills, presence
checks and scalar observation branches execute under shared budgets and intersected
model permissions. Partial-result loops, solver goals and durable reviews fail
closed. Runtime
admission revalidates the exact Skill/child graph, current authority and trusted Store
projections. Cancellation stops new work/publication, and subscription admission
rejects cycles over internal as well as public outputs.

Output artifacts and `actors.port-result` membership records commit together. Replay
loads ordered references from the Store's scoped reference resource, never from an
assumed envelope field or incidental output order. Markdown patches require each
search string to occur exactly once, create a new artifact, and retain the original
as a causal input. Neither method overwrites a document.

Customer Actor schema version 2 stores draft revisions, connection cursors and
delivery intents. The API role manages these records; the worker still accesses
only runs. A dispatcher saves matched delivery intents and the feed cursor in one
database transaction, then admits them using stable activation identities. Store
publication replay is the authority after a lost acknowledgement. Upload claims
are temporary byte permissions, never run or capture identities.

Dispatch is request-driven under a freshly admitted user session. No user token is
persisted as an unattended credential. Synthetic captures and generic derived
artifact subscriptions are implemented; IMAP/HTTP supervision, service identities,
related-artifact joins, Review execution and cross-device execution are not.
Definitions do not confer authority to perform external effects.

See [Skill Studio verification](../../docs/skill-studio-verification.md) for exact
coverage and [build and test](../../docs/operations/build-and-test.md) for the
database-backed and browser checks.

## Persistent backend and recovery

`SqlPlanRunner` stores every admitted run in the selected customer's PostgreSQL
database, under `aven_actor_runs.runs`. The database enforces subject-scoped
idempotency; a stored material hash prevents reuse of an idempotency key for a different
command. Status and cancellation operate on that durable record, with a revision check
protecting concurrent cancellation.

Execution starts after admission commits, outside request handling. Each cached customer
runner admits up to two executions at once and scans queued work every five seconds.
It commits a running state and 30-second ownership lease using a short transaction,
then releases the database connection while executing. Heartbeats extend the lease;
status and progress use independent short queries. Execution has a 15-minute no-progress deadline.

By default, after service restart the first authorized request discovers that
customer's pools and starts recovery without waiting for queued work to finish.
With background work configured, a bounded supervisor obtains signed active worker
placements from the control plane and discovers accepted work without a user request.
Each placement is revalidated before opening its customer pools. Neither path accepts
a model-selected physical database. Pool eviction and process shutdown abort and
drain active work before closing database connections.

Expired running leases become `EXECUTION_UNCERTAIN`; recovery never replays them.
An explicit retry request (`POST /api/actor-runs/{runId}/retry`) moves a settled failed
run to planning, preserves its identity and checkpoints, and records its previous
failure and attempt count. Repeating the same retry request ID is idempotent.
Cancellation updates the durable state and propagates an abort signal to execution.
Customer execution markers remain until the executor settles; expiry is not proof
that arbitrary external work has stopped. See the
[recovery handbook](../../docs/operations/backup-and-recovery.md) for movement and interrupted
execution boundaries.

`SqlPlanRunner` accepts a host-composed `PlanRunExecutor`. Its persistence E2E test
injects the generic executor core, plans a deterministic skill, dynamically admits and
invokes a server factory actor, and stores the completed steps, artifact IDs, registry
revision, and policy-decision IDs in the durable checkpoint. The same test executes the
fixture locally and compares canonical outputs and provenance.

With a PostgreSQL test URL, the split-architecture E2E test carries that same fixture
through a signed identity token, the public facade route, a scoped tenant grant, the
private runner HTTP route, `SqlPlanRunner`, and the injected generic executor. It reads
the terminal record back through the facade and compares the server artifacts and
provenance with the local executor result. The fixture shares one implementation across
the direct-SQL and authenticated-HTTP tests, so those paths cannot quietly drift into
different examples.

The deployed composition in `src/index.ts` has two explicit layers. Registered
application skills are selected by an application executor catalog. Its first entry is
`ceo.aven:skill:docs.ingest:document-ingest@1`, which fetches the admitted source from the selected
tenant's Artifact Store, runs the headless document runtime, and publishes every
derived artifact with the runner's dedicated store identity. It discovers a
vision-and-structured-output model through the API facade's service-authenticated
internal LLM contract and uses the same model adapter and actor graph as the desktop.
`LLM_GATEWAY_BASE_URL` and `LLM_GATEWAY_BEARER_TOKEN` configure that private edge; the
bearer is distinct from the runner's ingress and Artifact Store identities.
`ACTOR_RUNNER_MAX_PARALLELISM` bounds concurrent customer runs (1–32, default 5).
The document runtime uses the gateway catalog's advertised model parallelism for
independent page actors, while the API gateway limits aggregate model requests.
Uninstalled exploration skills fail at dispatch. Other exact-goal commands fall through to the
portable generic executor. That fallback has an empty registry and
fail-closed authorization, factory, and Artifact Store ports, so an unknown skill
cannot accidentally execute.

`SqlPlanRunner` requires the composed executor explicitly. Its protocol and repository
implement metadata-only continuation suspension, postponement, and resumption. They
must gain per-effect fencing before workers execute arbitrary non-idempotent effects.
Run leases prevent silent replay but cannot make a remote side effect transactional.

## Local start

Copy `.env.example` into your development environment and configure the facade with the
same bearer token and component contract:

```json
{
  "segment": "actor-runs",
  "baseUrl": "http://127.0.0.1:3010",
  "targetPrefix": "/api/actor-runs",
  "bearerToken": "replace-with-the-same-32-byte-service-token",
  "componentRef": "os.aven:component:actors:run-repository@1",
  "readAction": "actor-runs:read",
  "writeAction": "actor-runs:write",
  "roles": ["user", "admin"]
}
```

Then run:

```sh
bun run --cwd services/actor-runner dev
bun run --cwd services/actor-runner check
bun run --cwd services/actor-runner test
```

The focused HTTP E2E suite uses real ephemeral identity, facade, and runner boundaries.
With `TEST_ACTOR_RUNNER_DATABASE_URL` set, the persistence suite additionally proves
both process-replacement recovery and generic deterministic execution against real
PostgreSQL. It exercises the generic executor both directly through `SqlPlanRunner` and
through the authenticated HTTP path. With `TEST_ARTIFACT_STORE_BASE_URL`,
`TEST_ARTIFACT_STORE_BEARER_TOKEN`, and `TEST_ARTIFACT_STORE_SCOPE_ID` also set, that
authenticated path resolves its source and publishes its output through the real store,
persists the returned artifact ID in the SQL checkpoint, reads the producer lineage
back, and compares the server result with local execution.

`tests/document-lane-conformance.test.ts` sends deterministic text, CSV, a real
repository PDF, a model-backed invoice image, and a model-backed statement case
through the production browser decoder and through the production headless document
executor. It compares the canonical presentation and the complete
publication graph: procedure keys, ordered inputs, parameters, payloads, blob hashes,
evidence, types, and stages. Generated IDs and physical placement metadata are the only
excluded fields. It also proves equivalent model requests, unavailable-model fallback,
hard-failure behavior, and absence of invented finance outputs. The fresh-stack
Playwright journey repeats the comparison for a text
fixture through the real Tauri client, facade, persistent runner, PostgreSQL, and Rust
Artifact Store.

`ArtifactStoreRuntimePort` is the concrete adapter for generic executor fixtures. It
resolves committed envelopes through `ArtifactStoreClient`, maps registered type
versions to canonical runtime schemas, and accepts a fact only when a trusted projector
derives the predicate from the validated payload. It never turns a caller-asserted
predicate into a fact by echoing it. For outputs, explicit capability-to-procedure and
schema-to-type bindings produce one atomic production-run publication with ordered
inputs and a deterministic UUID derived from the stable run-step identity.

`tests/artifact-store-port.test.ts` verifies the canonical HTTP request, bearer and
epoch headers, fact-projection rejection, production-run lineage, output mapping, and
stable publication identity. Its deterministic HTTP fake keeps malformed projection
and wire cases fast.

`tests/artifact-store-port.persistence.e2e.test.ts` runs the same adapter against the
real Rust service and PostgreSQL. It publishes a registered source artifact, resolves
its projected fact, commits a derived production run, reads its output and ordered
producer inputs back, and proves replay returns the same output ID. The full-stack E2E
harness starts a fixed-scope conformance store beside the tenant-mode application store
so this test runs in the release gate. The authenticated split-architecture test also
injects this port into `SqlPlanRunner`, proving both durable boundaries in one run. The
document application executor instead uses its own tenant-bound publisher because its
current DAG supports dynamic page fan-out and many-valued inputs that the narrow
generic executor does not yet model.

## Container build

The Docker build follows the split services' packaging convention. The project
`.npmrc` is excluded from the build context. A GitHub Packages token is mounted as
`--secret id=npm_token,env=NODE_AUTH_TOKEN`; the build creates a minimal temporary
registry config, performs the install, and removes the config in the same layer. The
credential is never sent in the build context or copied into an image layer.

Routine tenant-pool eviction skips runners with live execution, recovery or drain work.
Eviction awaits runner shutdown before ending its connections. If all pools are busy,
new tenant admission fails with a retryable service error. Starts and retries queue;
secret continuations are refused with a conflict when execution capacity is occupied
and must be resubmitted by the caller. Persisted progress renews the execution
no-progress deadline, allowing long documents to continue while chunks complete.

The internal turn-status handler accepts a signed current-runtime Actor placement and
the exact admitted run/input reference. It returns only bounded state, not prompts,
progress, output or exception text. Intent supervision uses this to distinguish
stopped work from slow or unavailable work. A generic retry cannot restart a journaled
conversation: its owning Intent must reconcile effects and renew authority through
the still-pending control flow. See the [internal work boundaries](../../docs/operations/build-and-test.md)
for endpoint configuration and qualification limits.

The authenticated `GET /api/actor-runs/chat-turns/{turnId}` is a separate public
progress read. It selects only that customer's and subject's existing chat run,
returning state, read/update/lease timestamps and at most 24 model/tool operation
measurements. It neither constructs an executor nor reads the private execution
journal. Prompts, arguments, outputs, exception text, run IDs and credentials are
not part of the strict projection. Another member of the same customer environment
still cannot read the owner's progress. A turn not yet dispatched returns 404; its
queue state remains owned by Intent Service. A lapsed lease indicates uncertainty,
not completion or permission to replay effects. Completed/replayed operation
durations retain the original execution or receipt-check basis. Schema version 6
adds the bounded lookup index without broadening database-role permissions.
