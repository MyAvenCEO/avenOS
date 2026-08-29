# Artifact Store and AvenOS Repository Alignment Paper

Status: completed repository backtest

Date: 22 August 2026

Specification under test: the normative version-1 package in this directory, especially
[the core contract](CORE-CONTRACT.md),
[the SDK contract](SDK-CONTRACT.md),
[security and recovery](SECURITY-AND-RECOVERY.md), and
[the conformance plan](CONFORMANCE.md).

Repository under test: `/home/daniel/src/MyAvenCEO/avenOS` on
`feat/artifact-store`.

## Executive conclusion

The version-1 artifact-store model is a strong fit for the current AvenOS product and
repository. The backtest found no missing universal kernel primitive. The mocked UI's
important durable facts all fit as artifact occurrences, ordered structural references,
successful production runs, evidence, and atomic publications. Its mutable intent
status, actor state, human queue, todo heads, search results, and windows correctly stay
outside the kernel.

The repository is not yet implementation-aligned, however. Five conditions block a
conformant implementation or production rollout:

1. The current `artifact-types` catalog and its mock-store plan target the superseded
   larger design. They conflict with the final built-ins, canonical JSON profile,
   locator units, type-definition shape, and kernel boundary.
2. The Tauri application has no durable publication outbox, acknowledgment journal, or
   byte-reacquisition store. Its authentication state is intentionally memory-only.
3. `aven-api` supplies a stable authenticated human subject and provisions isolated
   customer databases, but it does not yet expose artifact scopes, namespace grants,
   stable service publishers, or an artifact authorization contract.
4. The deployment creates a customer database but not a customer application
   coordinator, artifact-store roles, recovery journal exchange, or rehearsed database
   restore. Off-volume PostgreSQL backup remains unfinished.
5. Version 1 deliberately has no content-lifecycle operation. AvenOS handles personal
   and financial data, so a concrete lifecycle extension is required before real
   customer content is accepted.

The decisive integration recommendation is:

> Use one server-side AvenOS coordinator per customer environment as the sole initial
> stable artifact publisher. It owns the application transaction, prepared-publication
> outbox, successful acknowledgment journal, byte spool/reacquisition references,
> trusted descriptors, and projector checkpoints. Tauri, model output, plugins, and
> workers propose work to that coordinator; they do not publish directly.

This topology closes the largest recovery and trust gaps while preserving the spec's
small kernel. It also reuses the customer database already provisioned by `aven-api`
without turning the identity service into a content service.

## Scope and evidence

The review covered:

- every normative version-1 specification document and the extension seams;
- all nine mocked intent journeys in
  [the intent workspace](../../../app/src/lib/intents/IntentsPlaceholder.svelte);
- the live actor bus, HITL queue, QuickJS sandbox, todo reducer and Prolog machines;
- the federated query registry and mocked query sources;
- the shared skill catalog and declared app workflows;
- the Tauri Rust host, native authentication state, command surface, capabilities and
  content-security policy;
- `aven-api` identity, Better Auth bearer sessions, customer-environment records,
  provisioning jobs, database roles and deployment topology;
- the 52-entry artifact inventory, 19 JSON registration drafts, and the proposed
  in-memory mock-store plan; and
- current deployment and backup documentation.

Verification performed during the review:

```text
bun test app/tests        79 passed, 0 failed
bun run check             0 Svelte errors, 0 warnings
jq over artifact-types    every JSON document parsed
```

These results prove the current application behavior is internally consistent. They do
not exercise PostgreSQL, artifact publication, streaming bytes, scope isolation,
permanent publication identity, projectors, or divergent recovery. There is currently
no artifact-store implementation to test.

## Alignment scorecard

