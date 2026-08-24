# GitHub and Hetzner deployment checklist

This is the complete bootstrap checklist for `id.next.aven.ceo`.

Status was last reconciled on 2026-08-21 against the successful infrastructure update, the first `release-next` run, the repository configuration, and live DNS/port checks. Checked items are directly evidenced; unchecked items still require manual completion or verification.

The Pulumi program in `infrastructure/identity` creates the Hetzner server, firewall, persistent volume, deployment public key, and `id.next` DNS records. Its encrypted state, locks, and checkpoint history live in a private Hetzner Object Storage bucket; Pulumi Cloud is not used. `.github/workflows/release-next.yml` applies that stack, publishes the immutable identity image, deploys it, migrates PostgreSQL, starts the services, and verifies the public endpoints.

The repository is public. Do not commit credentials, private keys, Pulumi stack files, state, resource IDs, IP addresses, or environment-specific configuration. Put secrets in GitHub Environment secrets and all environment-specific non-secret values in GitHub Environment variables. The workflows materialize the application `.env` only on the runner and target host.

## 1. Protected GitHub Environment

Create a GitHub Environment named `next` under **Settings → Environments**.

- Restrict deployments to the `next` branch.
- Leave required reviewers disabled if releases must deploy without approval.
- Add every secret and variable in sections 2 and 3 to this Environment.
- Do not expose Environment secrets to pull requests or forked workflows.
- Keep existing cross-channel app-signing secrets at their current scope.

Create a separate `production` Environment later. Never reuse `next` credentials for production.

## 2. `next` Environment secrets

Create every secret below with the exact name shown.

### Infrastructure and host access

| Secret | Purpose | Required source |
| --- | --- | --- |
| `PULUMI_STATE_S3_ACCESS_KEY_ID` | Authenticates Pulumi to the Hetzner state bucket | Access key from a dedicated Hetzner Object Storage credential pair |
| `PULUMI_STATE_S3_SECRET_ACCESS_KEY` | Signs state-bucket requests | Secret half of the same credential pair; Hetzner shows it only once |
| `PULUMI_CONFIG_PASSPHRASE` | Encrypts secret values within Pulumi state | Dedicated high-entropy value; generate with `openssl rand -base64 48` |
| `HETZNER_COMPUTE_TOKEN` | Manages the server, firewall, volume, and SSH public-key resource | Read/write token for the dedicated Hetzner Cloud project |
| `HETZNER_DNS_TOKEN` | Manages only the `id.next` A and AAAA record sets | Read/write token for the Hetzner project containing the `aven.ceo` zone |
| `DEPLOY_SSH_KEY` | Connects the runner to the provisioned host | Unencrypted OpenSSH private key dedicated to `next` |
| `DEPLOY_KNOWN_HOSTS` | Pins the provisioned host's SSH key | Verified `known_hosts` lines for the Pulumi `ipv4Address` output |
| `GHCR_READ_TOKEN` | Pulls the private application image on the host | Classic GitHub PAT for `GHCR_USER` with `read:packages`; authorize organization SSO if required |

Generate the deployment key outside the repository and without a passphrase because GitHub Actions cannot answer an interactive prompt:

```sh
ssh-keygen -t ed25519 -N '' -f ./aven-identity-next-deploy -C aven-identity-next-deploy
```

- Store the complete private file as `DEPLOY_SSH_KEY`.
- Store the one-line `.pub` file as the GitHub variable `DEPLOY_SSH_PUBLIC_KEY`.
- Do not add either generated file to the repository.
- Delete the local private-key copy after securely storing it.

`DEPLOY_KNOWN_HOSTS` cannot be created until the first Pulumi update creates the host. Section 7 covers that one-time trust bootstrap.

### Application and database

