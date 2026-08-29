# Operating Aven from first deploy through disaster recovery

Status: initial production operations contract
Date: 2026-08-29

## Decision

The first production shape is two replaceable Hetzner hosts, two PostgreSQL clusters,
immutable container images, encrypted off-host logical backups, and GitHub Actions as
the scheduler and audit trail for deployment and monitoring. There is no legacy host,
volume import, Kubernetes cluster, Grafana, Prometheus, log shipper, or interactive root
account.

The disaster-recovery operator journey is deliberately short:

1. regain access to the repository's protected recovery environment, the Hetzner API,
   and the DNS providers;
2. run Pulumi to create fresh identity and platform hosts with empty protected volumes;
3. apply the returned `aven.id` A/AAAA records and enable the Pulumi-managed
   `aven.ceo` records;
4. run `platform-deploy` with **Restore newest backups** enabled;
5. let the workflow restore data, recreate database roles, migrate and reconcile, then
   verify the public health checks; and
6. complete the checkout, passkey, native-device and customer-data smoke checklist
   before declaring recovery complete.

No old server, copied disk, hand-authored SSH key, remembered database password, or
legacy application image is an input.

Human interaction is an exception, not an orchestration mechanism. Once the protected
environment is configured, initial provisioning and disaster recovery use the same two
workflows. The data-mode input (`empty` or `newest backup`) is their only behavioral
difference. The only required human gates are approving the protected run, applying
the externally managed `aven.id` records, and accepting the final smoke-test result.

## What must survive

| Recovery unit | Source of truth | Recovery method |
| --- | --- | --- |
| Identity accounts, passkeys, sessions, setup/device state and signing-key rows | `aven_identity` database | newest verified identity repository snapshot |
| Checkout, raw Polar deliveries, site control, entitlements and routing | platform control databases | newest verified platform repository snapshot |
| Artifact, Intent, Actor and future service data | each customer's own database | same platform snapshot; every non-template database is dumped independently |
| Application and infrastructure definitions | Git commit plus immutable image digests | rebuild/redeploy from GitHub |
| `aven.ceo` content | Git source and deployment branches | managed static host fetches it again |
| TLS state | not critical | Caddy obtains new certificates |
| Runtime logs | operational evidence, not durable business data | bounded local retention; preserve manually during an incident if needed |
| Pulumi state | private versioned object storage | object-store version history and offline recovery access |

Hetzner server backups are disabled. They would cover only replaceable boot-disk state,
while PostgreSQL and site data live on attached volumes. Keeping them would create a
second misleading recovery path; fresh Pulumi provisioning is the only host path.

## Initial recovery objectives

- Database RPO: at most one hour after the first successful production backup.
- Backup-staleness detection: two hours.
- Host-disaster RTO: four hours during staffed operation.
- Public availability monitoring: hourly from outside the hosts.
- Retention: everything from the last 14 days, eight weekly recovery points, and twelve
  monthly recovery points.

These are promises the current small system can actually test. Before data size makes
an hourly logical backup take 15 minutes, or before the business requires an RPO below
one hour, add continuous WAL archiving and physical base backups. The logical manifest
and fresh-host recovery workflow remain the selective-restore and portability layer;
they do not need to be replaced.

## Backup contract

The identity and platform stacks each run the same non-root operations image under a
dedicated `aven_backup` database login. It inherits `pg_read_all_data`, receives
`CONNECT` on each database from the provisioner, and cannot write application data,
create databases, create roles, or restore. Once an hour it:

1. enumerates every connectable non-template database;
2. creates a PostgreSQL custom-format dump preserving object owners and ACLs;
3. asks `pg_restore` to parse every dump before accepting it;
4. records the environment, host, release, PostgreSQL version, database names and
   SHA-256 digests in `manifest.json`;
5. writes a digest of the manifest;
6. uploads the run to its own encrypted Restic repository;
7. applies the bounded retention policy and verifies repository metadata; and
8. atomically records `last-success` only after every preceding step succeeded.

