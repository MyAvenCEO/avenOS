# Aven Artifact Store

Standalone PostgreSQL-backed implementation of the Artifact Store v1 kernel. The
service is consumed over HTTP both by deployed AvenOS services and by the Tauri app
through [`@avenos/artifact-store`](../../libs/aven-artifact-store/README.md); there is
deliberately no Tauri-specific persistence implementation.

The current milestone is a deployment-bounded first release. The root vertical is
executable, per-customer routing is reconciled by Aven API, and upload concurrency,
staging, logical storage, and process memory are bounded. Complete graph reads,
per-customer runtime credentials, backups, and divergent recovery remain later work.
See [PLAN.md](PLAN.md#implementation-status) for the core status.

## Run locally

Rust 1.93.1 and PostgreSQL 17 are the tested local toolchain.

```bash
export ARTIFACT_STORE_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/artifact_store
cargo run -p aven-artifact-store-server --bin aven-artifact-store -- migrate
```

`migrate` applies the embedded migration and registers the exact source-controlled
built-in type definitions. Start the fixed-scope preview adapter:

```bash
export ARTIFACT_STORE_SCOPE_ID=11111111-1111-4111-8111-111111111111
export ARTIFACT_STORE_BEARER_TOKEN='replace-with-a-secret'
export ARTIFACT_STORE_PUBLISHER_ISSUER='aven-api'
export ARTIFACT_STORE_PUBLISHER_SUBJECT='service:avenos-local'
export ARTIFACT_STORE_LISTEN=127.0.0.1:8087
cargo run -p aven-artifact-store-server --bin aven-artifact-store -- serve
```

Every protected route requires that bearer token. The standalone adapter binds one stable
publisher and one scope from process configuration; request JSON cannot override
either.

Deployed AvenOS uses tenant mode instead: Aven API resolves the authenticated user to
one exact customer environment, and the Artifact Store selects that environment's
database using the private `X-Aven-Artifact-Database` header. Only validated `cust_*`
identifiers are accepted, pools are bounded and least-recently-used entries are evicted,
and scopes must have been installed by the separate provisioner. Client or webview code
must never set this header.

See [PER-CUSTOMER-ARCHITECTURE.md](PER-CUSTOMER-ARCHITECTURE.md) for the focused
boundary diagrams, lifecycle and failure semantics, deployment interaction, and the
precise coverage limits for names that existed before this rollout.

### Run with Aven API

The Aven API has an opt-in Compose overlay that starts the API, both worker
processes, the Artifact Store runtime and provisioner, Mailpit, and one PostgreSQL
cluster as a local stack:

```bash
cd ../aven-api
docker compose \
  -f docker-compose.yml \
  -f docker-compose.artifact-store.yml \
  up --build -d
bun run artifact-store:smoke
bun run artifact-processing:smoke
bun run intent-service:lifecycle-smoke
bun run artifact-processing:failure-smoke
bun run artifact-processing:real-smoke
bun run artifact-processing:real-pdf-smoke
bun run artifact-processing:real-unsupported-smoke
```

See the [Aven API local services documentation](../aven-api/README.md#local-services)
for endpoints, port overrides, and teardown. The direct smoke test uses
`cust_artifact_local`; customer databases created by the environment worker receive the
same schema automatically.

### Local artifact processing

The local overlay also starts `artifact-processor`, the independent Intent Service,
their provisioners, and their one-shot schema migrators.
The processor discovers normal `desktop-drop` uploads as well as explicit test inputs.
With vision disabled, PDF, PNG, and JPEG files take the deterministic path:
byte-signature inspection, logical page decomposition, native PDF word extraction with
bounding boxes, deterministic page signals, document text assembly, and whole-file aggregation. The
local decoder runner clears credentials, avoids a shell, uses bounded scratch/output,
has a hard deadline, and runs inside the read-only/capability-free Compose container.
This is not yet a separate no-network decoder sandbox; that remains required before
enabling broader hostile-file formats.

#### Optional local vision model

The default local stack keeps model calls disabled. To exercise OCR, semantic
classification, invoice extraction, and account-statement extraction against an
OpenAI-compatible endpoint, set the profile matching that model's request and response
template:

```bash
export ARTIFACT_PROCESSOR_VISION_ENABLED=true
export ARTIFACT_PROCESSOR_VISION_BASE_URL=http://host.docker.internal:8000/v1
export ARTIFACT_PROCESSOR_VISION_MODEL=Qwen/Qwen3.6-27B
export ARTIFACT_PROCESSOR_VISION_PROFILE=qwen-tools
export ARTIFACT_PROCESSOR_VISION_AUTH_MODE=none
docker compose -f services/aven-api/docker-compose.yml \
  -f services/aven-api/docker-compose.artifact-store.yml \
  up -d --build artifact-processor
```

Local HTTP is explicitly allowed only by the local overlay; deployment requires HTTPS.
Set auth mode to `bearer` when an API key is required, otherwise leave the local
default `none` and omit the key. Profiles are `openai-tools`, `openai-json-schema`, `qwen-tools`, and `generic-json`.
They share one validated finance contract but differ in tool/JSON response mode and
model-specific request fields. Paid calls use a per-customer exact-request ledger and
an idempotency key. Provider response bodies and document text are not logged.

For a no-cost contract smoke, start `bun run --cwd services/aven-api
artifact-processing:vision-mock`, configure the local Processor for
`http://host.docker.internal:18080/v1` with profile `openai-json-schema`, then run
`bun run test:artifact-processing:vision-smoke` from the repository root. The smoke
publishes synthetic PDF invoice and statement fixtures only.

The real PNG and PDF smokes deliberately lie about the declared media type and verify
that byte signatures win. The mock success smoke still exercises all twelve semantic
stages through the final `invoice` projection. The mock failure smoke verifies a stable
error state and retained presentation. Files which are encrypted, malformed,
unsupported end in `needs_review` or `failed` with a stable warning. With vision
enabled, scanned pages are OCR'd and remain presentable at the last successful stage if
later classification, extraction, or validation fails.

The current release limit is 63 pages. This is an explicit rejection boundary, not
truncation: one atomic decomposition publication contains all pages plus its bundle,
and the store admits 64 artifacts. Durable multi-batch decomposition is the next step
before raising that limit.

Processor status is available directly at port 8089 for the smoke harness and through
the authenticated Aven API route:

```text
GET /api/artifacts/{artifactId}/processing
```

The `next` deployment uses the same image for Store and Processor binaries and a
separate image for the Intent Service. A separate Processor provisioner installs schema
version 5 and the exact scope in every ready
customer database; the Intent provisioner installs its own schema version 1. Both
runtimes discover only control-plane-approved bindings through
the private Aven API directory, use bounded per-customer pools, and participate in
aggregate deployment health. Required GitHub Environment values and rollback steps are
in the [deployment guide](../aven-api/docs/github-deployment.md#first-processor-rollout-to-next).

The implementation boundary, state machines, crash semantics, actual verification
results, and remaining work are recorded in
[ARTIFACT-PROCESSING-IMPLEMENTATION-REPORT.md](ARTIFACT-PROCESSING-IMPLEMENTATION-REPORT.md).

Available commands are `migrate`, `verify`, `serve`, and `serve-provisioner`. The implemented preview HTTP
surface is:

```text
GET  /health/live
GET  /health/ready
GET  /v1/context
GET  /v1/types/{typeKey}/versions/{version}
PUT  /v1/scopes/{scopeId}/uploads/{claimId}
PUT  /v1/scopes/{scopeId}/publications/{publicationId}
GET  /v1/scopes/{scopeId}/artifacts/{artifactId}
HEAD /v1/scopes/{scopeId}/artifacts/{artifactId}/content
GET  /v1/scopes/{scopeId}/artifacts/{artifactId}/content
GET  /v1/scopes/{scopeId}/publications
```

Uploads require `Content-Length`, `Content-Type`, and `X-Expected-SHA256` headers.
Publication requires `If-Artifact-Store-Epoch`, obtained from `GET /v1/context`.
Content GET supports one standard byte range. Runtime defaults admit 25 MiB per upload,
two simultaneous upload bodies, 32 live claims, 100 MiB staged data, and 1 GiB logical
published data per scope; each limit is configurable through the environment variables
documented in the Compose overlay.

## Verify

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace --all-features
bun run --cwd ../../libs/aven-artifact-store check
bun test ../../libs/aven-artifact-store/tests
```

The PostgreSQL/HTTP smoke path used during implementation performs context discovery,
an exact upload, root publication, permanent replay, artifact/content retrieval, and
feed replay against a clean PostgreSQL 17 instance.
