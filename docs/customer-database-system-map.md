# Customer-database system map

Status: authoritative current-state map

Product terms and ownership-claim boundaries are defined in the
[product model](product-model.md).

This page maps the normative
[customer-database boundary](customer-database-platform.md) onto the code that exists
today. It describes components and trust relationships, not operator procedures. Use
the [operations handbook](operations/README.md) to build, run, deploy, inspect, or
recover the system.

## Deployed topology

```text
clients
├── browser
└── Rust/Tauri application
      │
      ├── aven.id ───────────── identity host
      │   ├── Caddy
      │   ├── identity service
      │   └── identity PostgreSQL
      │
      ├── portal.aven.ceo ───── platform host
      │   ├── checkout
      │   ├── email worker
      │   └── platform-event worker
      │
      ├── api.aven.ceo ──────── platform host
      │   ├── facade
      │   ├── platform provisioner
      │   ├── Artifact Store
      │   ├── Intent Service
      │   └── Actor Runner
      │
      └── aven.ceo ──────────── managed static host on platform host
```

The diagram shows production. The same platform subtree exists at the three `next`
origins. Identity, `next`, and production have separate Hetzner servers, networks,
protected data volumes, PostgreSQL clusters, deployment bundles, SSH identities, and
backup repository prefixes. No database credential crosses between the hosts.

## Public trust boundaries

| Boundary | Trust decision |
| --- | --- |
| `aven.id` | Authenticates the stable subject and signs short-lived `aven-services` tokens |
| `portal.aven.ceo` | Verifies payment-provider messages and records commerce facts; it cannot authenticate a user |
| `api.aven.ceo` | Verifies identity, evaluates current entitlement, selects one customer environment, and issues a bounded downstream tenant grant |
| Domain service | Verifies workload authentication and the tenant grant, then opens only the selected customer's store |
| PostgreSQL | Enforces database and schema isolation even if an application route is wrong |

Caller-supplied authorization, cookies, `x-aven-*` identity projections, tenant grants,
database names, and routing values are stripped or ignored at the facade. Clients never
receive a database URL or internal service credential.

## Central databases

Identity owns its account, passkey, session, device authorization, and signing-key
state in the identity cluster.

The platform cluster contains bounded central databases for:

- checkout, billing, email/platform outboxes, and raw signature-verified Polar
  deliveries; and
- facade authorization, customer directory, component catalog state, provisioning
  operations, reconciliation, and routing generations.

Central databases deliberately do not contain customer artifacts, Intents, Actor runs,
documents, or chat history.

## One database per customer

Each paid platform name creates one customer environment. The same identity subject
may own several names and therefore several environments. Each environment receives
one PostgreSQL database named from its stable environment UUID. It contains:

```text
cust_<environment-id>
├── aven_platform      reconciliation metadata
├── artifact_store     artifacts, blobs, evidence, and production runs
├── aven_intents       intents and contribution history, including chat
├── aven_productivity  tasks, immutable command receipts and task revisions
└── aven_actor_runs    durable Actor runs, Studio drafts, connections, deliveries
```

`PUBLIC` access is revoked. Database and schema owners are `NOLOGIN`. Each executable
function receives a customer-qualified login that can connect to exactly one customer
database and access only its component schema. Artifact, Intent, and Actor roles cannot
read each other's tables or create arbitrary objects.

The provisioner supports exact SQL-function grants as well as table privileges.
Signatures use a closed set of built-in argument types; granting one overload does
not grant another. Reconciliation verifies every runtime login's declared privileges,
without executing write functions or selecting secret rows. A migration introducing
protected functions must revoke their default `PUBLIC` execution privilege explicitly.
This is provisioning support, not an installed customer credentials component.

The productivity component starts at schema version 1. Its API role has
`SELECT`, `INSERT`, and `UPDATE` on tasks, and only `SELECT` and `INSERT` on command
receipts and task revisions. The Intent Service hosts its HTTP endpoints in the
same process but uses a separate credential root and pool. Linking a task change to
an Intent requires a second signed, same-environment Intent-read grant; the owning
Intent service verifies both ownership and the optional contribution reference.
Batch changes and their receipts commit atomically. A stale revision rejects the
whole batch; same-operation retries return the original outcome. Trials use an
explicit temporary repository with the same domain reducer. Native and Skill
integration are being qualified and are not yet a passed release guarantee.

