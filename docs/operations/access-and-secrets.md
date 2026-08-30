# Access and secrets

Status: authoritative

Configure human and machine access before provisioning the three deployment targets. Humans
provide only provider bootstrap credentials and approvals. Pulumi generates SSH keys,
database passwords, signing keys, workload tokens, and internal encryption roots.

## Human access

At least two authorized people should be able to recover:

- repository administration and the three protected GitHub Environments;
- the Hetzner Cloud project;
- the Hetzner-managed `aven.ceo` DNS zone;
- the external DNS provider authoritative for `aven.id`;
- Pulumi state object storage;
- backup object storage; and
- the company password-manager recovery record.

Use individual accounts with multi-factor authentication. Do not share a human SSH
private key or a database administrator password.

## One-time object storage

Create private S3-compatible storage for:

1. one versioned Pulumi state bucket each for `identity`, `next`, and `production`;
2. one encrypted Restic repository for shared identity; and
3. separate encrypted Restic repositories or credentials for `next` and production.

Disable public access. Give each state credential access only to its target's bucket
and each backup credential access only to its target's repository or prefix. Neither
platform Environment receives identity-state or cross-platform-state access. The
shared identity Environment receives read-only state access and the passphrase for
both platform stacks so it can assemble their generated identity caller credentials.
This makes the protected identity deployment the highest-trust automation boundary;
limit its reviewers and workflow access accordingly. No storage credential needs
compute or DNS administration.

Pulumi cannot create the backend that stores its own state. This is the only mandatory
manual infrastructure bootstrap.

## GitHub Environments

Create protected GitHub Environments named `identity`, `next`, and `production`.
Require review for infrastructure and deployment jobs. Give production a distinct
reviewer policy from staging.

Create `identity-operations`, `next-operations`, and `production-operations` without
required reviewers so scheduled health checks remain unattended. Each operations
Environment receives only its target's `PULUMI_STACK`, backend variables, read-only
state access key, and passphrase. It receives no compute, DNS, backup, Polar, SMTP,
LLM, package-write, or deployment credential. The passphrase can decrypt the observer
key in state, so restrict these Environments to the default branch and the operations
workflow.

Each deployment Environment holds only its target's provider, state, integration, and
backup configuration. Do not copy a production secret into `next` as a convenience.

## GitHub Environment secrets

| Secret | Consumer and purpose |
| --- | --- |
| `HETZNER_COMPUTE_TOKEN` | Pulumi creates servers, volumes, firewalls, and registered deploy keys |
| `HETZNER_DNS_TOKEN` | Pulumi manages the Hetzner-hosted `aven.ceo` zone only |
| `PULUMI_STATE_S3_ACCESS_KEY_ID` | Workflows read and write the private Pulumi backend |
| `PULUMI_STATE_S3_SECRET_ACCESS_KEY` | Secret half of the Pulumi backend credential |
| `PULUMI_CONFIG_PASSPHRASE` | Encrypts generated secrets and private keys in Pulumi state |
| `POLAR_API_KEY` | Checkout accesses the selected Polar organization |
| `POLAR_WEBHOOK_SECRET` | Checkout verifies Polar webhook signatures |
| `AVEN_TIER_NAME` | Existing Polar product ID for the avenNAME product |
| `SMTP_URL` | Checkout sends account and purchase mail through a send-only account |
| `LLM_GATEWAY_CREDENTIALS_JSON` | Server-side credentials referenced by the public model catalog |
| `BACKUP_S3_ACCESS_KEY_ID` | Backup and restore access the private backup prefix |
| `BACKUP_S3_SECRET_ACCESS_KEY` | Secret half of the backup credential |
| `BACKUP_RESTIC_PASSWORD` | Encrypts the selected target's Restic repository |

`identity` needs compute, its own state and backup values, and no Hetzner DNS, Polar,
SMTP, or LLM credential. It also needs these read-only platform-state values:

| Secret | Consumer and purpose |
| --- | --- |
| `NEXT_STATE_S3_ACCESS_KEY_ID` | Reads only the `next` state bucket while assembling identity |
| `NEXT_STATE_S3_SECRET_ACCESS_KEY` | Secret half of the read-only `next` state credential |
| `NEXT_PULUMI_CONFIG_PASSPHRASE` | Decrypts the `next` platform's identity caller credential |
| `PRODUCTION_STATE_S3_ACCESS_KEY_ID` | Reads only the production state bucket while assembling identity |
| `PRODUCTION_STATE_S3_SECRET_ACCESS_KEY` | Secret half of the read-only production state credential |
| `PRODUCTION_PULUMI_CONFIG_PASSPHRASE` | Decrypts the production platform's identity caller credential |

`next` and `production` need the full platform set, including Hetzner DNS, but no
cross-stack state values. Use Polar sandbox credentials in `next` and production
credentials only in production.