Role names required by ownership and ACL records are integrity-covered beside each
dump. Recovery creates missing names as `NOLOGIN`; it never restores password hashes.
After restore, the normal role initializer and customer reconciler explicitly enable
current login roles, derive fresh passwords and reapply the current least-privilege
grants and routing generation. Unrecognized historical role names remain `NOLOGIN`
and unrouted; explicit customer/component retirement removes them later.

Identity and platform use separate repository prefixes. The S3-compatible access key
may write only the backup bucket/prefix and may not administer compute or DNS. Restic
encrypts names, contents and metadata before upload.

## Recovery escrow

Four bootstrap values live outside the two-host failure domain:

- Pulumi state object-store access;
- `PULUMI_CONFIG_PASSPHRASE`;
- backup object-store access; and
- `BACKUP_RESTIC_PASSWORD`.

They are stored as protected GitHub Environment secrets and duplicated in the company
password manager's offline recovery record. This is the only manual escrow. All SSH
keys, host keys, service credentials and database passwords are created or derived by
Pulumi. A quarterly drill must prove a second authorized person can locate the escrow
without copying values into chat, tickets, shell history or a runbook.

## Restore fencing

The restore command accepts only `RESTORE_CONFIRMATION=fresh-target-only`. It refuses
to overwrite any database containing user relations. Databases created empty by the
fresh cluster initializer may be dropped and recreated; populated databases fail
closed. Each dump and the manifest are verified before restore.

The recovery wrapper starts only PostgreSQL and declarative role initialization,
restores the newest backup, then starts the normal deployment. Migrations and the
provisioner run forward. Customer routing stays closed until reconciliation verifies
the restored physical database, component schemas and current per-function grants.
The platform must never attach a restored customer database under a stale routing
generation.

## Application lifecycle

### 1. Design and build

- Every stateful feature declares its owning customer schema, runtime role, migration
  role, health semantics, structured log events and recovery verification query.
- New services may not gain cluster-wide customer database access.
- Schema changes are forward-compatible with the immediately previous application
  image. Destructive cleanup follows a later release after backup proof.
- CI builds immutable non-root images and tests that `.npmrc`, environment files and
  credentials are outside every build context and layer.

### 2. Provision

- Pulumi creates hosts, protected empty volumes, firewalls, fixed SSH roles, host keys
  and generated secrets.
- Cloud-init mounts the volume, enables UFW/fail2ban/unattended upgrades, bounds Docker
  and journal logs, and records completion.
- `aven.id` DNS remains a manual handoff because its authoritative provider is not
  Hetzner. Pulumi manages the `aven.ceo` zone only.

### 3. Deploy and migrate

- CI verifies the exact commit before publishing images.
- The deployment uses image digests, a pinned SSH host key and the fixed deploy
  wrapper. No human shell edits production files.
- Role initialization runs on every deploy. Migrations complete before traffic-serving
  containers become healthy.
- Deployment is successful only when Compose health, public readiness and the backup
  container are healthy.

### 4. Normal operation

- Containers restart automatically; Docker live-restore keeps them running across a
  daemon restart.
- Ubuntu installs security updates automatically. Reboots occur only when required and
  are staggered: identity at 03:30 UTC, platform at 04:00 UTC.
- Docker keeps five 10 MiB JSON log files per container. Journald uses at most 256 MiB
  persistently, 64 MiB at runtime, compresses, and retains no more than 14 days.
- The fixed observer can show Compose state, the last 300 log lines, disk usage and the
  latest backup marker. It cannot open a TTY, forward a port or change state.
- The tunnel account can forward only host-loopback PostgreSQL. Database access still
  requires a separately issued time-bounded read-only role.

### 5. Change and rollback

- Code rollback means redeploying a previously verified digest whose schema contract
  is still supported. Database state is not rolled backward automatically.
