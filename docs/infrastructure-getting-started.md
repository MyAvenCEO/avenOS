# Fresh Aven infrastructure: zero to healthy

Status: implemented runbook for the two-host customer-database platform

Date: 2026-08-29

This is the complete path from an empty Hetzner project to the new Aven deployment.
It does not import the legacy server or its databases. Git remains the source of truth
for `aven.ceo`; the apex may stay down until the final promotion.

```text
Hetzner host 1                       Hetzner host 2
aven.id                              aven.ceo platform
├── Caddy                            ├── Caddy
├── identity                         ├── api.aven.ceo facade
└── identity PostgreSQL              ├── my.aven.ceo checkout
                                     ├── static aven.ceo host
                                     ├── provisioner, Artifact, Intent, Actor
                                     └── central + customer PostgreSQL
```

Pulumi creates both servers, protected volumes, firewalls, the records in the
Hetzner-managed `aven.ceo` zone, all client and host SSH keys, application secrets,
database passwords, customer-role derivation roots, and the tenant-grant signing key.
It returns—but deliberately does not apply—the two `aven.id` apex records required by
its external DNS provider. Do not create or upload an SSH key manually.

## 1. Bootstrap prerequisites

You need:

- administrator access to this repository and its GitHub `next` Environment;
- a Hetzner Cloud project with compute access and DNS write access for `aven.ceo`;
- administrator access to the external DNS provider authoritative for `aven.id`;
- a private Hetzner Object Storage bucket for Pulumi state, with versioning and public
  access disabled;
- Polar sandbox credentials; and
- an SMTP sender suitable for `next`.

The object-storage bucket and its restricted access key are the only manual
infrastructure bootstrap. Pulumi cannot create the backend which stores its own state.

## 2. Configure GitHub

Open **Settings → Environments → next**. Add reviewers if desired.

### Environment secrets

| Secret | Why it is needed |
| --- | --- |
| `HETZNER_COMPUTE_TOKEN` | Creates the two servers, volumes, firewalls, and deploy-key registrations. Scope it to this project. |
| `HETZNER_DNS_TOKEN` | Manages only records in the Hetzner-hosted `aven.ceo` zone. Prefer a separately scoped token. It needs no access to `aven.id`. |
| `PULUMI_STATE_S3_ACCESS_KEY_ID` | Reads and writes the private state bucket only. |
| `PULUMI_STATE_S3_SECRET_ACCESS_KEY` | Secret half of the state credential. |
| `PULUMI_CONFIG_PASSPHRASE` | Encrypts every generated private key and runtime secret in state. Back it up securely. |
| `POLAR_API_KEY` | Checkout access to the Polar sandbox organization. |
| `POLAR_WEBHOOK_SECRET` | Authenticates Polar events. |
| `AVEN_TIER_NAME` | Existing Polar product ID for the manually managed avenNAME product; checkout must never create or infer this product. |
| `SMTP_URL` | Authenticated send-only SMTP connection; URL-encode credentials. |
| `LLM_GATEWAY_CREDENTIALS_JSON` | Provider credentials keyed by the provider names referenced by the public model catalog. It remains server-side in the API container. |

`GITHUB_TOKEN` is supplied by Actions. There is deliberately no deploy SSH key,
public SSH key, known-hosts value, PostgreSQL password, tenant signing key, or internal
bearer in GitHub. Pulumi generates these. `.npmrc` is excluded from all Docker build
contexts and the registry token exists only in a BuildKit secret-mounted command.

### Environment variables

