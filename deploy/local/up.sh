#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
base="$root/deploy/e2e/docker-compose.yml"
override="$root/deploy/local/docker-compose.yml"
project=aven-local
key_dir=$(mktemp -d)
trap 'rm -rf "$key_dir"' EXIT
openssl genpkey -algorithm ED25519 -out "$key_dir/tenant-private.pem" >/dev/null 2>&1
openssl pkey -in "$key_dir/tenant-private.pem" -pubout -out "$key_dir/tenant-public.pem" >/dev/null 2>&1
E2E_TENANT_PRIVATE_KEY=$(sed ':a;N;$!ba;s/\n/\\n/g' "$key_dir/tenant-private.pem")
E2E_TENANT_PUBLIC_KEY=$(sed ':a;N;$!ba;s/\n/\\n/g' "$key_dir/tenant-public.pem")
export E2E_TENANT_PRIVATE_KEY E2E_TENANT_PUBLIC_KEY

if [ -z "${NODE_AUTH_TOKEN:-}" ]; then
  NODE_AUTH_TOKEN=$(sed -n 's#^//npm.pkg.github.com/:_authToken=##p' "$HOME/.npmrc" 2>/dev/null | tail -n 1)
  export NODE_AUTH_TOKEN
fi
if [ -z "${NODE_AUTH_TOKEN:-}" ] || [ "$NODE_AUTH_TOKEN" = "undefined" ]; then
  echo "NODE_AUTH_TOKEN with read:packages is required to build the local services." >&2
  exit 1
fi

docker build --secret id=npm_token,env=NODE_AUTH_TOKEN --file "$root/services/identity/Dockerfile" --tag aven-e2e-identity:local "$root"
docker build --secret id=npm_token,env=NODE_AUTH_TOKEN --file "$root/services/aven-api/Dockerfile" --tag aven-e2e-api:local "$root"
docker build --secret id=npm_token,env=NODE_AUTH_TOKEN --file "$root/services/checkout/Dockerfile" --tag aven-e2e-checkout:local "$root"
docker build --secret id=npm_token,env=NODE_AUTH_TOKEN --file "$root/services/platform-provisioner/Dockerfile" --tag aven-e2e-platform-provisioner:local "$root"
docker build --secret id=npm_token,env=NODE_AUTH_TOKEN --file "$root/services/intent-service/Dockerfile" --tag aven-e2e-intent-service:local "$root"
docker build --secret id=npm_token,env=NODE_AUTH_TOKEN --file "$root/services/actor-runner/Dockerfile" --tag aven-e2e-actor-runner:local "$root"
docker build --file "$root/services/artifact-store/Dockerfile" --tag aven-e2e-artifact-store:local "$root"
docker build --file "$root/services/static-site-host/Dockerfile" --tag aven-e2e-static-site-host:local "$root"

docker compose --project-name "$project" --file "$base" --file "$override" config --quiet
docker compose --project-name "$project" --file "$base" --file "$override" up --detach --wait --wait-timeout 360

echo "Local platform is ready:"
echo "  identity  http://localhost:13100"
echo "  checkout  http://localhost:13200"
echo "  facade    http://localhost:13000"
echo "  mail      http://localhost:18025"
echo "Create a local account with: bun run local:account -- you@example.test"