| Secret | Purpose | Required format/source |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | Signs and encrypts Better Auth state | At least 32 random characters; `openssl rand -base64 48` |
| `EMAIL_QUEUE_ENCRYPTION_KEY` | Encrypts queued email payloads | Base64 encoding of exactly 32 random bytes; `openssl rand -base64 32` |
| `POSTGRES_PASSWORD` | PostgreSQL bootstrap superuser | Distinct `openssl rand -hex 32` value |
| `AVEN_MIGRATOR_PASSWORD` | DDL-capable migration role | Distinct `openssl rand -hex 32` value |
| `AVEN_SERVER_PASSWORD` | API runtime database role | Distinct `openssl rand -hex 32` value |
| `AVEN_EMAIL_WORKER_PASSWORD` | Email queue worker database role | Distinct `openssl rand -hex 32` value |
| `AVEN_ENVIRONMENT_WORKER_PASSWORD` | Customer-environment queue role | Distinct `openssl rand -hex 32` value |
| `AVEN_PROVISIONER_PASSWORD` | Creates customer databases and roles | Distinct `openssl rand -hex 32` value |
| `ARTIFACT_STORE_BEARER_TOKEN` | API-to-Artifact-Store service credential | 32–128 URL-safe characters; unique |
| `ARTIFACT_STORE_PROVISIONER_BEARER_TOKEN` | Environment-worker-to-Store-provisioner credential | 32–128 URL-safe characters; unique |
| `ARTIFACT_STORE_RUNTIME_PASSWORD` | Restricted Store database role | 32–128 URL-safe characters; unique |
| `ARTIFACT_PROCESSOR_BEARER_TOKEN` | API-to-Processor status credential | 32–128 URL-safe characters; unique |
| `ARTIFACT_PROCESSOR_DIRECTORY_BEARER_TOKEN` | Processor-to-API tenant-directory credential | 32–128 URL-safe characters; unique |
| `ARTIFACT_PROCESSOR_PROVISIONER_BEARER_TOKEN` | Environment-worker-to-Processor-provisioner credential | 32–128 URL-safe characters; unique |
| `ARTIFACT_PROCESSOR_RUNTIME_PASSWORD` | Restricted Processor database role | 32–128 URL-safe characters; unique |
| `ARTIFACT_PROCESSOR_VISION_API_KEY` | Authenticates the Processor to the configured OpenAI-compatible vision endpoint | Required only in `bearer` auth mode; 20–512 non-whitespace characters; dedicated to `next` |
| `INTENT_SERVICE_BEARER_TOKEN` | API-to-Intent-Service credential | 32–128 URL-safe characters; unique |
| `INTENT_SERVICE_DIRECTORY_BEARER_TOKEN` | Intent-Service-to-API tenant directory | 32–128 URL-safe characters; unique |
| `INTENT_SERVICE_PROVISIONER_BEARER_TOKEN` | Environment-worker-to-Intent-provisioner | 32–128 URL-safe characters; unique |
| `INTENT_SERVICE_RUNTIME_PASSWORD` | Restricted Intent Service database role | 32–128 URL-safe characters; unique |
| `INTENT_SERVICE_PROCESSOR_BEARER_TOKEN` | Intent-Service-to-Processor read API | 32–128 URL-safe characters; unique |
| `SMTP_URL` | SMTP transport used by the email worker | Full URL such as `smtps://USER:PASSWORD@HOST:465`; URL-encode credentials |
| `CREEM_API_KEY` | Creates Creem checkout sessions | `next` test key |
| `CREEM_PRODUCT_ID` | Product used for name checkout | Product ID from the same Creem environment as the API key |
| `CREEM_WEBHOOK_SECRET` | Verifies Creem webhook signatures | Signing secret for the configured endpoint |

Do not reuse database passwords. Hex values avoid URL and shell encoding ambiguity.

## 3. `next` Environment variables

These values are not credentials, but they are deployment configuration and belong in GitHub rather than committed stack files or `.env` files.

### Infrastructure

| Variable | Example for `next` | Requirement |
| --- | --- | --- |
| `PULUMI_STACK` | `organization/aven-identity/next` | DIY backends require the literal organization name `organization`; project must match `Pulumi.yaml` |
| `PULUMI_STATE_S3_BUCKET` | Globally unique private bucket name | Existing protected bucket dedicated to Pulumi state; the workflow does not create it |
| `PULUMI_STATE_S3_REGION` | `hel1` | Existing bucket location; builds `hel1.your-objectstorage.com` |
| `HETZNER_LOCATION` | `nbg1` | Location supporting the selected server type and volume |
| `HETZNER_SERVER_TYPE` | `cx23` | Hetzner server type available in the selected location |
| `HETZNER_SERVER_ARCHITECTURE` | `amd64` | Must remain `amd64` for the currently published image |
| `HETZNER_OS_IMAGE` | `ubuntu-24.04` | Supported Hetzner Ubuntu image name |
| `HETZNER_VOLUME_SIZE_GB` | `40` | Integer of at least `30`; increasing is safe, shrinking is not |
| `HETZNER_ENABLE_BACKUPS` | `true` | `true` or `false`; server backups do not replace database backups for the attached volume |
| `SSH_ALLOWED_CIDRS` | `0.0.0.0/0,::/0` | Comma-separated SSH source CIDRs; see the warning below |
| `DEPLOY_SSH_PUBLIC_KEY` | `ssh-ed25519 …` | Public half of `DEPLOY_SSH_KEY`, on one line |