- A failed migration or reconciliation keeps the new service unhealthy and traffic
  closed. Operators inspect fixed-scope logs, correct forward, and redeploy.
- Public static content rolls forward from Git. There is no old apex target.

### 6. Incident response

One person is incident lead; another records the timeline when available. The lead:

1. opens the failed GitHub operations run and runs
   `./tools/stack-observe/run.sh <host> status`;
2. captures relevant fixed-scope logs before restarting anything;
3. classifies availability, security, data-integrity or provider failure;
4. stops writes by removing ingress or stopping only the named service when evidence
   shows continuing damage;
5. rotates the smallest affected credential and redeploys;
6. restores only to a fresh target when data integrity is uncertain; and
7. records detection, impact, decisions, recovery point, verification and follow-up.

The deploy identity is the emergency maintenance identity. It has only the fixed
deploy/restore commands through sudo. There is deliberately no general remote root
shell. If OS-level forensics requires one, use the Hetzner rescue console, snapshot
evidence first, and treat the host as contaminated and replace it afterwards.

### 7. Scale

Add machinery only when a measured threshold is crossed:

| Trigger | Next step |
| --- | --- |
| Logical backup exceeds 15 minutes or RPO must be below one hour | continuous WAL archive plus periodic physical base backup |
| Local logs are insufficient for investigations or more than two hosts exist | ship the same structured JSON events to a managed log store |
| Hourly external checks are too slow | dedicated uptime provider with paging |
| One platform host cannot meet capacity/maintenance goals | separate database and stateless service hosts, then add failover |
| Manual incident coordination becomes frequent | on-call rota, paging and formal severity/SLO policy |

Stable health endpoints, JSON logs, manifests and observer commands are the seams for
those additions. No application API needs to change merely to adopt them.

### 8. Retirement

- Disable ingress and workload credentials first.
- Take and verify a final backup, record its retention/legal disposition, then remove
  customer routing and derived roles.
- Destroy compute only after recovery evidence exists. Delete protected data and
  backup repositories only through a separately reviewed, explicit process.
- Remove DNS last so stale clients fail closed rather than reach a reassigned host.

## Monitoring without an observability stack

The scheduled `platform-operations` workflow is the external monitor and audit trail.
It activates automatically after the first successful deployment containing the new
operations stack; before that, scheduled runs are dormant and manual runs remain
strict. It verifies public identity, API, checkout and static-site readiness, connects
with the observer keys from encrypted Pulumi state, fails when the data volume reaches
85%, and requires each backup container to be healthy. GitHub's failed-workflow
notifications are the initial alert channel.

The minimum signals are:

- public endpoint unreachable or non-ready;
- service/container unhealthy or restart loop;
- last successful backup older than two hours;
- data volume at least 85% full;
- TLS renewal/public HTTPS failure;
- migration, reconciliation, webhook, email or static-site synchronization failure;
- repeated authentication/authorization rejection anomaly; and
- unattended-upgrade or reboot failure.

Application logs are single-line JSON on stdout/stderr with event name, timestamp,
service, request/trace identifier and safe resource identifiers. They must never contain
tokens, cookies, passkey challenges, database URLs, raw email bodies, provider secrets
or raw customer document/chat content. Raw Polar JSON belongs in its restricted
database table, not the logs.

## Proving it continuously

Every platform PR and deployment runs the recovery drill with the production
operations image. The drill creates a source PostgreSQL cluster, stores identity and
customer data, backs it up, destroys the logical target, restores into a separate empty
cluster and compares exact rows. It also proves a populated target cannot be
overwritten and a wrong encryption key cannot decrypt the repository.

Before the first production promotion, and quarterly thereafter, run the same process
against disposable Hetzner hosts and the real private backup bucket. Record start/end
times, selected snapshot IDs, restored manifest digests, smoke results and achieved
RPO/RTO. A backup is not accepted as working merely because an upload succeeded.