Response feedback lives with conversation contributions in `aven_intents`, not in
browser storage or a central analytics database. Each human `response-feedback`
contribution names the exact assistant message, its up/down vote (or a cleared vote),
an optional reason, and the preceding feedback revision. The service checks the
owned Intent and response inside the append transaction. Replays return the original
receipt; stale concurrent edits conflict. Original replies and earlier feedback are
retained. Read projections attach the latest feedback to its reply independently of
the recent-history page. Feedback is not presented as a new message or fed back into
the agent prompt. This uses the existing contribution schema and scoped write grant;
it adds no database role, table or compatibility path.

Intent component schema version 4 separates durable work order from conversation
chronology. A queued replacement is a new, signed input with an immutable link to
its predecessor and a revision-checked FIFO position. It cancels only the replaced
pending delivery, including a reservation not yet bound to a run; later queued
messages remain behind the replacement. Original contributions and admission receipts
remain readable. A conflicting edit or a run already bound to an executor rejects
the replacement without changing either request. Stopped-run receipt transfer and
native Edit controls are not implemented; this internal queue slice does not claim
the complete edit-while-running UX.

Actor component schema version 2 adds Skill Studio's revision-checked draft heads,
subscription cursors and durable delivery intents. The Actor API role receives
`SELECT`, `INSERT`, and `UPDATE` on these three tables; the worker role remains
limited to the run table at that schema version. Published Skills, synthetic Source definitions, captures,
activation/invocation receipts and results remain in the Artifact Store, accessed
through its scoped API. Studio does not read Artifact tables directly.
Schema version 3 adds the immutable origin-Skill reference to a copied draft.
Publication validates that exact readable Skill and records it as a causal input;
the draft row is not the permanent provenance record.

Actor component schema version 4 adds the private ordered `run_steps` journal and a
pinned engine/start time on the owning run. Only the worker role receives access to
the journal (`SELECT`, `INSERT`, `UPDATE`). A security-barrier `run_settlement` view
gives the API and worker roles a run ID and an unresolved-tool boolean, not journal
values. The worker uses the same projection before private settled-receipt inspection;
the API still cannot read the journal.
Every journal operation checks and locks
the current unexpired run lease. Recovery reuses completed model responses and
operation receipts; an interrupted effect requires reconciliation. The journal also
pins the final answer and its timings. The SQL runner supports opt-in restart for an
installed executor with the exact recorded engine digest, bounded to three attempts;
generic or changed executors still fail closed. Execution ownership also fences
movement-marker cleanup. These paths have isolated real-Qwen/SQL proofs, but production
transport and customer discovery are not yet an enabled unattended chat dispatcher.

Actor schema version 5 adds immutable `studio_draft_receipts`, keyed to a private
tool invocation. The worker gets draft `SELECT`/`INSERT`/`UPDATE` and receipt
`SELECT`/`INSERT`; the API gets no receipt privileges. Saving a background draft
locks its current run and pending invocation, checks the physical execution epoch,
and commits the exact draft snapshot with the edit. Recovery reads that snapshot,
not the latest mutable draft. Separate Skill-publication recovery reads the immutable
Store receipt and uses the same lease-checked transaction to acknowledge the head
only if its draft revision is unchanged. A later edit is never overwritten, and a
missing Store receipt never authorizes another write. No cross-service transaction
is claimed. Delegated child execution remains unqualified.

Actor schema version 7 adds private immutable `review_requests` and append-only
`review_decisions`. Neither runtime role can access their tables directly. The worker
can open a bounded request under its current run lease; only the interactive API role
can decide an exact revision/digest for that user's waiting run. Shared functions check
the customer generation and execution fence. The schema owner can take a shared lock
on the platform identity row but these functions never change its movement counter.
The native card and empty-output Studio barrier use these records; real-Qwen/SQL tests
cover sequential gates, restart, refusal, approval and prevention of model-authored
approval. The real management proof also exercises connection-policy adapters against
the actual admitted Actor invocation, current grants, Store input and private review.
The isolated native connection journey covers settings and exact-request review denial;
full hosted connection deployment remains unqualified.

