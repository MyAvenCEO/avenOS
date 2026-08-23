# Aven Artifact Store

Standalone PostgreSQL-backed implementation of the Artifact Store v1 kernel. The
service is consumed over HTTP both by deployed AvenOS services and by the Tauri app
through [`@avenos/artifact-store`](../../libs/aven-artifact-store/README.md); there is
deliberately no Tauri-specific persistence implementation.

The current milestone is a **developer preview**, not a production release. The root
vertical is executable and the run/evidence transaction shape exists, but least-
privilege SQL functions, complete graph reads, quotas, the `aven-api` authorization
decision adapter, and divergent recovery still block production use. See
[PLAN.md](PLAN.md#implementation-status) for the exact status.

## Run locally

Rust 1.93.1 and PostgreSQL 17 are the tested local toolchain.

```bash
export ARTIFACT_STORE_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/artifact_store
cargo run -p aven-artifact-store-server --bin aven-artifact-store -- migrate
```

`migrate` applies the embedded migration and registers the exact source-controlled
`core.file@1` and `core.bundle@1` definitions. Start the fixed-scope preview adapter:

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
```

See the [Aven API local services documentation](../aven-api/README.md#local-services)
for endpoints, port overrides, and teardown. The direct smoke test uses
`cust_artifact_local`; customer databases created by the environment worker receive the
same schema automatically.

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
Content GET supports one standard byte range.

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
