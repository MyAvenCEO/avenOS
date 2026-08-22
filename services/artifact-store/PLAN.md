# Artifact Store implementation plan

Status: scaffold only; no artifact-store behavior is implemented on this branch.

Date: 22 August 2026

This plan turns the reviewed immutable artifact-store design into a Rust service that
can run as an independent process and can be consumed by the Tauri application. The
original design remains the authority for persistence semantics: immutable typed
artifacts, content-addressed blobs, structural references, production provenance,
atomic publication, authorization-safe reads, a commit-ordered feed, rebuildable
search, and explicit retention.

## Architectural outcome

Use one transport-neutral application kernel and compose it at the edges:

```text
                                   +-------------------------+
                                   | standalone HTTP process |
                                   +------------+------------+
                                                |
                                                v
+-------------------+       +-------------------+-------------------+
| Tauri remote mode |------>| artifact-store contract/application  |
| (HTTP client)     |       | kernel                            |
+-------------------+       +-------------------+-------------------+
                                                |
                           +--------------------+--------------------+
                           |                                         |
                           v                                         v
                 +--------------------+                   +--------------------+
                 | PostgreSQL adapter |                   | policy/job adapters |
                 +--------------------+                   +--------------------+
                           ^
                           |
                 +---------+----------+
                 | Tauri embedded mode|
                 | (explicit opt-in)  |
                 +--------------------+
```

The kernel must not know about Axum, Tauri, environment variables, SQLx, Docker, or a
specific identity provider. It receives authenticated request context and uses narrow
ports for persistence, authorization, clocks, IDs, and optional job-attempt fencing.
Adapters own framework and deployment concerns.

This separation gives us:

- one implementation of publication validation, canonical hashing, idempotency, and
  provenance rules;
- an HTTP deployment without coupling the domain to its transport;
- direct in-process calls from a trusted Tauri deployment without a loopback server;
- a safe default Tauri deployment that calls a remote service and contains no
  PostgreSQL credentials;
- integration tests against the same public application contract in every mode.

## Scaffolded crates

| Crate | Kind | Intended responsibility |
| --- | --- | --- |
| `aven-artifact-store` | library | Domain types, versioned command/result contracts, invariant validation, canonicalization, application services, and persistence/policy ports. No framework-specific dependencies. |
| `aven-artifact-store-postgres` | library | PostgreSQL implementation, embedded migrations, constrained transaction functions, role-aware pools, and projection repositories. |
| `aven-artifact-store-client` | library | Versioned HTTP client used by Tauri and other Rust producers/consumers. It shares semantic contract types but never exposes database concepts. |
| `aven-artifact-store-server` | binary | Standalone composition root: configuration, authentication adapter, HTTP routes, health endpoints, graceful shutdown, and worker subcommands. Its executable will be named `aven-artifact-store`. |
| `aven-artifact-store-tauri` | library | Thin Tauri command/state adapter. Remote mode delegates to the HTTP client. An opt-in `embedded-postgres` mode composes the kernel with the PostgreSQL adapter for controlled desktop/test deployments. |

Dependency direction is one-way:

```text
server ----> postgres ----> core
   |                         ^
   +-------------------------+

tauri -----> client -------> core
   |
   +--------> postgres ----> core   (embedded-postgres only)
```

The server and Tauri crates must not contain a second implementation of business
rules. The PostgreSQL crate must not depend on either transport. If protocol DTOs
eventually create pressure on the core API, split a small `contract` crate then; do
not create that boundary pre-emptively.

## Supported runtime shapes

### Standalone service

The standalone binary will be the production authority. It will expose `/v1` over
authenticated HTTPS behind the deployment proxy and connect to one PostgreSQL database
per deployment/customer environment. That database owns one `artifact_store` schema
containing metadata and bytes so backup and restore remain transactionally aligned.

The binary should eventually provide explicit process modes from the same immutable
container image:

- `serve` with only the artifact runtime database role;
- `migrate` with the migration-owner credential;
- `index` with the constrained indexer credential;
- `verify` with read-only integrity privileges;
- privileged retention operations only through a separately authorized operator path.

