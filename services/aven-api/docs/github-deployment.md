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
- `ARTIFACT_PROCESSOR_MAX_TENANT_POOLS` (optional; defaults to `64`)
- `ARTIFACT_PROCESSOR_CONNECTIONS_PER_TENANT` (optional; defaults to `2`)
- `ARTIFACT_PROCESSOR_TENANT_REFRESH_SECONDS` (optional; defaults to `30`)
- `ARTIFACT_PROCESSOR_MEMORY_LIMIT` (optional; defaults to `768m`)
- `ARTIFACT_PROCESSOR_VISION_ENABLED` (required as `true` for the `next` finance rollout)
- `ARTIFACT_PROCESSOR_VISION_BASE_URL` (required HTTPS OpenAI-compatible base URL)
- `ARTIFACT_PROCESSOR_VISION_MODEL` (required exact vision-capable model/deployment name)
- `ARTIFACT_PROCESSOR_VISION_PROFILE` (required; `openai-tools`, `openai-json-schema`,
  `qwen-tools`, or `generic-json`)
- `ARTIFACT_PROCESSOR_VISION_AUTH_MODE` (required; `bearer` or `none`)
- `ARTIFACT_PROCESSOR_VISION_MAX_PAGES` (optional; defaults to `15`, maximum `63`)
- `ARTIFACT_PROCESSOR_VISION_TIMEOUT_SECONDS` (optional; defaults to `180`, maximum `900`)
- `LLM_GATEWAY_ENABLED` (optional; defaults to `false`)
- `LLM_GATEWAY_MODELS_JSON` (required compact JSON array when the generic gateway is enabled)
- `LLM_GATEWAY_TIMEOUT_SECONDS` (optional; defaults to `180`, maximum `900`)
- `LLM_GATEWAY_ALLOW_INSECURE_HTTP` (must remain `false` in hosted environments)
- `INTENT_SERVICE_MAX_TENANT_POOLS` (optional; defaults to `64`)
- `INTENT_SERVICE_CONNECTIONS_PER_TENANT` (optional; defaults to `2`)
- `INTENT_SERVICE_TENANT_REFRESH_SECONDS` (optional; defaults to `30`)
- `INTENT_SERVICE_MEMORY_LIMIT` (optional; defaults to `512m`)

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
- `ARTIFACT_PROCESSOR_BEARER_TOKEN` (API-to-Processor status credential; same format)
- `ARTIFACT_PROCESSOR_DIRECTORY_BEARER_TOKEN` (Processor-to-API tenant-directory credential)
- `ARTIFACT_PROCESSOR_PROVISIONER_BEARER_TOKEN` (environment-worker-to-provisioner credential)
- `ARTIFACT_PROCESSOR_RUNTIME_PASSWORD` (password for the restricted shared Processor DB role)
- `ARTIFACT_PROCESSOR_VISION_API_KEY` (required in `bearer` mode; 20–512 non-whitespace characters; omit in `none` mode)
- `LLM_GATEWAY_CREDENTIALS_JSON` (compact JSON object mapping catalog credential IDs to provider secrets)
- `INTENT_SERVICE_BEARER_TOKEN` (API-to-Intent-Service credential; 32–128 URL-safe characters)
- `INTENT_SERVICE_DIRECTORY_BEARER_TOKEN` (Intent-Service-to-API directory credential)
- `INTENT_SERVICE_PROVISIONER_BEARER_TOKEN` (environment-worker-to-provisioner credential)
- `INTENT_SERVICE_RUNTIME_PASSWORD` (restricted Intent Service database role)
- `INTENT_SERVICE_PROCESSOR_BEARER_TOKEN` (dedicated Intent-Service-to-Processor read credential)
- `SMTP_URL`
- `POLAR_API_KEY`
- `POLAR_WEBHOOK_SECRET`
- `DEPLOY_SSH_KEY`
- `DEPLOY_KNOWN_HOSTS`
- `GHCR_READ_TOKEN`

`IDENTITY_DOMAIN` is the hostname from `PUBLIC_BASE_URL`, without a scheme or path. The deploy host must allow inbound TCP 80/443 and UDP 443.

Repository workflows use the private Hetzner Object Storage bucket as Pulumi's encrypted
DIY backend, apply the foundation, publish immutable Aven API, Artifact Store, and Intent
Service images, and deploy all three by digest. The Artifact Store image also contains
the Processor binary. Deployment writes a mode-0600 environment file, runs the central
migrator, and starts the API, workers, Store, Processor, and Intent Service
runtimes/provisioners plus Caddy TLS ingress. The environment worker queues idempotent,
independent Store, Processor, and Intent Service installations for existing customer
databases; new databases receive all three before readiness. Processor and Intent
Service tenant discovery use authenticated Compose-network-only APIs; Caddy returns 404
for every `/internal/*` request.
Customer database names and scopes stay in PostgreSQL; they are not GitHub Secrets.

## First Processor and Intent Service rollout to `next`

The Intent Service rollout additionally requires five independently generated secrets:

```sh
for name in \
  INTENT_SERVICE_BEARER_TOKEN \
  INTENT_SERVICE_DIRECTORY_BEARER_TOKEN \
  INTENT_SERVICE_PROVISIONER_BEARER_TOKEN \
  INTENT_SERVICE_RUNTIME_PASSWORD \
  INTENT_SERVICE_PROCESSOR_BEARER_TOKEN
do
  value="$(openssl rand -hex 32)"
  gh secret set "$name" --env next --body "$value"
done

gh variable set INTENT_SERVICE_MAX_TENANT_POOLS --env next --body 64
gh variable set INTENT_SERVICE_CONNECTIONS_PER_TENANT --env next --body 2
gh variable set INTENT_SERVICE_TENANT_REFRESH_SECONDS --env next --body 30
gh variable set INTENT_SERVICE_MEMORY_LIMIT --env next --body 512m
```