| Variable | Example | Purpose |
| --- | --- | --- |
| `PULUMI_STATE_S3_BUCKET` | private bucket name | Pulumi backend bucket |
| `PULUMI_STATE_S3_REGION` | `hel1` | Required Object Storage region |
| `PULUMI_STACK` | `organization/aven-platform/next` | Exact isolated stack required by CI |
| `HETZNER_LOCATION` | `hel1` | Host and volume location |
| `HETZNER_SERVER_TYPE` | an amd64 type such as `cx23` | Default server type |
| `IDENTITY_SERVER_TYPE` | optional | Identity override; otherwise default |
| `PLATFORM_SERVER_TYPE` | optional | Platform override; otherwise default |
| `HETZNER_OS_IMAGE` | `ubuntu-24.04` | Fresh base image |
| `IDENTITY_VOLUME_SIZE_GB` | `40` | At least 30 GiB |
| `PLATFORM_VOLUME_SIZE_GB` | `80` | At least 40 GiB |
| `HETZNER_ENABLE_BACKUPS` | `true` | Provider backup in addition to logical backups |
| `SSH_ALLOWED_CIDRS` | office/VPN CIDRs | Comma-separated IPv4/IPv6 sources allowed to port 22 |
| `POLAR_SERVER` | `sandbox` | Payment environment for initial deployment |
| `POLAR_ORGANIZATION_ID` | sandbox UUID | Checkout product owner |
| `SMTP_FROM` | `Aven <no-reply@aven.ceo>` | Visible sender |
| `SMTP_REPLY_TO` | monitored address | Optional reply destination |
| `DOWNLOAD_URL` | tested download URL | Checkout mail and UI target |
| `ACME_EMAIL` | monitored address | Certificate notices |
| `ANDROID_APP_CERT_SHA256_FINGERPRINTS` | empty initially | Production Android certificates only |
| `LLM_GATEWAY_MODELS_JSON` | provider-neutral model catalog JSON | Public IDs, capabilities, upstream base URLs/models, profiles, and credential references; never provider secret values |
| `LLM_GATEWAY_TIMEOUT_SECONDS` | `180` | Optional bounded provider timeout |

The workflow rejects an empty SSH allowlist, non-amd64 images, undersized volumes,
invalid CIDRs, or a stack other than `organization/aven-platform/next`.

## 3. Prove the release locally

From a clean worktree:

```sh
bun install --frozen-lockfile
bun run check
bun run check:identity
bun run check:api
bun run check:checkout
bun run check:customer-platform
bun run test:identity
bun run test:api
bun run test:customer-platform
bun run test:infra
bun run test:deploy
bun run test:e2e:platform
```

The E2E test creates fresh databases and real containers, performs checkout and email,
provisions identity, registers two passkeys on different virtual authenticators,
rejects a second avenNAME for that account, authorizes a production-build Tauri
application through the real device flow, and proves the clean-checkout native resource
package can launch. It uploads a fixture through the native Rust command, publishes and
reads back exact source and derived artifacts, imports the document through the client
actor graph, completes an LLM chat through the facade, and proves both chat turns
durable in the customer Intent schema. It also provisions two customer databases,
exercises Intent and Actor through the facade, proves cross-customer and cross-schema
denials, retains raw Polar webhook JSON, and serves the `aven.ceo` snapshot. Every run
uses dynamic loopback ports and profile-aware teardown.

For interactive browser and Rust-client use, follow
[`deploy/local/README.md`](../deploy/local/README.md).

## 4. Preview, then create the hosts

Run **Actions → platform-infrastructure** with `command: preview` and leave
`manage_aven_ceo_apex` false. Review exactly two protected servers, two protected
volumes, two firewalls, four non-apex `aven.ceo` records, nine Ed25519 keys, generated
secrets, and an `identityDnsRecords` output containing the external DNS handoff.

Then rerun with `command: up`, still with the apex disabled. Pulumi installs:

- distinct deploy, observe, and tunnel identities for each host;
- a stable pinned Ed25519 host key for each host;
- `aven-deploy`, allowed to invoke only one fixed deployment wrapper;
- `aven-observe`, allowed to invoke only fixed Compose status/log commands;
- `aven-tunnel`, allowed to forward only to host-loopback PostgreSQL;
- Docker/Compose, UFW, fail2ban, unattended upgrades, and the protected volume; and
- `/var/lib/aven/cloud-init-complete` after bootstrap succeeds.

Private keys remain encrypted in Pulumi state. SSH never uses `ssh-keyscan` as a trust
source and never accepts an interactive unknown host key. At this stage
`api.aven.ceo` and `my.aven.ceo` point to the platform host; `aven.ceo` has not moved,
and Pulumi has not changed `aven.id`.

## 5. Add the returned `aven.id` records

Read `identityDnsRecords` from the successful Pulumi update summary. From a trusted
workstation configured for the same backend and stack, the equivalent command is:

```sh
pulumi -C infrastructure/platform stack output identityDnsRecords --json
```

At the DNS provider authoritative for `aven.id`, replace the apex records with the
returned values exactly:

- `A` record, name `@`, value equal to `identityIpv4Address`, TTL `300`;
- `AAAA` record, name `@`, value equal to `identityIpv6Address`, TTL `300`.