The optional credentials component has independent set, metadata, match, HTTP-use and
IMAP-use roles. Set-only ingress stores public-key-sealed values; only a protocol-use
claim can release ciphertext to its protected executor. Metadata and match cannot read
values. Current generation, binding revision, secret version, claim ordinal and bounded
use authority are checked transactionally. This component is not installed by default;
its ingress and fixed-protocol executors are opt-in in the local composition, not yet
enabled in the hosted customer stack. Operator installation queues the ordinary
provisioner only for a ready, stationary environment on the current runtime.
Optional HTTP/IMAP factories use shared Actor admission and Studio execution. A
host-only result handoff keeps the protected publisher's existing artifact identities;
Studio adds typed port membership, not copies of those observations. The runner's
private invocation guard reads only currently active host registrations and checks the
SQL run lease and generation. Restart discards registrations and fails closed; resume
must enter shared admission again. No caller JSON can create a registration.
Each first use adds its own UUID to the physical execution markers. The protected
host removes only that marker after protocol shutdown and publication have stopped;
finishing one IMAP command does not settle the session. Expiry never removes a marker.
The current movement path conservatively refuses an outstanding connection marker
rather than treating an Actor's completed lease as proof that its remote use stopped.

Intent schema version 2 adds `input_admissions` and `turn_outbox`. One transaction
checks the owner and target, optionally creates an Intent, appends the exact human
contribution and records its runnable delivery. `(subject, inputId)` binds the accepted
revision and material digest so a lost acknowledgement or racing edit cannot duplicate
a message or retarget it. Receipt lookup still works after an Intent is archived,
merged or tombstoned. These state changes cancel unbound delivery and block bound
work in the same transaction; restoration does not revive it or release an unsettled
predecessor.

Intent schema version 3 adds the due-time index for bounded supervision of dispatched
turns. Status checks advance the due time without taking execution ownership. A
separate supervisor can block an expired turn or a stopped runner that never saved
its answer; it cannot repeat an action or rewrite a concurrently completed answer.
The owner-scoped queue projection and revision-checked Stop endpoint are implemented.
Stop withdraws new work authority; bound execution holds FIFO until the supervisor
observes an ended executor with no unresolved tool checkpoint. Known settlement
records an immutable system contribution; uncertainty remains blocked. Native
controls, receipt reconciliation, renewal and production background qualification remain
pending. Intent readiness uses the pinned component catalog version and digest, not
a separately maintained version number.

The customer-local outbox repository claims one earliest unfinished turn per Intent,
with a thirty-second dispatch lease and a pinned conversation watermark. Future queued
human contributions are excluded from that turn's history. Completing or failing a
turn commits its exact assistant contribution and releases the next turn in one
transaction; lost replies return that same output identity. Expired authority blocks
the affected queue without blocking other Intents. These repository boundaries have
real-PostgreSQL tests; they are not yet an enabled background dispatcher.