GitHub supplies `GITHUB_TOKEN` to the workflow. Do not add deploy SSH keys, SSH host
keys, PostgreSQL passwords, tenant signing keys, internal bearers, or generated roots
to GitHub manually; they belong in encrypted Pulumi state.

## GitHub Environment variables

| Variable | Meaning |
| --- | --- |
| `PULUMI_STATE_S3_BUCKET` | Private state bucket name |
| `PULUMI_STATE_S3_REGION` | State signing region; currently `hel1` |
| `PULUMI_STACK` | Exact target stack: `organization/aven-platform/identity`, `/next`, or `/production` |
| `HETZNER_LOCATION` | Server and volume location |
| `HETZNER_SERVER_TYPE` | Default amd64 server type |
| `IDENTITY_SERVER_TYPE` | Optional identity override |
| `PLATFORM_SERVER_TYPE` | Optional platform override |
| `HETZNER_OS_IMAGE` | Supported Ubuntu image; currently `ubuntu-24.04` |
| `IDENTITY_VOLUME_SIZE_GB` | Identity data volume; at least 30 GiB |
| `PLATFORM_VOLUME_SIZE_GB` | Platform data volume; at least 40 GiB |
| `SSH_ALLOWED_CIDRS` | Comma-separated office or VPN networks allowed to SSH |
| `POLAR_SERVER` | `sandbox` in `next`; `production` in production |
| `POLAR_ORGANIZATION_ID` | Polar organization UUID |
| `SMTP_FROM` | Visible sender address |
| `SMTP_REPLY_TO` | Optional monitored reply address |
| `DOWNLOAD_URL` | Client download target in checkout mail and UI |
| `ACME_EMAIL` | Monitored certificate contact |
| `ANDROID_APP_CERT_SHA256_FINGERPRINTS` | Production Android signing certificates; empty for initial `next` if none |
| `LLM_GATEWAY_MODELS_JSON` | Public provider-neutral model catalog without credentials |
| `LLM_GATEWAY_TIMEOUT_SECONDS` | Optional bounded provider timeout |
| `BACKUP_REPOSITORY_BASE` | Private Restic base; deployment appends `/identity` or `/<environment>/platform` |
| `BACKUP_S3_REGION` | S3 signing region for the backup endpoint |

The `identity` Environment also defines:

| Variable | Meaning |
| --- | --- |
| `NEXT_PULUMI_STACK` | Exact stack: `organization/aven-platform/next` |
| `NEXT_PULUMI_BACKEND` | Read-only backend URL using the `next` state bucket |
| `PRODUCTION_PULUMI_STACK` | Exact stack: `organization/aven-platform/production` |
| `PRODUCTION_PULUMI_BACKEND` | Read-only backend URL using the production state bucket |

The infrastructure workflow rejects an Environment whose stack name does not end in
its exact target. The deployment script derives domains, static-site branches,
identity credential selection, and backup labels from the selected target; these are
not operator-entered variables.

The infrastructure workflow also rejects an empty SSH allowlist, non-amd64 images,
undersized volumes, and invalid CIDRs.

## Recovery escrow

Copy these bootstrap values into the offline company recovery record for each target:

- its Pulumi state access key and secret;
- its `PULUMI_CONFIG_PASSPHRASE`;
- its backup object-store access key and secret; and
- its `BACKUP_RESTIC_PASSWORD`.

The identity GitHub Environment references the read-only variants of the two platform
state credentials during deployment. Keep the authoritative backend credential and
passphrase with each target's recovery record; do not create drifting copies in the
handbook.

The record must outlive GitHub, individual laptops, and both servers. Quarterly, a
second authorized person should prove they can locate it without copying values into
chat, a ticket, shell history, or this handbook.

## Generated access roles

Each host receives separate Pulumi-generated Ed25519 identities:

- deploy: invokes only the fixed deploy or fresh-target restore wrapper;
- observe: reads fixed-scope Compose status, recent logs, disk, and backup state;
- tunnel: forwards only to `127.0.0.1:5432`; and
- host: pins the server identity without `ssh-keyscan` or interactive trust.

Tools retrieve these keys from encrypted state into a temporary mode-`0600` directory
and remove them on exit. The database tunnel is transport only. SQL inspection also
requires a separately issued, time-bounded, read-only database role; automatic
diagnostic-role issuance is not implemented yet.

## Rotation

- Rotate a provider secret in the owning GitHub Environment, then deploy the same
  verified ref.
- Rotate generated infrastructure material through Pulumi, review replacements, and
  redeploy. Do not edit host `.env` files.
- Rotate database function roots in stages so reconciliation proves new grants before
  old pools drain.
- Publish old and new mobile association fingerprints together before retiring the old
  certificate.

After any suspected disclosure, rotate the smallest affected credential and preserve
the incident timeline.