Do not point `aven.id` at the platform host and do not copy either address from a
previous run. Confirm the authoritative answers before deploying software:

```sh
dig +short A aven.id
dig +short AAAA aven.id
```

They must equal the two values in `identityDnsRecords`. The deploy workflow performs
an HTTPS readiness check and will fail safely until these records have converged and
Caddy can obtain the certificate.

## 6. Build and deploy software

Run **Actions → platform-deploy** for the exact tested commit. Its verify job repeats
all checks and E2E. The publish job builds eight non-root images and records immutable
GHCR digests: identity, API, checkout, static host, provisioner, Artifact Store,
Intent, and Actor.

The deploy job reads Pulumi outputs, masks secrets, creates mode-`0600` temporary
bundles, connects with the generated host-specific deploy key and pinned host key, and
calls the narrow root wrapper. On every deployment a one-shot database-role service
creates or rotates exact roles before migrations run; role setup is not limited to
first volume initialization.

Identity uses distinct auth, account-provisioning, authorization, and migration
database logins. Checkout uses distinct HTTP, webhook, email-worker, platform-event,
and migration logins. The API uses distinct hosting, authorization, entitlement,
reconciliation, and migration logins. Artifact Store has a dedicated cluster-level
provisioner login plus a separately derived per-customer API login. Customer runtime
roles are unique per customer and function, may connect only to that customer's
database, and have privileges only on their component schema.

Verify:

```sh
curl --fail https://aven.id/api/health/ready
curl --fail https://api.aven.ceo/health/live
curl --fail https://my.aven.ceo/api/health/ready
```

Complete a Polar sandbox purchase and passkey login before switching Polar to
production. No deployment changes the `aven.ceo` apex unless the infrastructure
workflow's explicit apex input is true.

## 7. Observe and tunnel safely

On a trusted workstation with the Pulumi CLI, backend variables, state credentials,
and passphrase exported:

```sh
./tools/stack-observe/run.sh identity ps
./tools/stack-observe/run.sh platform logs
./tools/db-tunnel/open.sh platform 55432
```

The tools materialize the appropriate private key in a temporary mode-`0600`
directory, pin the Pulumi host key, and erase the files on exit. PostgreSQL binds only
to `127.0.0.1:5432` on each host. The tunnel key provides transport only; it does not
contain or imply a database password. Use a separately issued read-only database role
for SQL inspection. Runtime, migrator, provisioner, and `postgres` credentials are not
operator credentials.

## 8. Promote `aven.ceo`

When the new deployment is healthy, confirm `myavenceo/aven-brands` has the intended
`production` source and `deploy/production` artifact, including `dist/index.html` and
a matching `dist/.source-revision`. Rerun **platform-infrastructure** with
`command: up` and `manage_aven_ceo_apex: true`.

After DNS convergence verify `/`, an SPA fallback path, TLS, and A/AAAA answers from
more than one network. GitHub remains the public site's source of truth.

## 9. Rollback and recovery

- Roll back code by restoring previous immutable image digests and rerunning the fixed
  deploy wrapper. Do not automatically roll back customer schema migrations.
- Roll back the public site by restoring its prior DNS target or Git artifact.
- Replace a lost host through Pulumi and restore its protected volume or verified
  backup before reopening writes.
- Rotate a function root or routing generation in stages so old pools drain only after
  reconciliation verifies the new credentials.

Servers, volumes, firewalls, keys, and Pulumi-managed `aven.ceo` DNS use protection.
The externally managed `aven.id` records are outside Pulumi state. Normal workflows
do not contain `destroy` or protection-removal paths.

## Secret and data locations

| Location | Contents |
| --- | --- |
| GitHub `next` secrets | Provider/state bootstrap plus Polar and SMTP credentials supplied by humans |
| Encrypted Pulumi state | Generated SSH keys, database credentials, roots, workload tokens, and signing keys |
| `/opt/aven/*/.env` | One host's mode-`0600` runtime material |
| `/var/lib/aven/postgres` | Protected PostgreSQL data on that host |
| `/var/lib/aven/static-sites` | Verified static releases and last-known-good snapshot |
| `/var/lib/aven/caddy` | Caddy certificate and configuration state |
| GitHub | Code and the `aven.ceo` source/artifact branches |

No private key, password, token, `.npmrc`, or environment file belongs in Git, a
Docker layer, a public artifact, a client binary, or logs.
