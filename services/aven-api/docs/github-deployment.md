# GitHub deployment

Use protected GitHub Environments named `next` and `production`.

The complete secret inventory and Hetzner first-deployment checklist are in [`GITHUB_HETZNER_DEPLOYMENT_CHECKLIST.md`](../../../GITHUB_HETZNER_DEPLOYMENT_CHECKLIST.md).

Variables:

- `PULUMI_STACK`
- `PULUMI_STATE_S3_BUCKET`
- `PULUMI_STATE_S3_REGION`
- `HETZNER_LOCATION`
- `HETZNER_SERVER_TYPE`
- `HETZNER_SERVER_ARCHITECTURE`
- `HETZNER_OS_IMAGE`
- `HETZNER_VOLUME_SIZE_GB`
- `HETZNER_ENABLE_BACKUPS`
- `SSH_ALLOWED_CIDRS`
- `DEPLOY_SSH_PUBLIC_KEY`
- `PUBLIC_BASE_URL`
- `IDENTITY_DOMAIN`
- `WEBAUTHN_RP_ID`
- `DOWNLOAD_URL`
- `SMTP_FROM`
- `NAME_PRICE_EUR`
- `GHCR_USER`
- `DEPLOY_HOST`
- `DEPLOY_USER`
- `ARTIFACT_STORE_MAX_TENANT_POOLS` (optional; defaults to `64`)
- `ARTIFACT_STORE_CONNECTIONS_PER_TENANT` (optional; defaults to `2`)
- `ARTIFACT_STORE_MEMORY_LIMIT` (optional; defaults to `512m`)
- `ARTIFACT_STORE_MAX_UPLOAD_BYTES` (optional; defaults to `26214400`; also sets the
  SvelteKit adapter's streaming request-body ceiling; the production proxy admits that
  size only on the Artifact file-upload route and retains a 512 KiB ceiling elsewhere)
- `ARTIFACT_STORE_MAX_CONCURRENT_UPLOADS` (optional; defaults to `2`, maximum `64`)
- `ARTIFACT_STORE_MAX_LIVE_CLAIMS_PER_SCOPE` (optional; defaults to `32`)
- `ARTIFACT_STORE_MAX_STAGED_BYTES_PER_SCOPE` (optional; defaults to `104857600`)
- `ARTIFACT_STORE_MAX_LOGICAL_BYTES_PER_SCOPE` (optional; defaults to `1073741824`)

Secrets:

- `PULUMI_STATE_S3_ACCESS_KEY_ID`
- `PULUMI_STATE_S3_SECRET_ACCESS_KEY`
- `PULUMI_CONFIG_PASSPHRASE`
- `HETZNER_COMPUTE_TOKEN`
- `HETZNER_DNS_TOKEN`
- `BETTER_AUTH_SECRET`
- `EMAIL_QUEUE_ENCRYPTION_KEY`
- `POSTGRES_PASSWORD`
- `AVEN_MIGRATOR_PASSWORD`
- `AVEN_SERVER_PASSWORD`
- `AVEN_EMAIL_WORKER_PASSWORD`
- `AVEN_ENVIRONMENT_WORKER_PASSWORD`
- `AVEN_PROVISIONER_PASSWORD`
- `ARTIFACT_STORE_BEARER_TOKEN` (32–128 URL-safe letters, digits, `_`, or `-`)
- `ARTIFACT_STORE_PROVISIONER_BEARER_TOKEN` (same constraints; use a distinct value)
- `ARTIFACT_STORE_RUNTIME_PASSWORD` (32–128 URL-safe letters, digits, `_`, or `-`)
- `SMTP_URL`
- `CREEM_API_KEY`
- `CREEM_PRODUCT_ID`
- `CREEM_WEBHOOK_SECRET`
- `DEPLOY_SSH_KEY`
- `DEPLOY_KNOWN_HOSTS`
- `GHCR_READ_TOKEN`

`IDENTITY_DOMAIN` is the hostname from `PUBLIC_BASE_URL`, without a scheme or path. The deploy host must allow inbound TCP 80/443 and UDP 443.

Repository workflows use the private Hetzner Object Storage bucket as Pulumi's encrypted
DIY backend, apply the foundation, publish immutable Aven API and Artifact Store images,
and deploy both by digest. Deployment writes a mode-0600 environment file, runs the
central migrator, and starts the API, workers, Artifact Store runtime/provisioner, and
Caddy TLS ingress. The new environment worker queues an idempotent Artifact Store
installation for existing ready customer databases marked pending; new databases are
installed before readiness.
Customer database names and scopes stay in PostgreSQL; they are not GitHub Secrets.
