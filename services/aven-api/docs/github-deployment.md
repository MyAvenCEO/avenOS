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
- `SMTP_URL`
- `CREEM_API_KEY`
- `CREEM_PRODUCT_ID`
- `CREEM_WEBHOOK_SECRET`
- `DEPLOY_SSH_KEY`
- `DEPLOY_KNOWN_HOSTS`
- `GHCR_READ_TOKEN`

`IDENTITY_DOMAIN` is the hostname from `PUBLIC_BASE_URL`, without a scheme or path. The deploy host must allow inbound TCP 80/443 and UDP 443.

Repository workflows use the private Hetzner Object Storage bucket as Pulumi's encrypted DIY backend, apply the foundation, publish an immutable `sha-<commit>` image, and deploy by digest. Deployment writes a mode-0600 environment file, runs the one-shot migrator, starts the API, workers, and Caddy TLS ingress, and checks readiness. Customer environments stay in PostgreSQL; they are not GitHub Secrets.
