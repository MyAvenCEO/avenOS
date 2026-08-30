# Deployment

Status: authoritative

The deployment system operates three protected targets through the same two GitHub
workflows. `identity` owns the shared account and passkey service. `next` and
production own separate platform hosts, databases, credentials, backups, and public
origins. A release branch is only a candidate ref; choosing a deployment target is a
separate protected action.

## Deployment targets

| Target | Pulumi stack | Public origins | Static source |
| --- | --- | --- | --- |
| `identity` | `organization/aven-platform/identity` | `aven.id` | None |
| `next` | `organization/aven-platform/next` | `next.aven.ceo`, `api.next.aven.ceo`, `my.next.aven.ceo` | `aven-brands` `next` and `deploy/next` |
| `production` | `organization/aven-platform/production` | `aven.ceo`, `api.aven.ceo`, `my.aven.ceo` | `aven-brands` `production` and `deploy/production` |

The platform stacks share no database, tenant-signing key, service credential,
customer route, backup path, SSH identity, or Pulumi state. Both accept short-lived
tokens from `https://aven.id`. Each platform stack generates its own internal
provisioning credential. The shared identity deployment admits both; neither platform
deployment receives identity-state or cross-platform-state access.

## Before the first deployment

Complete [Initial provisioning](initial-provisioning.md). It creates a fresh namespaced
set of six GitHub Environments, the state and backup buckets, their policies, and the
recovery record. You still need repository administration, provider-issued credentials,
and access to the external DNS provider for `aven.id`.

Prove the candidate through [Build and test](build-and-test.md). The deployment
workflow repeats the release-critical gate before publishing images.

## Provision fresh infrastructure

The workflows select physical Environments through the repository variable
`DEPLOYMENT_ENVIRONMENT_PREFIX`; do not type or reuse a physical Environment name.

Run `platform-infrastructure` once for each target. Begin with `command: preview` and
review one protected server, one protected volume, one firewall, generated SSH
identities, and the target's expected DNS behavior. Reject an unexpected replacement,
wider SSH ingress, an unprotected stateful resource, or the wrong target stack.

Accept the reviewed plan and repeat with `command: up` in this order:

1. `target: identity`;
2. `target: next`; and
3. `target: production`.

The order keeps the shared control plane explicit, although no software is admitted
until all three foundations exist. The platform runs create all A and AAAA records
for their own three origins. There is no DNS promotion flag and no legacy host to cut
over.

Pulumi installs Docker and Compose, mounts the protected volume, enables UFW,
fail2ban, bounded logs, and unattended security updates, and records cloud-init
completion. Do not create or upload SSH keys manually.

## Apply the external `aven.id` records

Read `identityDnsRecords` from the successful identity Pulumi summary. At the
authoritative external provider, replace the `aven.id` apex records with exactly:

- `A`, name `@`, returned identity IPv4 address, TTL 300;
- `AAAA`, name `@`, returned identity IPv6 address, TTL 300.

Verify the authoritative answers:

```sh
dig +short A aven.id
dig +short AAAA aven.id
```

Do not copy addresses from an earlier run or point `aven.id` at either platform host.

## Deploy the software

Run `platform-deploy` three times. Supply an exact verified commit or the intended
release branch as `ref`, keep `recover_from_backup: false`, and select targets in this
order:

1. `identity`;
2. `next`; and
3. `production`.

Identity deployment requires the already-managed A and AAAA records and provisioned
Pulumi stacks for both platform targets. It resolves those records, writes their exact
addresses into Caddy's internal-route allowlist, and reads each platform's generated
provisioning credential through the protected identity Environment.

Each platform deployment selects its own generated identity credential, domains,
static-site branches, tenant-grant issuer, backup label, and backup prefix from the target. The
workflow does not accept those security-sensitive values as free-form inputs.

Every deployment:

1. repeats static, unit, Rust, infrastructure, recovery, and full-stack E2E checks;
2. resolves the live Phala-hosted RedPill chat catalog and rejects invalid metadata;
3. builds non-root images and records immutable GHCR digests;
4. reads generated keys and secrets from the selected Pulumi state;
5. installs a mode-`0600` bundle through the fixed host wrapper;
6. creates or rotates exact database roles;
7. runs migrations, Polar product-manifest convergence, and customer reconciliation;
   and
8. requires Compose, backup, static-site, and public readiness.

The exact dependency graph is in
[Startup and readiness](startup-and-readiness.md). No operator opens SSH, writes a
server file, or handles a generated database password.

## Verify the environments

Verify shared identity and `next`:

```sh
curl --fail https://aven.id/api/health/ready
curl --fail https://api.next.aven.ceo/health/live
curl --fail https://my.next.aven.ceo/api/health/ready
curl --fail https://next.aven.ceo/
```

Complete a sandbox checkout, email, passkey, native-device, customer-data, document,
chat, Intent, and Actor smoke test in `next` before deploying the same verified ref to
production.

The distributed client defaults to production. For a workstation-only `next` smoke
build, compile the Rust shell against the staging API while retaining the shared
identity origin:

```sh
AVEN_IDENTITY_BASE_URL=https://aven.id \
AVEN_API_BASE_URL=https://api.next.aven.ceo \
bun run --cwd app tauri:dev
```

Verify production:

```sh
curl --fail https://api.aven.ceo/health/live
curl --fail https://my.aven.ceo/api/health/ready
curl --fail https://aven.ceo/
```

Complete one real low-risk purchase and the same authenticated application smoke
path. Confirm that its account appears in shared identity and that no resulting
commerce, customer, Intent, Artifact, or Actor record exists in `next`.

## Deploy an update

Run `platform-deploy` for the affected target with an exact verified ref and
`recover_from_backup: false`. Deploy identity changes first when a release changes a
shared identity contract. Deploy and smoke-test `next` before production for platform
changes.

The same role initialization, migrations, reconciliation, health checks, and backup
checks run on every update. A production deployment never promotes or copies the
`next` database.

## Roll back application code

Redeploy a previously verified ref whose schema contract is still supported. The
workflow rebuilds immutable images for that ref. It does not roll database state
backward.

If migration or reconciliation fails, traffic stays closed. Inspect fixed-scope logs,
correct forward, and redeploy. Never run reverse migration SQL as an improvised
rollback.

## Promote release branches

The `promote` workflow fast-forwards `main` to `next` or `next` to `prod`. Promotion
changes a Git reference only. It does not provision or deploy infrastructure. A human
still chooses `target: production` and supplies the intended ref to
`platform-deploy`.
