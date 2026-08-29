# Customer platform operator checklist

Status: implemented companion to the
[fresh infrastructure runbook](infrastructure-getting-started.md)

Date: 2026-08-29

Use the infrastructure runbook for the exact GitHub secrets, variables, Pulumi
workflow, software deployment, SSH roles, local verification, and apex promotion.
This page is the shorter acceptance checklist for the customer-data plane.

## Before infrastructure

Run from a clean worktree:

```sh
bun install --frozen-lockfile
bun run check:customer-platform
bun run test:customer-platform
bun run test:infra
bun run test:deploy
bun run test:e2e:platform
```

Do not preview or deploy a ref which fails any command. The E2E run proves two
physical customer databases, exact component migrations, a real production-build
Tauri device login, native artifact upload, client-side document import, derived
artifact publication, LLM chat, durable Intent contributions, Intent and Actor facade
calls, second-passkey login, cross-customer denial, cross-component denial, durable
checkout-to-platform delivery, raw Polar webhook retention (including an unknown event
type), and leak-free Compose teardown.

## Infrastructure acceptance

The Pulumi preview must show:

- one protected identity server and volume;
- one protected platform server and volume;
- one firewall per host with HTTP(S), ICMP, and CIDR-restricted SSH only;
- distinct deploy, observe, tunnel, and host Ed25519 keys for each host;
- generated database credentials, function roots, workload tokens, and the tenant
  signing key marked secret; and
- DNS for `aven.id`, `api.aven.ceo`, and `my.aven.ceo`, with no `aven.ceo` apex change
  unless explicitly requested.

Reject unexpected replacements, wider SSH access, shared host/role keys, unprotected
stateful resources, or a plaintext secret.

## Software acceptance

The digest-pinned deployment is healthy only when:

- identity and platform database-role reconciliation completes before migrations;
- `aven.id`, `api.aven.ceo`, and `my.aven.ceo` readiness succeeds;
- the provisioner heartbeat uses the compiled component-catalog digest;
- all required components report the exact schema version, migration digest, and
  routing generation;
- a sandbox purchase produces an environment and a usable passkey account;
- Artifact, Intent, and Actor operate only through `/api/environments/{id}/...`; and
- no client-supplied identity, tenant, database, or routing header becomes authority.

## Customer database audit

For each environment, verify:

```text
cust_<32-lowercase-hex-environment-id>
├── aven_platform
├── artifact_store
├── aven_intents
└── aven_actor_runs
```

The database must revoke `PUBLIC` access. Its NOLOGIN database, platform, and
component owners must be separate. Each customer-qualified runtime login must have
`CONNECT` to exactly that database and explicit table privileges only for its function.
Artifact cannot read Intent or Actor tables; Intent cannot read Artifact or Actor
tables; Actor cannot read Artifact or Intent tables. None can create a table or choose
another customer's database.

## Safe operations

Use only the generated role-specific access rail:

```sh
./tools/stack-observe/run.sh platform ps
./tools/stack-observe/run.sh platform logs
./tools/db-tunnel/open.sh platform 55432
```

The tunnel is transport, not database authorization. Pair it with a separately issued
read-only SQL role. Never use a service, migrator, provisioner, or `postgres` password
for routine debugging.

## Adding a component

A new data-bearing service is admissible only after it adds:

1. a pinned component identity and manifest;
2. append-only migration SQL and a migration-set digest;
3. one schema owner and one role specification per executable function;
4. a facade segment with explicit action mapping and tenant-grant audience;
5. runtime use of the shared tenant admission and bounded pool provider; and
6. conformance tests for two customers, replay, stale generation/digest, forged
   headers, cross-role access, restart/retry, and denied DDL.

No service receives a shared customer database, caller-selected connection string,
cluster credential, or access to another component's schema.