GitHub-hosted runner egress addresses are dynamic. For unattended deployment from GitHub-hosted runners, use `0.0.0.0/0,::/0`; the stack then enforces key-only login, disables root/password login, and enables fail2ban. If broad SSH reachability is unacceptable, use a self-hosted runner with fixed egress and set only that runner's `/32` and `/128` CIDRs.

### Application

| Variable | Example for `next` | Requirement |
| --- | --- | --- |
| `PUBLIC_BASE_URL` | `https://id.next.aven.ceo` | Exact HTTPS origin; no trailing slash or path |
| `IDENTITY_DOMAIN` | `id.next.aven.ceo` | Hostname only |
| `WEBAUTHN_RP_ID` | `id.next.aven.ceo` | Must equal `IDENTITY_DOMAIN` |
| `DOWNLOAD_URL` | `https://github.com/MyAvenCEO/avenOS/releases` | Public download destination |
| `SMTP_FROM` | `Aven <no-reply@aven.ceo>` | Sender accepted by the SMTP provider |
| `NAME_PRICE_EUR` | `25` | Positive numeric checkout price |
| `GHCR_USER` | GitHub account name | Owner of `GHCR_READ_TOKEN` |
| `DEPLOY_HOST` | Pulumi `ipv4Address` output | Used by the manual operations workflow after bootstrap |
| `DEPLOY_USER` | `aven-deploy` | Used by the manual operations workflow after bootstrap |
| `ARTIFACT_PROCESSOR_MAX_TENANT_POOLS` | `64` | Optional bounded database-pool cache; defaults to `64` |
| `ARTIFACT_PROCESSOR_CONNECTIONS_PER_TENANT` | `2` | Optional per-customer SQL pool size; defaults to `2` |
| `ARTIFACT_PROCESSOR_TENANT_REFRESH_SECONDS` | `30` | Optional directory refresh and suspension convergence interval |
| `ARTIFACT_PROCESSOR_MEMORY_LIMIT` | `768m` | Optional Compose memory limit; must use `m` or `g` suffix |
| `ARTIFACT_PROCESSOR_VISION_ENABLED` | `true` | Required for the finance-processing rollout on `next` |
| `ARTIFACT_PROCESSOR_VISION_BASE_URL` | `https://api.openai.com/v1` | HTTPS OpenAI-compatible base URL; no query, fragment, or embedded credentials |
| `ARTIFACT_PROCESSOR_VISION_MODEL` | Provider deployment name | Exact vision-capable model/deployment identifier, for example OpenAI's `gpt-4.1` |
| `ARTIFACT_PROCESSOR_VISION_PROFILE` | `openai-json-schema` | One of `openai-tools`, `openai-json-schema`, `qwen-tools`, or `generic-json`; must match the endpoint's input/output template |
| `ARTIFACT_PROCESSOR_VISION_AUTH_MODE` | `bearer` | `bearer` for an API key or `none` for an authentication-free open-model endpoint |
| `ARTIFACT_PROCESSOR_VISION_MAX_PAGES` | `15` | Optional paid-stage page ceiling, from `1` through `63`; defaults to `15` |
| `ARTIFACT_PROCESSOR_VISION_TIMEOUT_SECONDS` | `180` | Optional per-call timeout, from `5` through `900`; defaults to `180` |
| `INTENT_SERVICE_MAX_TENANT_POOLS` | `64` | Optional bounded customer pool cache |
| `INTENT_SERVICE_CONNECTIONS_PER_TENANT` | `2` | Optional per-customer SQL pool size |
| `INTENT_SERVICE_TENANT_REFRESH_SECONDS` | `30` | Directory refresh and suspension convergence interval |
| `INTENT_SERVICE_MEMORY_LIMIT` | `512m` | Compose memory limit |

The vision endpoint receives rendered customer document pages and extracted text. Do
not enable it until the provider project, processing region, retention settings, access
policy, and data-processing terms are approved for `next` customer data.