| Area | Result | Repository evidence | Required action |
| --- | --- | --- | --- |
| Durable fact versus mutable state | Strong alignment | Intent status, actor state, todo state, queues and query answers are explicitly mutable/in-memory | Keep them in application projections |
| Artifact occurrence identity | Strong product fit | Repeated scans, messages, candidates and business identifiers can recur independently | Preserve a UUID per occurrence even when bytes/content match |
| Atomic run fan-out | Strong product fit | Todo/event/draft and reconciliation flows expose several outputs as one completed step | Publish the outputs in one run publication |
| Composition versus causality | Strong alignment | Attachments/frozen handovers differ from workflow `provides`/`requires` edges | Use ordered references for composition and run inputs for causality |
| Evidence | Strong product fit | OCR, deadlines, classification, amounts and matches need exact source grounding | Use the four v1 locator kinds and trusted procedure descriptors |
| Human review | Partial alignment | The UI visibly separates a gate, but the queue stores an in-memory continuation | Persist the task outside the store; publish an exact decision artifact after authorization |
| External effects | Product fit, no implementation | Payment, send and calendar journeys distinguish proposals but not durable effect reconciliation | Keep request/receipt types and an application executor ledger |
| Actor sandbox | Useful aligned seam | Ambient network/process authority is absent and capabilities are fail-closed | Treat sandbox output as an untrusted proposal; revalidate in the coordinator |
| Search/query | Correctly outside core | Query is a federated source registry with failure isolation | Make artifact search an application projector/source, not a core route |
| Type catalog | Blocking mismatch | Drafts use old built-ins, search members, reference schemas, NFC and fractional JSON numbers | Rebuild descriptors against the normative profile |
| Tauri trust boundary | Partial | Bearer token stays in Rust, but artifact commands/outbox/journal do not exist | Keep Tauri thin; submit typed commands to the coordinator |
| Stable publisher | Missing | Only human Better Auth sessions exist | Provision one rotatable coordinator service subject per environment |
| Scope authorization | Missing | Customer environment has one owner; name-scoped authorization is explicitly future work | Add a versioned identity decision contract and one initial scope |
| Customer isolation | Strong foundation | `aven-api` provisions a database and owner role per purchased environment | Put app and artifact schemas behind separate least-privilege roles in that database |
| Recovery | Blocking mismatch | No publisher journal exchange or divergent-restore procedure exists | Implement and rehearse the normative reconciliation flow |
| Content lifecycle | Production blocker | Duplicate deletion and personal/financial data are core product cases | Install a concrete lifecycle extension before production data |

## Mocked UI journey backtest

The final minimal core still supports all nine mocked journeys. Several journeys rely on
application services or documented extensions, which is expected and must remain
visible in the product contract.

| Journey | Core representation | Outside-core responsibility |
| --- | --- | --- |
| Krankenkasse deadline | Captured file, OCR/classification runs, then one run publishing todo/event/draft atomically | Waiting state, human task, send executor and UI projection |
| Office-chair invoice | Invoice proposal, policy/account captures, decision, payment request and receipt artifacts | Current balance retrieval, reviewer authorization, payment reconciliation |
| Tax collection | Immutable document/assertion occurrences and a frozen final bundle | Growing collection, counts, search and handover readiness projection |
| Contact duplicate | Candidate/evaluation, exact decision and a new merge/same-as fact | Preferred entity/head selection; historical references are not rewritten |
| Duplicate scans | Distinct occurrences may share one exact blob | Deletion is unavailable in core v1 and requires the lifecycle extension |
| Calendar conflict | Proposed and observed event snapshots, conflict evaluation and decision | Current calendar state and remote write request/receipt executor |
| Bank reconciliation | Captured statement, parsing/matching runs, decisions and atomic output transitions | Open-item heads, threshold policy, retries and mutable completion state |
| Contract cancellation | Draft, review decision, send request, send receipt and later inbound confirmation | Human task and connector effect reconciliation |
| Missing contract | A completeness/not-found result may be an artifact over an exact frozen corpus | Search projection, generation/high-water, source failure and query completeness |

Two negative conclusions are important:

- A failed or interrupted attempt cannot be reconstructed as a failed production run.
  The core stores successful runs only. The UI's `error` and retry states remain
  application job/attempt state.
- The absence of a decision artifact is not sufficient authority to call a gate open.
  The application must persist the human task and its concurrency state, then bind the
  eventual decision to the exact proposal and authorization.

## Repository boundary findings

### 1. The actor and skills layer is orchestration, not provenance

The actor bus derives workflow edges by unifying `provides` and `requires`, and the
skills viewer derives stages from those declarations. This aligns with the spec as an
application coordination layer. Those declarations describe possible routing, not the
exact input occurrences consumed by a successful run.

Consequences:

- skill IDs do not automatically become artifact type keys;
- workflow nodes do not automatically become procedure versions;
- `provides`/`requires` edges do not become structural references or run inputs; and
- activity logs should be projected from successful publications plus application
  attempt state, not copied into immutable receipts.

The QuickJS sandbox is a good proposal boundary. It removes ambient `fetch`, process,
module and timer authority and exposes only granted host capabilities
([sandbox](../../../app/src/lib/actors/sandbox.ts)). That reduces risk but does not make
model/actor output authoritative. The coordinator must still allowlist scope, type,
procedure and actor attribution, validate the current attempt/human decision, freeze the
intent, and save it durably before upload or publication.

