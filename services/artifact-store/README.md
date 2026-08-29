# Aven Artifact Store

This directory contains the durable, immutable Artifact Store kernel: contracts,
validation, PostgreSQL persistence, and the HTTP server. It intentionally contains no
document processor, actor runner, intent service, model adapter, or checkout logic.

The hard-coded processor and per-customer provisioning runtime were removed during the
fresh platform cut. The generic actor runner under development in
`feat/document-ingest-actors` will integrate this store through `api.aven.ceo` with
short-lived, scope- and action-bound grants. Until that integration lands, the Artifact
Store is buildable and testable source but is not part of the new production Compose
stack.

## Local verification

Rust 1.93.1 and PostgreSQL 17 are the tested toolchain.

```bash
export ARTIFACT_STORE_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/artifact_store
cargo run -p aven-artifact-store-server --bin aven-artifact-store -- migrate
```

For the fixed-scope development adapter:

```bash
export ARTIFACT_STORE_SCOPE_ID=11111111-1111-4111-8111-111111111111
export ARTIFACT_STORE_BEARER_TOKEN='replace-with-a-url-safe-secret'
export ARTIFACT_STORE_PUBLISHER_ISSUER='api.aven.ceo'
export ARTIFACT_STORE_PUBLISHER_SUBJECT='service:local-runner'
export ARTIFACT_STORE_LISTEN=127.0.0.1:8087
cargo run -p aven-artifact-store-server --bin aven-artifact-store -- serve
```

The client cannot select a database, physical tenant route, publisher, or scope. Those
values are established by the trusted service boundary.

## Verify

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace --all-features
bun run --cwd ../../libs/aven-artifact-store check
bun test ../../libs/aven-artifact-store/tests
```

The normative store contracts live in [`artifact-store-spec`](artifact-store-spec/README.md).
