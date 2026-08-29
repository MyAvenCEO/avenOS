# Backup and recovery

Status: authoritative

The recovery model is simple: create new infrastructure from Git and Pulumi, restore
the newest verified off-host backups, reconcile current roles and schemas, and reopen
traffic only after smoke checks. Do not repair or copy an unknown failed host.

## Recovery objectives

- Database recovery point objective (RPO): at most one hour after the first successful
  production backup.
- Backup-staleness detection: two hours.
- Staffed host-disaster recovery time objective (RTO): four hours.
- Retention: all snapshots for 14 days, eight weekly points, and twelve monthly points.

The public site is rebuilt from Git. TLS state is disposable. Runtime logs are bounded
diagnostic evidence, not durable business data.

## What is backed up

The identity repository contains accounts, passkeys, sessions, device state, and
identity signing-key rows. The platform repository contains checkout, raw verified
Polar deliveries, platform control data, and every customer database, including
Artifact, Intent, Actor, and future component schemas.

Identity and platform use separate Restic repository prefixes. Hetzner server backups
are disabled because they do not form a complete or tested data-recovery path.

## Automatic backup process

Each host runs the same non-root operations image once an hour with a dedicated
read-only `aven_backup` database role. It:

1. enumerates every connectable non-template database;
2. creates a custom-format PostgreSQL dump preserving owners and ACLs;
3. asks `pg_restore` to parse each dump;
4. records database names, PostgreSQL version, release, role names, and SHA-256
   digests in an integrity manifest;
5. encrypts and uploads the run with Restic;
6. applies retention and verifies repository metadata; and
7. atomically updates `last-success` only after every step succeeds.

The backup role can read application data but cannot write, create databases, create
roles, or restore.

There is currently no supported ad hoc backup trigger. Before a rare high-risk
operation, require a fresh successful hourly marker or add and test a narrow manual
backup workflow rather than using an interactive server shell.

## Check backup health

The hourly operations workflow checks the container and freshness automatically. To
inspect it manually:

```sh
./tools/stack-observe/run.sh identity check
./tools/stack-observe/run.sh platform check
```

Treat an upload without a validated manifest and successful repository check as a
failed backup.

## Fresh-host disaster recovery

You need access to the protected repository environment, Hetzner API, both DNS
providers, and the four-value recovery escrow described in
[Access and secrets](access-and-secrets.md#recovery-escrow).

1. Run `platform-infrastructure` with `command: up` to create fresh hosts and empty
   protected volumes.
2. Apply the newly returned `aven.id` A/AAAA records at its external DNS provider.
3. Enable the Pulumi-managed `aven.ceo` records when the platform host is ready.
4. Run `platform-deploy` for the last verified commit with
   `recover_from_backup: true`.
5. Let the workflow start only PostgreSQL and role initialization, verify and restore
   the newest identity and platform snapshots, then perform normal migrations,
   reconciliation, service startup, and public health checks.
6. Complete checkout, passkey, native-device, artifact, document, chat, Intent, Actor,
   and public-site smoke checks before declaring recovery.

The restore insertion point and the convergence gates after it are defined in
[Startup and readiness](startup-and-readiness.md#recovery-difference).

The restore accepts only the internal `fresh-target-only` confirmation and refuses a
database containing user relations. It verifies the manifest and every dump before
restoring. Missing historical role names are created `NOLOGIN`; password hashes are
not restored. Current role initialization derives fresh passwords and reapplies
least-privilege grants.

## Restore one lost host

Use the same procedure, scoped to replacing the failed foundation. Do not attach an
unverified old volume and reopen writes. Keep customer routing closed until the
restored databases, component schemas, grants, and routing generation reconcile.

## Quarterly recovery drill

Before first production use and once per quarter:

1. provision disposable Hetzner hosts through the real Pulumi path;
2. restore from the real private backup repositories;
3. run the public and customer-data smoke checklist;
4. record snapshot IDs, manifest digests, start/end time, achieved RPO/RTO, and any
   manual decisions; and
5. destroy the disposable infrastructure only after recording evidence.

A second authorized person must be able to locate the escrow. A backup is not accepted
as recoverable merely because its scheduled upload succeeded.

## Continuous proof

Every platform pull request and deployment builds the production operations image and
runs `bun run test:recovery`. The drill backs up source identity and customer data,
restores separate empty targets, compares exact rows and access controls, and proves
wrong-password and populated-target rejection.

The local drill proves the mechanism. The quarterly real-bucket drill proves provider
access, escrow, DNS, infrastructure creation, and operator timing.