### 2. The HITL queue is correct UX and insufficient durability

The current bus holds an in-memory continuation and confirmation releases it
([bus](../../../app/src/lib/actors/bus.ts)); the shared HITL queue is also memory-only
([queue](../../../app/src/lib/actors/hitl.svelte.ts)). This is suitable for a mock but
cannot establish a durable review decision:

- restart loses the pending task;
- the preview is not bound to an immutable proposal UUID;
- there is no optimistic concurrency or stale-decision guard;
- button identity is not reviewer identity or authorization; and
- confirmation can race proposal replacement or external execution.

The aligned shape is an application-owned review-task row keyed to exact artifact IDs.
Confirmation updates that task under concurrency control and prepares a decision run in
the same application transaction. The coordinator publishes it; later external work
consumes the exact decision artifact.

### 3. Federated query remains an application feature

The query engine asks registered sources in order, suppresses empty answers, collapses
display duplicates, and continues when a source throws
([query engine](../../../app/src/lib/query/answer.ts)). This is desirable interactive
behavior and deliberately weaker than a durable completeness claim.

An artifact projector can become one query source. Search extraction and ranking stay
outside v1. A durable `not-found` artifact requires an exact corpus/manifest or
high-water, projector version/checkpoint, normalized query, authorization context and
per-source completion record. The present UI failure isolation cannot by itself prove
absence.

### 4. Todo state remains a projection

The live todo reducer mutates title, responsibility, status and `spark`, and physically
removes rows for delete/clear-done
([todo reducer](../../../app/src/lib/actors/views/todo/logic.ts)). The UI contract is
convenient, but persistence must decompose it:

- immutable task revisions and transition facts may be artifacts;
- current title/status/head/visibility remain application projection state;
- clear-done hides projection rows rather than deleting artifact history; and
- moving `me` to `team` is not a v1 update. It requires a later privileged cross-scope
  copy/declassification flow that creates a new target-scope occurrence.

The current identity model has no team membership contract, so `team` must remain mocked
or disabled for authoritative persistence in the first slice.

## Blocking contract mismatches

### 1. `artifact-types` is a discovery catalog, not a v1 registry

The existing [catalog](../../../artifact-types/README.md) is useful product discovery,
but its registrable documents conflict with the normative contract:

- The final built-ins are `core.file@1` and `core.bundle@1`; the catalog defines
  `core.manifest@1` plus `policy.snapshot@1` and `external.capture@1` as T0.
- `core.file@1` currently retains `detectedMediaType`, although the final contract makes
  detection serving data or a later evaluation rather than mutable/embedded source
  truth.
- Type definitions need `schema_profile_id`, `payload_schema`, `blob_policy` and closed
  ordered `reference_rules`. The drafts instead embed a `referencesSchema` for concrete
  reference instances, including target IDs and digests.
- Every registrable draft embeds `search`; search is now an application projector and
  is excluded from type identity and the v1 kernel.
- The final canonical JSON profile applies no global Unicode normalization. The catalog
  plan and OCR notes require NFC.
- V1 JSON numeric literals are signed interoperable 53-bit integers only. Classification
  and confidence schemas currently use fractional `number` values. They need scaled
  integers or constrained decimal strings.
- V1 text evidence uses UTF-8 byte ranges. `ocr.text@1` currently promises Unicode-code-
  point offsets.
- The registry labels 52 entries with version 1 even though 33 have no schema. Those are
  candidates, not immutable versions.

Required correction before a migration or public descriptor:

1. Keep the 52 entries as a product inventory with explicit `candidate`, `draft`, and
   `registrable` states.
2. Create exact source-controlled definitions only for the two final built-ins and the
   domain types required by one vertical.
3. Replace concrete `referencesSchema` documents with closed role rules; wire reference
   DTO validation belongs to the command schema.
4. Move search extraction into a separate application projector package.
5. Replace fractional JSON numbers and rework OCR evidence offsets.
6. Generate and pin the exact type-definition digest for every enabled descriptor.

### 2. The mocked artifact-store plan must be replaced, not implemented as written

The current [artifact-type mock plan](../../../artifact-types/PLAN.md) proposes a second
kernel in TypeScript with `search`, digest-addressed `getBlob`, generalized lineage,
generic idempotency, failed-run-derived UI state, NFC canonicalization and all 52 types.
Those choices contradict the normative v1 contract.

The most consequential mismatches are:

