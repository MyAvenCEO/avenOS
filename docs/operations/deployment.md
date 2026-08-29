# Deployment

Status: authoritative

The supported shared deployment target is `next`. It creates two fresh Hetzner hosts
and deploys an exact verified Git commit. Production is intentionally blocked until it
has an isolated and tested target; the Git branch named `prod` alone does not provide
one.

## Before the first deployment

Complete [Access and secrets](access-and-secrets.md). You need repository
administration, the configured protected `next` Environment, Hetzner compute and
`aven.ceo` DNS access, and access to the external DNS provider for `aven.id`.

Prove the candidate through [Build and test](build-and-test.md). The deployment
workflow repeats the release-critical gate before publishing an image.

## Create the `next` infrastructure

In GitHub Actions, run `platform-infrastructure` with:

- `command: preview`;
- `manage_aven_ceo_apex: false`.

Review exactly two protected servers, two protected volumes, two firewalls, generated
secrets and SSH identities, non-apex `aven.ceo` records, and the external
`identityDnsRecords` output. Reject an unexpected replacement, wider SSH ingress,
unprotected stateful resource, or plaintext secret.

Approve and rerun with:

- `command: up`;
- `manage_aven_ceo_apex: false`.

Pulumi installs Docker and Compose, mounts the protected volumes, enables UFW,
fail2ban, bounded logs and unattended security updates, and records cloud-init
completion. Do not create or upload SSH keys manually.

## Apply the external `aven.id` DNS records

Read `identityDnsRecords` from the successful Pulumi summary. At the authoritative
external DNS provider, replace the `aven.id` apex records with the returned values:

- `A`, name `@`, identity IPv4 address, TTL 300;
- `AAAA`, name `@`, identity IPv6 address, TTL 300.

Verify authoritative answers before deploying software:

```sh
dig +short A aven.id
dig +short AAAA aven.id
```

Do not copy addresses from an earlier run or point `aven.id` at the platform host.
Caddy cannot obtain the identity certificate until DNS converges.

## Deploy `next`

Run `platform-deploy` with:

- `ref`: the exact verified commit or `next` branch;
- `recover_from_backup: false`.

The workflow:

1. repeats static, unit, Rust, infrastructure, recovery, and full-stack E2E checks;
2. builds non-root images and records immutable GHCR digests;
3. reads generated keys and secrets from Pulumi state;
4. installs mode-`0600` deployment bundles through the fixed host wrapper;
5. creates or rotates exact database roles;
6. runs migrations and customer reconciliation; and
7. requires Compose, public readiness, and backup-container health.

No operator opens SSH, writes a server file, or handles a generated database password.

Verify:

```sh
curl --fail https://aven.id/api/health/ready
curl --fail https://api.aven.ceo/health/live
curl --fail https://my.aven.ceo/api/health/ready
```

Complete a sandbox checkout, email, passkey, native-device, and customer-data smoke
test. A successful first deployment automatically activates hourly operations checks.

## Publish `aven.ceo`

Confirm `myavenceo/aven-brands` contains the intended `production` source and
`deploy/production` artifact, including `dist/index.html` and matching
`dist/.source-revision`.

Run `platform-infrastructure` again with:

- `command: up`;
- `manage_aven_ceo_apex: true`.

After DNS convergence, verify the homepage, an SPA fallback path, TLS, and A/AAAA
answers from more than one network. Git remains the public site's source of truth.

## Deploy an update

For an existing healthy `next` installation, run only `platform-deploy` with the exact
verified ref and `recover_from_backup: false`. The same role initialization,
migrations, reconciliation, health checks, and backup checks run on every deployment.

## Roll back application code

Redeploy a previously verified ref whose schema contract is still supported. The
workflow rebuilds and deploys immutable images for that ref. It does not roll database
state backward.

If a migration or reconciliation fails, traffic stays closed. Inspect fixed-scope
logs, correct the problem forward, and redeploy. Never run reverse migration SQL on a
shared installation as an improvised rollback.

## Promote release branches

The `promote` workflow fast-forwards `main` to `next` or `next` to `prod`. Promotion
changes a Git reference only. It does not provision or deploy infrastructure.

## Production status

**There is no supported independent production deployment workflow in the current automation.**
The current workflows, concurrency groups, Pulumi stack validation, backup labels, and
GitHub Environment are fixed to `next`. Public domains are fixed as well, so a second
installation cannot coexist by changing only a stack name.

Before production can be deployed, make and test these decisions:

1. Choose whether `next` is a disposable staging installation on separate hostnames or
   the same installation promoted in place.
2. Give production an independent protected GitHub Environment, Pulumi stack, state
   prefix, backup prefix, provider credentials, monitoring schedule, and recovery
   escrow.
3. Define non-conflicting identity, API, checkout, and static-site DNS for simultaneous
   staging, or document and test an in-place promotion.
4. Parameterize or duplicate infrastructure, deploy, and operations workflows without
   allowing one environment to read another's secrets or state.
5. Prove production provisioning, deployment, backup, restore, and public smoke checks
   in CI and on disposable hosts.

Until those changes land, do not place production provider credentials in `next`, do
not label `next` backups as production, and do not treat `next → prod` branch promotion
as a deployment.
