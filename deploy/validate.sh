#!/usr/bin/env bash
set -euo pipefail

root=$(cd -- "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

sh -n \
  "$root/deploy/e2e/run.sh" \
  "$root/deploy/local/up.sh" \
  "$root/deploy/local/down.sh" \
  "$root/deploy/local/account.sh" \
  "$root/deploy/local/app.sh" \
  "$root/tools/db-tunnel/open.sh" \
  "$root/tools/stack-observe/run.sh" \
  "$root/deploy/operations/backup.sh" \
  "$root/deploy/operations/restore.sh" \
  "$root/deploy/operations/entrypoint.sh" \
  "$root/deploy/operations/healthcheck.sh"
bash -n "$root/deploy/release/deploy.sh" "$root/deploy/validate.sh" "$root/deploy/operations/test-recovery.sh"

env \
  IDENTITY_IMAGE=identity:test \
  OPERATIONS_IMAGE=operations:test \
  IDENTITY_POSTGRES_PASSWORD=test \
  IDENTITY_AUTH_PASSWORD=test-auth \
  IDENTITY_ACCOUNTS_PASSWORD=test-accounts \
  IDENTITY_AUTHORIZATION_PASSWORD=test-authorization \
  IDENTITY_MIGRATOR_PASSWORD=test \
  IDENTITY_BACKUP_PASSWORD=test-backup \
  IDENTITY_BETTER_AUTH_SECRET=01234567890123456789012345678901 \
  IDENTITY_PROVISIONING_SECRET=01234567890123456789012345678901 \
  PLATFORM_PUBLIC_IPV4=192.0.2.10 \
  PLATFORM_PUBLIC_IPV6=2001:db8::10 \
  ACME_EMAIL=test@example.test \
  BACKUP_RESTIC_REPOSITORY=/tmp/restic/identity \
  BACKUP_RESTIC_PASSWORD=test-backup-password \
  BACKUP_S3_ACCESS_KEY_ID=test \
  BACKUP_S3_SECRET_ACCESS_KEY=test \
  BACKUP_S3_REGION=hel1 \
  BACKUP_ENVIRONMENT=test \
  docker compose --file "$root/deploy/identity/docker-compose.yml" config --quiet

env \
  API_IMAGE=api:test \
  CHECKOUT_IMAGE=checkout:test \
  STATIC_SITE_HOST_IMAGE=host:test \
  PLATFORM_PROVISIONER_IMAGE=provisioner:test \
  INTENT_SERVICE_IMAGE=intent:test \
  ACTOR_RUNNER_IMAGE=actor:test \
  ARTIFACT_STORE_IMAGE=artifact:test \
  OPERATIONS_IMAGE=operations:test \
  PLATFORM_POSTGRES_PASSWORD=test \
  PLATFORM_BACKUP_PASSWORD=test-backup \
  CHECKOUT_RUNTIME_PASSWORD=test \
  CHECKOUT_WEBHOOK_PASSWORD=test-webhook \
  CHECKOUT_MIGRATOR_PASSWORD=test \
  CHECKOUT_EMAIL_PASSWORD=test \
  CHECKOUT_PLATFORM_EVENTS_PASSWORD=test \
  API_HOSTING_PASSWORD=test \
  API_AUTHORIZATION_PASSWORD=test \
  API_ENTITLEMENTS_PASSWORD=test \
  API_RECONCILER_PASSWORD=test \
  API_MIGRATOR_PASSWORD=test \
  CUSTOMER_PROVISIONER_PASSWORD=test \
  ARTIFACT_STORE_PROVISIONER_DB_PASSWORD=test \
  INTENT_DATABASE_CREDENTIAL_ROOT=01234567890123456789012345678901234567890123 \
  ARTIFACT_API_DATABASE_CREDENTIAL_ROOT=BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ \
  ACTOR_API_DATABASE_CREDENTIAL_ROOT=01234567890123456789012345678901234567890123 \
  ACTOR_WORKER_DATABASE_CREDENTIAL_ROOT=01234567890123456789012345678901234567890123 \
  CUSTOMER_ENTITLEMENT_TOKEN=01234567890123456789012345678901 \
  INTENT_SERVICE_TOKEN=01234567890123456789012345678901 \
  ACTOR_RUNNER_SERVICE_TOKEN=01234567890123456789012345678901 \
  ARTIFACT_STORE_SERVICE_TOKEN=01234567890123456789012345678901 \
  ARTIFACT_STORE_PROVISIONER_TOKEN=01234567890123456789012345678901 \
  TENANT_GRANT_PRIVATE_KEY=test-private-key \
  TENANT_GRANT_PUBLIC_KEY=test-public-key \
  IDENTITY_PROVISIONING_SECRET=01234567890123456789012345678901 \
  CHECKOUT_FACADE_TOKEN=01234567890123456789012345678901 \
  DOWNLOAD_URL=https://example.test \
  CHECKOUT_EMAIL_ENCRYPTION_KEY=BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc= \
  POLAR_WEBHOOK_SECRET=0123456789 \
  AVEN_TIER_NAME=polar-product-test \
  SITE_HOST_DIRECTORY_BEARER_TOKEN=01234567890123456789012345678901 \
  PLATFORM_PUBLIC_IPV4=192.0.2.10 \
  DOWNSTREAMS_JSON='[]' \
  CUSTOMER_DOWNSTREAMS_JSON='[]' \
  LLM_GATEWAY_MODELS_JSON='[]' \
  LLM_GATEWAY_CREDENTIALS_JSON='{}' \
  SMTP_URL=smtp://example.test:25 \
  SMTP_FROM=test@example.test \
  ACME_EMAIL=test@example.test \
  BACKUP_RESTIC_REPOSITORY=/tmp/restic/platform \
  BACKUP_RESTIC_PASSWORD=test-backup-password \
  BACKUP_S3_ACCESS_KEY_ID=test \
  BACKUP_S3_SECRET_ACCESS_KEY=test \
  BACKUP_S3_REGION=hel1 \
  BACKUP_ENVIRONMENT=test \
  docker compose --file "$root/deploy/platform/docker-compose.yml" config --quiet

docker run --rm \
  --env IDENTITY_DOMAIN=aven.id \
  --env PLATFORM_PUBLIC_IPV4=192.0.2.10 \
  --env PLATFORM_PUBLIC_IPV6=2001:db8::10 \
  --env ACME_EMAIL=test@example.test \
  --volume "$root/deploy/identity/Caddyfile:/etc/caddy/Caddyfile:ro" \
  caddy:2.10.2-alpine caddy validate --config /etc/caddy/Caddyfile

docker run --rm \
  --env API_DOMAIN=api.aven.ceo \
  --env CHECKOUT_DOMAIN=my.aven.ceo \
  --env ACME_EMAIL=test@example.test \
  --volume "$root/deploy/platform/Caddyfile:/etc/caddy/Caddyfile:ro" \
  caddy:2.10.2-alpine caddy validate --config /etc/caddy/Caddyfile