- public `getBlob(sha256)` violates occurrence-authorized content access;
- `search()` is outside the kernel;
- `publish(req)` omits permanent `(scope, publication UUID, stable publisher)` identity,
  semantic-intent versus transient-authority separation, and store-epoch fencing;
- the fake does not model upload claims, aggregate staging quotas, recovery exclusions,
  publisher journals, or divergent restore;
- gate/error/current state is incorrectly inferred as immutable store truth; and
- instantiating every candidate type would prematurely freeze speculative contracts.

A UI fake remains useful, but it should be one of these:

- a fixture implementation of the generated client returning exact wire DTOs and stable
  problem codes; or
- a projector-output fixture that feeds the current UI view models.

It must not be presented as kernel conformance. Core integration tests must run against
the real HTTP server, real PostgreSQL functions/roles, shared vectors, and recovery
fixtures required by [CONFORMANCE.md](CONFORMANCE.md).

### 3. Direct Tauri publication cannot satisfy the recovery contract today

The native host correctly keeps the Better Auth bearer outside the webview. Its current
`AuthState`, however, stores the session only in a process `Mutex`
([auth state](../../../app/src-tauri/src/auth.rs)); the repository README explicitly says
the authentication spike signs in again after restart and that customer-data operations
are future work ([root README](../../../README.md)). The Rust shell also documents that
there is no local store to flush ([Tauri host](../../../app/src-tauri/src/lib.rs)).

Therefore the Tauri app cannot currently satisfy the SDK's mandatory sequence:

```text
freeze publication UUID and semantic intent
  -> save durably with expected store epoch
  -> reacquire bytes and bind current claims
  -> publish/retry exact intent
  -> durably retain the authoritative acknowledgment
```

Adding only HTTP commands would create ambiguous commits that cannot be reconciled
after a crash, reinstall, lost device, or divergent server restore. Distributing one
human publisher's recovery history among several devices would also make required
publisher watermarks incomplete.

### 4. Identity and scope are promising foundations, not a finished store contract

`aven-api` already supplies useful pieces:

- Better Auth yields a stable user ID behind rotatable bearer sessions;
- native passkey and device authorization keep the bearer in Tauri Rust;
- customer environments have stable IDs, one owner user, database name and owner role;
  and
- provisioning already creates one database per paid environment.

Missing pieces are material:

- a versioned artifact authorization/decision endpoint;
- stable scope IDs and current membership/grants;
- type/procedure namespace authorization;
- suspended/read-only behavior for artifact operations;
- stable service principals for coordinators/projectors; and
- authenticated recovery-journal enumeration and watermarks.

The first release should not infer these from billing tier, a display name, the `spark`
string, possession of a database name, or a user-supplied scope ID.

### 5. Deployment and recovery are not yet conformant

Per-customer PostgreSQL is already the correct physical boundary. The artifact store can
use an `artifact_store` schema and the coordinator an application schema in that same
database, with separate migration, runtime read, runtime publication, coordinator,
projector and recovery roles.

The customer application stack is explicitly not provisioned yet, and the new
infrastructure guide deliberately keeps encrypted off-volume database backup and
restore rehearsal as an operator responsibility
([infrastructure guide](../../../docs/infrastructure-getting-started.md)). The final
contract additionally requires publisher journal retention, a write-disabled
`reconciling` mode, exact restoration or permanent exclusions, publisher watermarks,
cursor invalidation, and integrity fencing. A database backup alone is insufficient.

### 6. Core-only production would violate the stated lifecycle boundary

The spec correctly excludes purge/holds/retention from the minimal kernel, but it also
requires a concrete lifecycle extension before accepting regulated data. The current UI
is centered on health-insurance letters, invoices, bank statements, contacts and
payments. These are not hypothetical low-risk fixtures.

Consequently:

- the core may be developed and demonstrated with synthetic data;
- production ingestion of customer documents is blocked until discovery, restriction,
  holds, erasure/retention policy, projector removal, backup reconciliation and audit are
  implemented; and
- the duplicate-delete UI must not claim deletion while only the v1 core exists.

This is an application/deployment release gate, not a reason to enlarge the immutable
core tables.

## Recommended aligned topology

```text
untrusted webview / model / plugin
               |
               | typed application command
               v
Tauri native host (keeps human bearer, streams local bytes)
               |
               v
AvenOS coordinator in the customer environment
  - authenticates/authorizes through aven-api
  - binds one scope and stable coordinator publisher
  - owns jobs, attempts, human tasks and effect reconciliation
  - owns prepared-intent outbox and acknowledgment journal
  - owns byte spool/reacquisition references
  - validates type/procedure descriptors and actor attribution
  - applies projector updates/checkpoints transactionally
               |
               | exact publication HTTP contract
               v
Artifact store
  - artifact_store schema and constrained runtime roles
  - immutable types/blobs/occurrences/runs/evidence/publications
  - scope-local ordered feed and recovery exclusions

aven-api
  - human identity and environment entitlement
  - scope/policy decision contract
  - stable coordinator/projector service subjects
```

