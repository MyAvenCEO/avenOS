# Build and test

Status: authoritative

Use the smallest test level that can disprove the change while iterating. Before a
deployment or merge to a release branch, use the complete gate. A collection of unit
tests is not a substitute for the full-stack proof.

## Fast development checks

From the repository root:

```sh
bun run check
bun run check:identity
bun run check:api
bun run check:checkout
bun run check:customer-platform

bun run test:identity
bun run test:api
bun run test:checkout
bun run test:customer-platform
```

Run the application unit tests separately:

```sh
(cd app && bun test)
```

Format and lint changed files before committing:

```sh
bun run check:docs
bun run lint
```

Use `bun run lint:fix` only when you intend to accept its edits.

## Build production artifacts

Build the web services:

```sh
bun run build:identity
bun run build:api
bun run build:checkout
```

Build the platform-neutral frontend and check the native Rust shell:

```sh
bun run --cwd app build
cargo check --locked --manifest-path app/src-tauri/Cargo.toml
```

Signed App Store, Android, and distribution-specific application builds have separate
credentials and guides under `docs/deploy/`; they are not part of the server-platform
deployment.

The deployment workflow builds service containers itself and publishes immutable GHCR
digests only after verification passes.

## Infrastructure and recovery checks

These tests do not contact Hetzner:

```sh
bun run test:infra
bun run test:deploy
bun run test:recovery
```

- `test:infra` evaluates the Pulumi program and security-sensitive cloud-init output.
- `test:deploy` validates shell scripts, production Compose files, Caddy
  configuration, dependency order, non-root images, and secret-safe build contexts.
- `test:recovery` creates source databases, takes encrypted backups, restores fresh
  targets, compares exact data and access control lists, and proves wrong-key and
  populated-target rejection.

## Full-stack E2E release gate

On a prepared Linux workstation:

```sh
bun run test:e2e:platform
```

The harness builds an optimized Rust/Tauri application and every service image, starts
fresh databases on dynamic loopback ports, and proves the public journey:

- checkout, email, fake payment, signup, and raw Polar webhook retention;
- first and second passkey enrollment and login;
- native Tauri device authorization and short-lived service-token exchange;
- customer database provisioning and per-schema isolation;
- artifact upload and exact readback;
- native document import on both Device and Server placement, exact source and
  extracted bytes, and canonical stored-graph equivalence for the deterministic text
  fixture;
- authenticated LLM chat with durable Intent history, including session-local
  anonymous speaker attribution and a duplex interruption followed by another
  speaker;
- focused Actor runtime conformance against fresh PostgreSQL and the production Rust
  Artifact Store image, including authenticated admission, durable checkpoints,
  lineage, idempotent publication replay, local/server outcome equivalence, and a
  secret continuation that never persists the submitted secret;
- persistent Actor admission through the facade in the native user journey;
- resistance to forged identity, routing, and tenant-grant headers; and
- managed static hosting with verified Git revisions.

The test uses disposable volumes and always tears down the `hosting` profile. Setting
`E2E_SKIP_IMAGE_BUILD=true` is useful while iterating but is not release proof.
The voice path uses deterministic silent fixtures through the production semantic
state machine. It proves ordering, interruption, attribution transport, and Intent
persistence without microphone hardware; physical acoustic qualification remains the
separate procedure in
[Voice dependency qualification](../voice-dependency-qualification.md).
The [Actor runtime proof strategy](../actor-runtime-proof-strategy.md) states the exact
claims this rail establishes. The focused document conformance suite additionally
compares browser and headless-runner results for deterministic text, CSV, and
native-text PDF goldens; server OCR and live-model parity remain explicit gaps.

## Complete pre-deployment gate

For a clean local release candidate, run:

```sh
bun install --frozen-lockfile
bun run lint
bun run check
bun run check:identity
bun run check:api
bun run check:checkout
bun run check:customer-platform
bun run test:identity
bun run test:api
bun run test:checkout
bun run test:customer-platform
(cd app && bun test)
bun run build:identity
bun run build:api
bun run build:checkout
bun run test:infra
bun run test:deploy
bun run test:recovery
bun run test:e2e:platform
```

`platform-ci` and `platform-deploy` repeat the release-critical checks on Linux. A
deployment cannot publish images until its verification job passes.

## Failure handling

- Read the first failing component, not the final aggregate exit code.
- On an E2E failure, the harness prints Compose state and the last 200 log lines before
  cleanup.
- Do not call a result flaky without identifying and recording the nondeterministic
  dependency.
- Re-run the complete gate after changing shared contracts, migrations, deployment
  sources, authentication, authorization, or recovery behavior.