The facade signs a distinct one-hour work certificate for the exact accepted input
and the currently available component actions. Intent Service verifies its subject,
session, environment, generation and material binding before retaining it with the
outbox. The certificate is not a saved login token or a monitoring delegation. The
API role can read/insert admission records and read/insert/update outbox records.
The shared `@avenos/intents` package owns the input, receipt and canonical digest.
The internal work-grant exchange requires both a live outbox/runner-lease check and
current control-directory authorization, then issues a component grant bounded to
that work, turn, run and lease for at most sixty seconds, capped at the current lease
deadline and parent certificate expiry. Work admission does not apply login clock
grace. The separate work admission helper never constructs an identity or
accepts mixed login/work headers. Tasks use the same domain handler for both forms
of admission and bind delegated changes to the actual accepted contribution. The
real-Qwen task proof exercises these paths with signed permissions and restricted
database roles and actual exchange/guard HTTP requests. The facade's opt-in internal
exchange route checks the current Intent outbox and runner lease over fixed,
operator-resolved service routes; probes return no customer content. See
[the work-exchange configuration boundary](operations/build-and-test.md#live-studio-workday).
Dispatcher startup is opt-in; renewal UX and native integration remain pending.
Existing desktop turns still execute locally.

The opt-in work control also provides signed queue-discovery placements. The
requesting service must match the operator credential for the exact runtime and
component. Only active, generation-matching component placements appear in bounded
keyset pages. These sixty-second certificates contain no customer principal or
session and are invalid as tenant/work grants. The component pool rechecks physical
generation and execution state; Intent discovery returns only eligible turn IDs and
owner scopes. Individual work certificates still govern execution. The HTTP discovery
transport feeds a bounded delivery supervisor with interleaved queues, failure
isolation and shutdown. Its real-Qwen proof advances past unavailable databases
without blocking healthy work. Signed runner admission and lifecycle/context transport
are implemented and exercised in that composition. The service entrypoints now wire
these same components behind all-or-none background-work configuration. Actor Runner
requires a bundled executable and pins its bytes, runtime and model identifier for
recovery. Its Chat host installs shared history, task, calculation, knowledge and
restricted Studio Actors with fresh delegated authority. Production startup qualification,
document retrieval, child execution and the native switch remain pending; generated
deployments do not enable unattended chat.

Admission uses a distinct pre-lease dispatch grant bounded to the live outbox claim.
It admits only the fixed chat-turn Skill with reference parameters derived from the
accepted certificate. It cannot authorize tool execution. Intent Service's narrow
lifecycle endpoint accepts a signed current-runtime Intent placement and an exact
admitted run/input reference. It returns coordination state, a completion receipt,
or the original live work certificate for lease-checked resumption; never conversation
content. Completed work does not regain execution authority. Shared `ChatTurnHost`
code verifies all bindings before loading context and constructing installed tools.

The outbox dispatcher and runner prerequisite are separate building blocks. A run
may be admitted before its dispatcher receives the reply, but cannot acquire an
execution lease until the outbox binds that exact run. A repeated same-key admission
wakes an accepted run without creating another one. Bounded keyset recovery sweeps
advance past blocked prerequisites and await admission, not the entire execution.
No execution lease or certificate
is included in its idempotency material. This does not yet establish unattended
startup discovery or automatic recovery of interrupted chat execution.

Unassigned input is kept outside customer history in an encrypted native draft file
bound to API origin, subject and environment. File locking and revision checks prevent
one desktop process overwriting another's snapshot. The device key is protected by
local file permissions; this is not a claim of protection against a compromised device.
Browser previews remain session-only and do not write plaintext drafts to localStorage.

Artifact component schema version 4 adds read indexes for the source-bound library.
The library projects original documents and current validated financial observations
from immutable artifacts; it does not create mutable entity records. Its scoped read
path uses the verified customer database and environment, and the native client does
not provide physical routing.

The same library route exposes schema discovery, exact property predicates and
whole-selection aggregates. Knowledge results remain immutable customer artifacts,
with a query/watermark/Store-epoch receipt and exact references for returned rows.
This is a read projection over existing observations, not an entity resolver or a
background relationship-mining service.

Unassigned desktop uploads are quarantined `intake.upload` artifacts in the same
customer Store. A pinned inbox lists metadata without opening content. Store
admission blocks their use by ordinary runs, references and source-blob reuse;
the scoped API service alone can promote one to a normal file after explicit Intent
placement. Promotion keeps the input lineage and is replayable. The UI freezes the
customer scope while uploading or assigning a batch. No separate inbox database,
cross-schema query, compatibility table or new database role is introduced.

Studio query and command requests use the existing customer `actor-runs` route.
The exact `POST /studio/query` suffix requires `actor-runs:read` and rejects
mutating operations; `POST /studio/command` requires `actor-runs:write`.
Subscription dispatch currently requires a live authorized user request, not a
persisted user token or unattended worker identity. See
[Skill Studio verification](skill-studio-verification.md#fail-closed-boundaries) for current limits.

## Provisioning and reconciliation

Checkout records a purchase and its platform event in one transaction. The event
worker delivers it idempotently to the facade. The platform records the desired
customer environment, and the provisioner converges it through a compiled component
catalog:

1. create the physical database and `NOLOGIN` owners;
2. revoke ambient access;
3. install append-only component migrations;
4. create or rotate each function role from its dedicated derivation root;
5. probe versions, migration digests, grants, and connectivity independently;
6. publish a new routing generation only after every mandatory component verifies; and
7. retry recognized partial states idempotently after a crash.

A component or environment is not ready because a command returned success. Readiness
requires observing the expected schema version, migration digest, privileges, and
routing generation in the target database.

## Request path

The native client lists the signed-in owner's ready environments. It selects the only
ready environment automatically or requires an explicit choice when there are several.
Switching the choice keeps the same identity session and remounts the customer workspace
so prior conversations, Intents, artifacts, Studio selections, email import progress,
and in-memory watchers do not appear in
the newly selected environment. The client sends only the environment UUID, never a
database name or credential. The facade currently admits owner access only; the stored
`admin` and `member` labels do not define product permissions yet.

For a customer request:

1. the Rust client presents its identity session only to the identity/token flow;
2. the facade verifies the signed identity token and current customer entitlement;
3. the facade maps the stable environment ID to the current verified routing
   generation;
4. it reads the current membership role and creates a short-lived grant bound to
   environment, audience, role and allowed action; unknown combinations fail closed;
5. the domain service verifies that grant and derives the exact customer login for its
   function; and
6. the bounded pool provider opens or reuses only that customer's connection pool.

Suspension, restore, ownership changes, or credential rotation advance the routing
generation. Old grants and old derived passwords then fail closed.

## Customer movement

The API directory records a runtime ID and an independent migration hold for each
customer environment. The facade reloads these with membership for every grant and
selects an operator-configured runtime destination. Unknown destinations and held
customers fail closed. Artifact translation uses that runtime's Artifact Store.
`primary` is the initial composition; additional destinations are explicit. An optional
operator-managed file publishes runtime routes without restarting the facade. Each
customer request validates the current file; invalid or missing current configuration
fails closed rather than reviving cached routes.

The provisioner claims work only for its configured runtime and skips customers under
movement. Completion cannot publish readiness for a stale location or generation.
Each runtime has a separate worker heartbeat; capability health requires a recent
heartbeat for every customer placement and the selected default. A healthy generation
cannot mask another generation that stopped.
The central movement journal binds an idempotency key to source, destination and
expected generation. A controller serializes operations, fences source access, copies
a database, verifies its prepared components, and atomically publishes its destination.

Production Actor execution, including continuation submission, takes a shared database
barrier for its short claim transaction, records unfinished execution in customer
metadata and persists a renewable running lease. It releases the pooled connection
before executing. Handover closes admission, crosses the exclusive claim barrier,
and waits for live markers to clear. An expired lease with unfinished work requires
reconciliation; movement refuses to infer that external effects stopped.
Fencing waits for the physical provisioning lock; reconciliation rejects a lower routing
generation. Source customer roles become `NOLOGIN` and their remaining sessions are terminated
before the final dump. A cluster marker rejects copying across installation targets.

The movement driver uses pinned PostgreSQL 18 tools, private local dump files, an
operation-bound destination marker, a closed staging database and transactional restore. It never overwrites an
existing unrecognized database or deletes recovery copies. Rollback advances generation,
preserves both histories, and leaves Actor execution disabled pending reconciliation.
Forward movement enables execution only after the directory publishes the destination;
a crash between publication and enabling execution keeps Actors paused until resume.

The isolated movement drill proves two physical clusters, a running Actor delaying
handover, another customer continuing to write, failed readiness and resume, directory
routing, controller contention, entitlement holds and rollback after divergent writes, including
a failed observation after activation.
A second journey uses the real component catalog, PostgreSQL provisioner, Rust Artifact
Store provisioner, identity signature verification, facade and Intent Service over HTTP.
It interrupts each physical phase before journal publication, resumes it, checks exact
Intent and contribution content, rejects stale source access, retains divergent histories,
provisions a new customer on the selected default runtime, and interrupts/resumes a
return to the original database from each pre-activation phase. It also migrates through
the bundled operator command, rejects another controller release, and publishes new
runtime routes through the running facade. The full native journey
and provider host replacement remain separate proofs.

The operator command and its limits are in
[Customer movement development](operations/backup-and-recovery.md#customer-movement-development).
The hosted platform controller prepares a new runtime and encrypted release backup,
updates shared control services, publishes the complete route directory and moves
customers individually. Interrupted operations resume from their journal; prior
runtimes and credentials remain intact. Shared control services still reside on the
platform host. New customer placement uses a serialized directory default and a
release-bound immutable component catalog; changing the facade binary does not change
that default. Installation starts with empty storage; unregistered older installations are rejected.

The host-controller fixture proves fresh installation, two consecutive customer
rollouts, retry without replacing the selected database, and recovery after removing
all platform databases and release configuration. Only encrypted backup repositories
and the independent identity fixture survive. Recovery restores the retained runtime
fleet, verifies exact customer placement, reconciles current-generation component
jobs, preserves customer content and admits new authenticated writes. Actor execution
remains paused for effect reconciliation. Commerce and edge behavior are covered by
the separate native journey; replacing a cloud provider host remains a separate proof.

The public installer still requires the hosted three-target topology. Site bindings
remain central and model requests remain identity-scoped. Automated effect
reconciliation and old-generation retirement are not implemented.
These are outstanding acceptance requirements of the
[release lifecycle specification](customer-release-lifecycle.md), not deployment claims.

## Static hosting

The facade owns site bindings and the private directory contract. The static host
fetches an allowlisted Git source branch and matching deployment artifact, verifies the
source revision, activates the release atomically, and persists the last-known-good
managed state. `aven.ceo` uses the same mechanism as customer sites. There is no legacy
host snapshot or cutover composition.

## Backup boundary

The identity backup enumerates the identity cluster. The platform backup enumerates
every central and customer database. Both preserve owners and ACLs, integrity-check
custom-format dumps, encrypt through Restic, and write off-host. Restore creates
unknown historical role names as `NOLOGIN`; current role initialization and customer
reconciliation derive fresh login passwords and reapply current grants.

See [Backup and recovery](operations/backup-and-recovery.md) for the executable
contract.

## Local and E2E equivalence

`deploy/local` runs the same logical services, databases, component catalog, grants,
and routing rail on one workstation. The local account helper creates a disposable
entitlement and customer environment; the Rust client still authenticates through the
real device flow and calls the facade.

The full-stack E2E creates two customer environments and proves physical and schema
isolation, first and second passkeys, native client authorization, raw Polar retention,
artifact and document flows, durable Intent/chat and Actor data, forged-header
resistance, managed hosting, and profile-aware teardown. The recovery drill separately
proves exact encrypted fresh-target restore.

## Current deliberate gaps

- Shared identity, `next`, and production now have isolated Pulumi stacks and
  deployment targets; see [Deployment targets](operations/deployment.md#installation-channels).
- Diagnostic database roles are issued manually. The SSH tunnel itself is already
  restricted, but automatic short-lived read-only role issuance and reaping remain to
  be built.
- Backups run hourly and can be inspected, but there is no narrow operator-triggered
  ad hoc backup workflow.
- Actor runs are durable; the richer generic observation/effect journal remains future
  runtime work.
- Document ingestion and invoice reconciliation share the observation-driven general
  solver on device and remote execution. The remote Actor Runner uses the selected
  customer's run ledger and Artifact Store scope, including model-backed document
  understanding. Deterministic fixtures prove transport and semantic parity, not live
  provider extraction accuracy. Successful publications replay after restart; local
  in-flight progress and failed attempts are not a durable per-step journal.

These gaps must stay explicit. They are not permission to add shared databases,
cluster-wide runtime credentials, handwritten customer setup, caller-selected routing,
or a second legacy operating path.