Using one image does not mean using one credential. Each process receives only the
role needed for its mode. The long-running web process must never receive migration,
retention, provisioner, or backup credentials.

### Tauri remote mode (default)

The shipped desktop/mobile application should normally use the HTTP client through
Tauri commands. Authentication comes from the app session and is translated into
service credentials by the Tauri adapter. The client uses TLS, bounded timeouts,
idempotency keys, streaming/range-aware blob transfers, and typed API errors.

This is the only mode suitable by default for a distributed application: embedding a
remote PostgreSQL password in an app bundle would bypass the service authorization
boundary and is not acceptable.

### Tauri embedded PostgreSQL mode (opt-in)

For a trusted desktop installation, development harness, or an environment that has a
local PostgreSQL instance, the Tauri adapter may call the same application kernel
directly. It must be activated by an explicit Cargo feature and runtime configuration;
it is never an automatic fallback when the remote service is unavailable.

Embedded mode still requires real authenticated request context, authorization policy,
database roles, migration compatibility checks, bounded background tasks, and graceful
shutdown. It should not listen on a TCP port. Mobile targets must reject this feature
until a supported PostgreSQL and credential threat model exists.

If offline/mobile storage becomes a requirement, decide that separately. A SQLite
implementation is not presumed equivalent to the PostgreSQL design because database-
enforced immutability, authorization, locking, commit ordering, search, and backup
semantics would all need a new contract and acceptance suite.

## Application boundaries

The core application facade should expose use cases rather than repositories or SQL:

- register/read immutable artifact type versions;
- stage bounded blob uploads;
- publish root artifacts or an atomic multi-output production run;
- retrieve artifact metadata/content, references, lineage, evidence, and bounded
  closure;
- search through an explicit active projection generation;
- consume whole authorized publication commits using opaque cursors;
- administer search mappings/generations through a separate authority;
- plan and execute retention through a privileged, audited authority.

Every call carries a server-created `RequestContext` containing the authenticated
principal, authorization decision/revision, request/deadline metadata, and optional
job-attempt ownership. Request payloads cannot choose their publisher identity or
inject database authorization context.

Ports should be capability-oriented. Avoid a single unrestricted repository trait.
Publication needs one transaction-capable port that can enforce the whole atomic
command, while read, search, feed, migration, indexing, and retention capabilities use
separate interfaces and credentials.

## HTTP and Tauri contract

The canonical external interface is HTTP `/v1`, following the reviewed design:

- type discovery;
- simple artifact upload and principal-bound blob staging;
- canonical batch publication plus root/run convenience routes;
- artifact content, provenance, reference, and evidence retrieval;
- POST-based search with stable sealed cursors;
- whole-commit change feed and race-free bootstrap scan;
- liveness, readiness, and version/schema compatibility endpoints.

Tauri commands should mirror use cases, not HTTP implementation details and never SQL.
Remote commands delegate to the client; embedded commands delegate directly to the
facade. Both return the same versioned result and error envelopes so the webview does
not care which composition mode is active.

Large bytes must remain streaming at transport boundaries. Do not represent an entire
upload/download as a Tauri JSON array, base64 string, or repeatedly copied in-memory
buffer. Before implementation, choose the supported Tauri streaming/channel or secure
temporary-file handoff and apply the same size, ownership, cleanup, and path-validation
rules as the HTTP staging path.

## PostgreSQL ownership and migration strategy

- Use a dedicated `artifact_store` schema in a dedicated deployment/customer database.
- Keep migrations in `aven-artifact-store-postgres` and compile them into the migrator
  so an image and its schema ledger cannot drift.
- Use monotonically ordered, immutable migration files and a migration ledger guarded
  by a PostgreSQL advisory lock.
- Never auto-migrate from the runtime server or Tauri startup path. They perform a
  compatibility check and fail readiness with a useful error when migration is needed.