The coordinator and artifact store may be separate processes deployed from the same
customer stack. They should not share unrestricted database credentials. The coordinator
may keep its outbox, application state and projector checkpoints in the customer
database so its state transition and `PublicationOutbox.save` are atomic. Publication
to the store remains an idempotent remote step.

Using one coordinator publisher per environment is the fastest conformant starting
point:

- recovery asks one known publisher for one complete journal/watermark;
- workers never need broad store or upload credentials;
- user sessions can rotate without changing publication ownership;
- the human remains the logical initiator/reviewer actor where appropriate; and
- Tauri devices do not become irreplaceable recovery authorities.

Do not place the coordinator/outbox in `aven-api`. Identity and global provisioning are
already a separate failure and data boundary; customer content and workflow state belong
inside the customer environment.

## Recommended binding decisions for the first slice

1. **Customer boundary:** one provisioned customer database remains one artifact-store
   database and recovery unit.
2. **Initial scope:** create one stable personal/default scope per environment. Keep the
   UI's `team` path mocked or disabled until membership and cross-scope copy exist.
3. **Publisher:** one stable coordinator service subject per environment; human users
   are logical actors, not direct durable publishers.
4. **Workers:** workers return proposed structured output and bytes to coordinator-owned
   storage. Only the coordinator uploads and publishes.
5. **Type release:** register `core.file@1`, `core.bundle@1`, and only the minimum domain
   family for one end-to-end flow. Do not register all 52 candidates.
6. **Search:** build it as a coordinator-owned feed projector and expose it as one AvenOS
   query source.
7. **Mocking:** mock exact client/projector responses for UI work; use the real server
   for kernel conformance.
8. **Recovery horizon:** choose backup/WAL and outbox/journal retention together before
   exposing the publication API to real producers.
9. **Production data:** install the lifecycle extension before accepting personal or
   financial customer content.

## Spec-package completion needed before implementation freezes behavior

The Markdown contract is coherent, but the conformance plan names machine-readable
release artifacts that are not yet present in this directory. Before the first migration
or public SDK, add and freeze:

- exact hard limits and lexical bounds;
- the closed OpenAPI/DTO schemas;
- `artifact-json-v1` valid/invalid and canonical-byte vectors;
- `artifact-json-schema-profile-v1` plus conformance fixtures;
- exact `core.file@1` and `core.bundle@1` registration documents and digests;
- artifact and publication digest preimage vectors;
- locator schemas/vectors and pagination cursor fixtures;
- a frozen encoding for stable `(issuer, subject)` publisher identity; and
- the identity-to-scope authorization contract used by the trusted adapter.

These are not requests for new kernel features. They are executable forms of behavior
the normative documents already require.

## Alignment-oriented delivery order

1. Replace the old artifact-type/mock plan with profile fixtures, the two exact
   built-ins, generated DTOs, and a small set of corrected domain descriptors.
2. Implement the real PostgreSQL kernel and HTTP server against C-001 through C-051;
   do not route UI traffic yet.
3. Add the customer-environment coordinator schema, stable service publisher, durable
   outbox/acknowledgment journal, byte spool and `aven-api` authorization decision.
4. Prove root file upload/retrieval/feed plus exact crash retry and divergent recovery.
5. Add one successful classification/OCR/extraction flow, then the atomic
   todo/event/draft UI backtest C-054.
6. Build the artifact projector as one federated query source and replace hard-coded
   view data incrementally.
7. Add typed decisions and request/receipt external execution with stale-decision and
   ambiguous-effect reconciliation.
8. Install and verify the lifecycle extension before production customer ingestion or
   deletion claims.

## Final assessment

The new minimal specification is better aligned with AvenOS than the earlier broad
service plan because it refuses to absorb the application's workflow engine, mutable
heads, search, human queue, external executors and retention policy. The mocked UI does
not force any of those features into the kernel.

The repository work must now align around the contract rather than recreate the older
architecture in memory. The fastest safe route is a real small core, a server-side
coordinator with durable publication/recovery state, and thin UI projectors. Once the
type catalog is corrected and that ownership boundary is accepted, implementation can
proceed without another conceptual redesign.