Generate four independent credentials locally without printing or committing them:

```sh
for name in \
  ARTIFACT_PROCESSOR_BEARER_TOKEN \
  ARTIFACT_PROCESSOR_DIRECTORY_BEARER_TOKEN \
  ARTIFACT_PROCESSOR_PROVISIONER_BEARER_TOKEN \
  ARTIFACT_PROCESSOR_RUNTIME_PASSWORD
do
  value="$(openssl rand -hex 32)"
  gh secret set "$name" --env next --body "$value"
done
```

This requires an authenticated GitHub CLI with permission to manage Environment
secrets. Generate each value separately; do not reuse Artifact Store credentials. The
workflow checks the character set, length, and distinctness before it copies anything
to the host.

The four Processor variables may be omitted to use the reviewed defaults. To make the
configuration explicit:

```sh
gh variable set ARTIFACT_PROCESSOR_MAX_TENANT_POOLS --env next --body 64
gh variable set ARTIFACT_PROCESSOR_CONNECTIONS_PER_TENANT --env next --body 2
gh variable set ARTIFACT_PROCESSOR_TENANT_REFRESH_SECONDS --env next --body 30
gh variable set ARTIFACT_PROCESSOR_MEMORY_LIMIT --env next --body 768m
```

Configure the model adapter before promoting to `next`:

```sh
gh secret set ARTIFACT_PROCESSOR_VISION_API_KEY --env next
gh variable set ARTIFACT_PROCESSOR_VISION_ENABLED --env next --body true
gh variable set ARTIFACT_PROCESSOR_VISION_BASE_URL --env next --body https://api.openai.com/v1
gh variable set ARTIFACT_PROCESSOR_VISION_MODEL --env next --body gpt-4.1
gh variable set ARTIFACT_PROCESSOR_VISION_PROFILE --env next --body openai-json-schema
gh variable set ARTIFACT_PROCESSOR_VISION_AUTH_MODE --env next --body bearer
gh variable set ARTIFACT_PROCESSOR_VISION_MAX_PAGES --env next --body 15
gh variable set ARTIFACT_PROCESSOR_VISION_TIMEOUT_SECONDS --env next --body 180
```

`gh secret set` reads the key without putting it in shell history when `--body` is
omitted. OpenAI's public model is named `gpt-4.1` (not `o4.1`); a compatible third-party
endpoint may expose a different deployment name, so use its exact identifier. Use
`openai-tools` for strict function-call responses,
`openai-json-schema` for strict JSON-schema content, `qwen-tools` for Qwen-compatible
tool calls that accept `temperature: 0`, and `generic-json` only for endpoints that
support JSON-object mode but not strict schemas.

Enabling this adapter sends rendered document pages and extracted text to that endpoint.
Before setting `ARTIFACT_PROCESSOR_VISION_ENABLED=true`, approve the provider account,
region, data-retention settings, access policy, and contractual data-processing terms.
The deployment key should belong to a dedicated least-privilege provider project.

The generic authenticated LLM catalog is configured separately. Store a compact catalog
in a GitHub Environment variable and its credential map as a secret:

```sh
gh variable set LLM_GATEWAY_ENABLED --env next --body true
gh variable set LLM_GATEWAY_MODELS_JSON --env next --body "$(jq -c . llm-models.json)"
gh secret set LLM_GATEWAY_CREDENTIALS_JSON --env next
gh variable set LLM_GATEWAY_TIMEOUT_SECONDS --env next --body 180
gh variable set LLM_GATEWAY_ALLOW_INSECURE_HTTP --env next --body false
```

The secret command reads the compact credential JSON from standard input when `--body`
is omitted. See the [generic LLM gateway guide](../../../docs/llm-gateway.md) for the
catalog schema, capability matching, Tauri cutover, security boundary, and smoke test.

After the PR lands on `main`, promote the exact reviewed commit through the repository's
normal `main` → `next` release path. The workflow rejects missing or unsafe model
configuration before it copies deployment files to the host.

The repository still has a historical `dev` branch, but no deployment workflow or
GitHub Environment is attached to it. Pushing there will not install this stack. The
live staging target is the protected `next` Environment and the `next` branch.

The successful deployment contract is:

- `/api/health/status` reports `overall=healthy` and
  `capabilities.artifactProcessing=available`;
- existing owned environments converge to Artifact Store schema version `3` and
  Processor schema version `5` and Intent Service schema version `1`;
- the provisioner and directory endpoints are unreachable through public Caddy;
- a new upload eventually has a processing status at
  `/api/artifacts/{artifactId}/processing`; and
- a supported PDF/PNG/JPEG of at most the configured page limit proceeds through page
  OCR, document classification, grounded invoice or account-statement extraction, and
  deterministic validation; and
- suspending an environment removes it from discovery and revokes both Store and
  Processor and Intent Service database connections.

Before overwriting a live deployment, the workflow saves the previous `.env` (including
its immutable image digests), three Compose files, and Caddyfile under root-owned
`/opt/aven-api/previous`. Every rollout feeds the newly installed Caddyfile to the
running Caddy admin API over stdin. This makes configuration changes effective without
TLS listener downtime and avoids stale file-bind mounts. If the rollout fails after
migration, restore that exact runtime set on the host:

```sh
sudo /opt/aven-api/deploy/rollback-previous.sh
```

The rollback removes newly introduced orphan services, restores and reloads the previous
Caddyfile, and restores the previous Processor's access to its empty prototype intent
schema. It deliberately does not reverse central or customer schema migrations; the old
code otherwise ignores the forward additions. Investigate and retain the failed
deployment logs before the next release overwrites the one-generation snapshot.