- Create distinct non-login ownership roles and login credentials for migration,
  runtime, indexer, retention, and backup responsibilities.
- Expose protected data to runtime roles only through constrained functions,
  security-barrier views, or forced RLS with fail-closed authorization context.
- Put immutable-table mutation protection and envelope/payload-or-tombstone checks
  below the Rust repository layer.
- Keep upload sessions, idempotency state, projector checkpoints, and other operational
  rows explicitly separate from immutable truth.

The first migration must wait for the design's unresolved canonicalization,
authorization, retention, cursor, and size-limit decisions. Those choices affect stored
digests and legal erasure and cannot be repaired safely with an ordinary refactor.

## Configuration and secrets

Define typed configuration in the standalone composition root and inject resolved
values into libraries. Environment variable parsing does not belong in core or
persistence code.

Expected configuration groups include:

- bind address, public origin, request/body limits, timeouts, and graceful-shutdown
  budget;
- runtime/migrator/indexer database URLs supplied only to the corresponding process;
- authentication issuer/audience or trusted internal-auth settings;
- authorization-policy endpoint/cache lifetime and fail-closed behavior;
- cursor sealing keys with key IDs and rotation windows;
- idempotency retention, staging expiry/quota, feed retention, and recovery epoch;
- tracing/logging controls that default to excluding content and bearer material.

Commit only safe examples. Deployment secrets, host addresses, resource IDs, Pulumi
state, cursor keys, and database passwords belong in GitHub Environment secrets or
variables according to the existing GitHub/Hetzner deployment rules.

## Standalone deployment plan

Deployment work is intentionally deferred until the service has a real vertical
slice. When added, it should follow the existing Hetzner/GitHub model:

1. Build one reproducible multi-stage Rust image and publish it to GHCR by immutable
   commit digest.
2. Run as a non-root user with a read-only root filesystem, bounded `/tmp`, dropped
   capabilities, `no-new-privileges`, rotating local logs, and a defined stop timeout.
3. Add a one-shot migrator that must succeed before `serve` or `index` becomes ready.
4. Keep PostgreSQL on protected persistent storage; prefer a dedicated artifact
   database/roles in the existing protected cluster over silently coupling artifact
   tables to the identity database.
5. Route TLS through Caddy and expose only the intended API/health surface. PostgreSQL
   remains private.
6. Add liveness, database/schema readiness, image-user, Compose-render, migration
   idempotency, and public endpoint checks to CI/deployment.
7. Implement encrypted off-volume database backups and a rehearsed restore before
   retaining customer artifacts. Server/volume backups alone are insufficient.
8. Treat production as a separate environment with distinct credentials, database,
   DNS, policy, and approval controls.

Do not add the empty binary to the current release or Compose workflows: deploying a
no-op service would create a misleading operational surface. CI integration can start
now with formatting/metadata checks; image/deployment integration starts with Slice 1.

## Implementation sequence

### Phase 0: irreversible decisions and executable contracts

- Resolve the pre-migration decisions listed below and record short ADRs.
- Define the versioned command/result/error envelopes and size limits.
- Choose Rust libraries only after small spikes for exact JSON parsing,
  canonicalization, JSON Schema behavior, PostgreSQL byte streaming, and Tauri byte
  transfer.
- Write cross-language digest golden vectors before storing any production digest.
- Build a PostgreSQL integration-test harness and authorization leak test matrix.

### Phase 1: immutable storage vertical slice

- Type versions, blobs, artifact envelopes/payloads, structural references, scopes,
  idempotency records, upload claims, commits, and database-enforced immutability.
- Canonical publication transaction and bounded `core.file@1`/`core.manifest@1` flow.
- Standalone upload/publication/retrieval/feed endpoints and matching Rust client.
- Tauri remote commands for that same narrow flow; embedded mode only after remote
  contract parity is proven.
- Backup/restore manifest and first recovery drill.

### Phase 2: derivation and evidence

- Production runs, ordered inputs/outputs, locators, evidence, graph queries, and
  atomic multi-output publication.