The release workflow obtains its deployment host and user directly from Pulumi outputs. `DEPLOY_HOST` and `DEPLOY_USER` remain GitHub variables only because `.github/workflows/aven-api-operations.yml` is intentionally independent of an infrastructure update.

The application deployment stops unless:

```text
PUBLIC_BASE_URL = https://IDENTITY_DOMAIN
WEBAUTHN_RP_ID = IDENTITY_DOMAIN
```

## 4. Existing release secrets

The complete `release-next` workflow also requires existing repository/app release credentials:

- `DEPLOY_KEY` — writable repository deploy key allowed to bypass the protected `next` branch for release commits and tags.
- `APPLE_CERTS_P12_BASE64`
- `APPLE_CERTS_P12_PASSWORD`
- `MACOS_PROVISIONPROFILE_BASE64`
- `IOS_MOBILEPROVISION_BASE64`
- `APPLE_API_KEY_P8_BASE64`
- `APPLE_API_KEY`
- `APPLE_API_ISSUER`
- `APPLE_DEVELOPMENT_TEAM`
- `APPLE_SIGNING_IDENTITY`
- `AVEN_PKG_INSTALLER_IDENTITY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

`GITHUB_TOKEN` is supplied automatically by GitHub. Do not create it manually.

## 5. External accounts and projects

Complete these before the first infrastructure update:

- [ ] Create a dedicated Hetzner project for Pulumi state, or enforce a bucket policy that grants the CI S3 key access only to the state bucket. By default, a Hetzner S3 key can access every bucket in its project.
- [x] Confirm the existing **private** Object Storage bucket is in Helsinki (`hel1`) and its name is stored as `PULUMI_STATE_S3_BUCKET`.
- [ ] Enable bucket deletion protection in Hetzner Console.
- [ ] Enable bucket versioning. Do not enable Object Lock: Pulumi must update checkpoints and delete its temporary lock objects.
- [ ] Do not apply a lifecycle rule that expires current `.pulumi` objects. Retaining noncurrent versions for at least 90 days is recommended.
- [ ] Generate a dedicated S3 credential pair with read, write, list, version-read, and delete access to this bucket. Store it only as `PULUMI_STATE_S3_ACCESS_KEY_ID` and `PULUMI_STATE_S3_SECRET_ACCESS_KEY` in GitHub.
- [x] Generate and store `PULUMI_CONFIG_PASSPHRASE`. Losing it makes encrypted provider values in the state unusable; rotating it requires an explicit Pulumi secrets-provider migration.
- [x] Create or select a dedicated Hetzner Cloud project with billing enabled.
- [x] Confirm the `aven.ceo` zone is managed through the Hetzner API used by `HETZNER_DNS_TOKEN`.
- [ ] Create scoped Hetzner compute and DNS tokens and store them only in GitHub.
- [x] Set `PULUMI_STACK` to `organization/aven-identity/next`. No Pulumi account or access token is required.
- [x] Confirm no retained `id.next` A or AAAA record conflicts with the new stack. Remove a disposable old record before `up`; importing an existing record is a separate deliberate operation.
- [x] Confirm the old host can remain untouched. This stack neither imports nor deletes it.

With the S3 credentials loaded into a secure local shell, verify the bucket and enable versioning before adding the credentials to GitHub:

```sh
aws --endpoint-url "https://${AWS_REGION}.your-objectstorage.com" \
  s3api head-bucket --bucket "$PULUMI_STATE_S3_BUCKET"
aws --endpoint-url "https://${AWS_REGION}.your-objectstorage.com" \
  s3api put-bucket-versioning --bucket "$PULUMI_STATE_S3_BUCKET" \
  --versioning-configuration Status=Enabled
aws --endpoint-url "https://${AWS_REGION}.your-objectstorage.com" \
  s3api get-bucket-versioning --bucket "$PULUMI_STATE_S3_BUCKET"
```

These commands expect `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, and `PULUMI_STATE_S3_BUCKET` to already be set in that shell. Do not paste credentials into the command line or shell history.

