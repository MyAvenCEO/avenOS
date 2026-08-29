#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
export E2E_TENANT_PRIVATE_KEY=${E2E_TENANT_PRIVATE_KEY:-unused-local-teardown-key}
export E2E_TENANT_PUBLIC_KEY=${E2E_TENANT_PUBLIC_KEY:-unused-local-teardown-key}
docker compose \
  --project-name aven-local \
  --file "$root/deploy/e2e/docker-compose.yml" \
  --file "$root/deploy/local/docker-compose.yml" \
  down --volumes --remove-orphans