- Classification and OCR types using one settled OCR storage representation.
- Job-attempt fencing adapter without moving job state into the artifact kernel.

### Phase 3: rebuildable search

- Immutable mapping versions, shadow projection generations, text and typed indexes,
  commit consumer/checkpointing, activation, and restartable cursors.
- Authorization-before-ranking/faceting tests and raw-file discovery via OCR source
  attribution.

### Phase 4: review and external action

- Typed decisions/evaluations, correction runs, application-owned preference
  projections, and one complete domain request/receipt path.
- External executor idempotency keyed by the request artifact occurrence.

### Phase 5: retention and operations

- Legal holds, tombstones or approved hard-delete closure, descendant/referrer
  analysis, projection removal, blob garbage collection, privileged audit, and
  integrity scrub.
- Recovery-epoch/failover procedure, monitoring, capacity tests, and documented SLOs.

## Verification strategy

Each implementation phase should add checks at the layer that owns the guarantee:

- pure unit/property tests for canonicalization, limits, local-reference DAGs, and
  command validation;
- golden vectors shared with every non-Rust SDK;
- PostgreSQL integration tests for transaction atomicity, concurrency, cursor order,
  idempotency races, role grants, RLS/function fail-closed behavior, purge races, and
  restore integrity;
- HTTP contract tests against the standalone server and client;
- parity tests running the same use-case suite through standalone, Tauri remote, and
  eligible embedded compositions;
- adversarial authorization tests proving hidden IDs, counts, snippets, ranks,
  referrers, evidence, deduplication, and feed gaps do not leak;
- migration-up tests run twice against a fresh supported PostgreSQL version;
- bounded-load tests at every declared blob, JSON, batch, graph, feed, and search
  limit;
- `cargo fmt --check`, `cargo clippy --workspace --all-targets --all-features`,
  `cargo test --workspace --all-features`, and a dependency/license/security policy
  gate in CI.

The repository's Rust toolchain (`1.93.1`) and shared Cargo target configuration apply
to this workspace. The service keeps its own `Cargo.lock` because it produces a
deployable executable.

## Decisions required before implementation

The source design lists the full decision set. These are the first blockers for code:

1. Exact JSON Schema 2020-12 validator/profile, supported references, and dependency
   digest closure.
2. Canonical JSON number profile, domain tags, UUID version, and golden vectors.
3. Blob/JSON/string/batch/reference/locator/traversal limits and a measured streaming
   upload strategy.
4. Principal-bound staged/reused blob authority and garbage-collection locking.
5. Authorization-scope resolver, database enforcement mechanism, declassification,
   policy revision lifetime, and non-disclosure responses.
6. Idempotency retention/tombstones, semantic request hashing, commit allocator,
   sealed cursor format, feed retention, and recovery-epoch behavior.
7. Retention law/product policy: which envelope, attribution, graph, locator, digest,
   idempotency, commit, and audit facts may remain after erasure.
8. Initial locator vocabulary, OCR blob representation, built-in schemas, and
   procedure/actor identifier conventions.
9. Tauri production topology: remote-only for distributed builds (recommended), plus
   which controlled desktop builds, if any, may enable embedded PostgreSQL.
10. Per-customer database provisioning, backup RPO/RTO, restore fencing, and whether
    the artifact service gets its own hostname or an authenticated route on an
    existing application origin.

No database migration or public type version should be created until decisions 1-7
are settled and covered by executable tests.

## Scope of this scaffold

This branch intentionally contains only Cargo metadata, empty crate entry points, and
this plan. It does not:

- select web, async, database, schema, canonicalization, or Tauri libraries;
- create migrations or register artifact types;
- change the Tauri application or its Cargo lockfile;
- add Docker, Compose, Pulumi, GitHub Actions, secrets, ports, DNS, or deployment
  resources;
- claim that the no-op standalone binary is a usable service.

The next implementation branch should begin with Phase 0, turn decisions into ADRs and
tests, and then deliver one complete Slice 1 vertical path rather than broad table and
endpoint stubs.