References: [Pulumi DIY S3 backends](https://www.pulumi.com/docs/iac/concepts/state-and-backends/), [Hetzner S3 credentials](https://docs.hetzner.com/storage/object-storage/getting-started/generating-s3-keys/), [Hetzner bucket creation](https://docs.hetzner.com/storage/object-storage/getting-started/creating-a-bucket/), and [Hetzner object versioning](https://docs.hetzner.com/storage/object-storage/howto-protect-objects/protect-versioning/).

No server preparation is manual. Pulumi and cloud-init install Docker Compose, configure the deployment account, harden SSH, configure UFW/fail2ban, attach and mount the volume, and create persistent directories.

## 6. Repository and package access

- [x] Allow GitHub Actions in the repository.
- [ ] Enable GitHub secret scanning and push protection under **Settings → Security → Code security**.
- [x] Allow the workflow's explicit `contents: write` and `packages: write` permissions under repository/organization policy.
- [x] Confirm the repository may publish `ghcr.io/myavenceo/aven-api`.
- [x] If that package already exists, grant this repository write access.
- [x] Grant `GHCR_USER` and `GHCR_READ_TOKEN` read access to the package.
- [x] Authorize the package PAT for organization SSO if required.
- [x] Install the public half of `DEPLOY_KEY` as a writable repository deploy key and permit it as a `next` ruleset bypass actor.
- [x] Confirm Actions may create GitHub prereleases and upload release assets.

The first registry-login failure was resolved by setting `GHCR_USER`; the subsequent login and immutable image pull succeeded.

## 7. One-time infrastructure and SSH trust bootstrap

Do this once before the first `release-next` run:

1. [ ] Complete the remaining state-bucket protection checks in section 5.
2. [ ] Add and verify every secret and variable from sections 2 and 3, except `DEPLOY_KNOWN_HOSTS` and `DEPLOY_HOST`.
3. [x] Run **Actions → identity-infrastructure → Run workflow → up** from a trusted branch/workflow revision.
4. [x] Confirm the state bucket now contains stack state and history below `avenos/identity/.pulumi/`. Lock objects exist only while an update is active. Do not download or commit any of them.
5. [x] Confirm the update creates only the expected server, firewall, volume, attachment, SSH public key, and two DNS record sets.
6. [x] Copy the `ipv4Address` stack output from the GitHub job summary. Do not commit it.
7. [x] Capture the host keys for that exact IP. SSH is reachable and currently returns an Ed25519 host key:

   ```sh
   ssh-keyscan -H THE_PULUMI_IPV4_ADDRESS > ./aven-identity-next-known-hosts
   ssh-keygen -lf ./aven-identity-next-known-hosts
   ```

8. [ ] Independently verify the fingerprint through the Hetzner console before trusting it. `ssh-keyscan` alone does not authenticate the host.
9. [x] Store the complete verified file as `DEPLOY_KNOWN_HOSTS` in the `next` Environment.
10. [ ] Store the Pulumi IPv4 output as GitHub variable `DEPLOY_HOST` and `aven-deploy` as `DEPLOY_USER` for the operations workflow.
11. [ ] Delete the local `known_hosts` file.
12. [x] Confirm key-only access and cloud-init completion:

    ```sh
    ssh -i ./aven-identity-next-deploy aven-deploy@THE_PULUMI_IPV4_ADDRESS \
      'test -f /var/lib/aven/cloud-init-complete && sudo -n docker info >/dev/null'
    ```

If the local private key was already deleted, perform the last check from an approved secure machine or skip it and let the first deployment make the same check.

The workflow logs into the S3-compatible backend at `s3://<bucket>/avenos/identity` using the location endpoint in `PULUMI_STATE_S3_REGION`. Pulumi stores project-scoped state, checkpoint history, and lock objects below that prefix. Secret fields are encrypted with `PULUMI_CONFIG_PASSPHRASE`; the bucket itself must also remain private. `Pulumi.<stack>.yaml`, `.pulumi/`, exported state, backend credentials, and the passphrase must never be committed.

## 8. SMTP and Creem

- [x] Create the SMTP account and store its URL in `SMTP_URL`.
- [ ] Authorize `SMTP_FROM` and configure SPF and DKIM.
- [ ] Confirm the Hetzner host may reach the SMTP endpoint and port.
- [ ] Create a Creem test product matching `NAME_PRICE_EUR`.
- [x] Store non-empty Creem API key and product ID values in GitHub.
- [ ] Configure `https://id.next.aven.ceo/api/webhooks/creem` for the checkout-completion, refund, and dispute events consumed by the API.
- [x] Store that endpoint's signing secret in `CREEM_WEBHOOK_SECRET`.
- [ ] Confirm Creem preserves the checkout metadata and customer email used by the grant transaction.

## 9. DNS, TLS, passkeys, and app association

- [x] Confirm Pulumi outputs `identityHostname=id.next.aven.ceo` and the public IP addresses.
- [x] Wait for the Pulumi-managed A and AAAA records to resolve publicly.
- [x] Confirm inbound TCP 80/443 and UDP 443 reach the new host so Caddy can obtain a certificate.
- [x] Keep `PUBLIC_BASE_URL`, `IDENTITY_DOMAIN`, and `WEBAUTHN_RP_ID` aligned.
- [x] Keep `webcredentials:id.next.aven.ceo` in the macOS and iOS entitlements.
- [ ] Confirm the signed application identifier is `2P6VCHVJWB.ceo.aven.os`.
- [x] Verify the association endpoint returns that identifier without an HTTPS redirect.
- [ ] Complete the passkey/PRF test in a signed TestFlight build on physical hardware.

## 10. Persistent database state

The attached Hetzner volume is mounted at `/var/lib/aven`. PostgreSQL and Caddy bind-mount their persistent data from it. The database bootstrap creates runtime roles only when PostgreSQL initializes an empty data directory.

- [ ] Confirm `/var/lib/aven` is mounted and the cloud-init marker exists.
- [x] Confirm the first application deployment initializes a new `/var/lib/aven/postgres` directory.
- [x] Do not reuse a partially initialized database directory with different GitHub passwords.
- [x] Confirm the volume has delete protection in Hetzner and `protect` in Pulumi.
- [ ] Before retaining customer data, implement encrypted database backups outside this volume and rehearse restore. Hetzner server backups do not replace PostgreSQL backups of the attached volume.

Each paid customer receives a database and a `NOLOGIN` owner role in this cluster. Later per-customer application stacks are intentionally outside this foundation.

## 11. First autonomous release

- [ ] Complete sections 1–10.
- [x] Push the cutover revision to `next`.
- [x] Confirm `identity-validate` passes API/infrastructure checks, migrations, build, and image validation.
- [x] Confirm `release` creates the version commit, tag, and prerelease.
- [x] Confirm `publish-identity-image` publishes an immutable digest.
- [x] Confirm `deploy-identity-infrastructure-next` reports no unexpected replacement or deletion and completes.
- [x] Confirm `deploy-identity-next` waits for cloud-init, migrates PostgreSQL, starts the API/workers/Caddy, and completes.
- [x] Confirm all public checks pass:
  - `https://id.next.aven.ceo/api/health/live`
  - `https://id.next.aven.ceo/api/health/ready`
  - `https://id.next.aven.ceo/api/health/status`
  - `https://id.next.aven.ceo/api/meta`
  - `https://id.next.aven.ceo/.well-known/apple-app-site-association`
- [ ] Confirm the macOS, iOS, and Linux release jobs retain their existing credentials and finish.
- [ ] Run `aven-api-operations` with `target=next`, `operation=reconcile`.
- [ ] Complete a test checkout, receive the email, use `Login` before enrollment, create the passkey, verify the email link is then rejected, and confirm the dashboard shows only `Download AvenOS`.
- [ ] Confirm the environment worker is `ready` and created exactly one `cust_*` database for the purchased name.
- [ ] Add the four distinct `ARTIFACT_PROCESSOR_*` secrets listed in section 2.
- [ ] Add the five distinct `INTENT_SERVICE_*` secrets listed in section 2.
- [ ] Confirm `/api/health/status` reports `artifactProcessing=available`.
- [ ] Upload a test file and confirm its authenticated processing endpoint reaches a terminal or explicitly warned presentation.
- [ ] Confirm `https://id.next.aven.ceo/internal/v1/artifact-processing/tenants` returns 404.
- [ ] Confirm `/opt/aven-api/previous` contains the pre-rollout immutable image/Compose snapshot before accepting the rollout.

After this bootstrap, ordinary `next` releases apply infrastructure changes and application releases without manual host preparation. Pulumi protections intentionally stop unattended replacement or deletion of the server and data volume; such destructive infrastructure changes require a separate reviewed operation.

## 12. Still outside this automation

- PostgreSQL backup scheduling, off-host storage, retention, and restore rehearsal.
- Independent backup/restore rehearsal and availability monitoring for the Pulumi state bucket beyond its enabled object versioning.
- Rotation and emergency revocation procedures for GitHub Environment secrets.
- Customer application/Pulumi provisioning beyond the reserved database and stack name.
- Production `id.aven.ceo` infrastructure, credentials, DNS, Creem product, SMTP configuration, and approval policy.
- Deliberate retirement of the former host after the new foundation is verified.
