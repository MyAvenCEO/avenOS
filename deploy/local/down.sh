#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
docker compose \
  --project-name aven-local \
  --file "$root/deploy/e2e/docker-compose.yml" \
  --file "$root/deploy/local/docker-compose.yml" \
  down --volumes --remove-orphans
