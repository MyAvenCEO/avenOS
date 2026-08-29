#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
compose="$root/deploy/e2e/docker-compose.yml"
project=${COMPOSE_PROJECT_NAME:-aven-e2e-$$}
key_dir=$(mktemp -d)
openssl genpkey -algorithm ED25519 -out "$key_dir/tenant-private.pem" >/dev/null 2>&1
openssl pkey -in "$key_dir/tenant-private.pem" -pubout -out "$key_dir/tenant-public.pem" >/dev/null 2>&1
E2E_TENANT_PRIVATE_KEY=$(sed ':a;N;$!ba;s/\n/\\n/g' "$key_dir/tenant-private.pem")
E2E_TENANT_PUBLIC_KEY=$(sed ':a;N;$!ba;s/\n/\\n/g' "$key_dir/tenant-public.pem")
export E2E_TENANT_PRIVATE_KEY E2E_TENANT_PUBLIC_KEY

# Do not contend with an interactive local stack or another worktree's E2E.
# Docker keeps the internal service ports fixed; only disposable host bindings
# and the public browser origins vary.
ports=$(bun -e '
  const servers = Array.from({ length: 6 }, () =>
    Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } })
  )
  console.log(servers.map((server) => server.port).join(" "))
  for (const server of servers) server.stop(true)
')
set -- $ports
E2E_IDENTITY_HOST_PORT=$1
E2E_CHECKOUT_HOST_PORT=$2
E2E_API_HOST_PORT=$3
E2E_DATABASE_HOST_PORT=$4
E2E_STATIC_HOST_PORT=$5
E2E_MAILPIT_HOST_PORT=$6
export E2E_IDENTITY_HOST_PORT E2E_CHECKOUT_HOST_PORT E2E_API_HOST_PORT
export E2E_DATABASE_HOST_PORT E2E_STATIC_HOST_PORT E2E_MAILPIT_HOST_PORT

teardown() {
  docker compose --project-name "$project" --file "$compose" --profile hosting down --volumes --remove-orphans >/dev/null 2>&1 || true
}
finish() {
  status=$?
  trap - EXIT INT TERM
	rm -rf "$key_dir"
  if [ "$status" -ne 0 ]; then
    docker compose --project-name "$project" --file "$compose" ps --all || true
    docker compose --project-name "$project" --file "$compose" logs --no-color --tail=200 || true
  fi
  teardown
  exit "$status"
}
trap finish EXIT INT TERM

teardown

if [ -z "${NODE_AUTH_TOKEN:-}" ]; then
  NODE_AUTH_TOKEN=$(sed -n 's#^//npm.pkg.github.com/:_authToken=##p' "$HOME/.npmrc" 2>/dev/null | tail -n 1)
  export NODE_AUTH_TOKEN
fi
if [ -z "${NODE_AUTH_TOKEN:-}" ] || [ "$NODE_AUTH_TOKEN" = "undefined" ]; then
  echo "NODE_AUTH_TOKEN with read:packages is required to build checkout." >&2
  exit 1
fi

# Build the real desktop application against this run's disposable origins.
# The E2E flag only suppresses opening a second unmanaged browser window and
# exposes the fixture through the production ingest function.
VITE_AVEN_E2E=true bun run --cwd "$root/app" build
# Provision the pinned runtime before Cargo evaluates Tauri resources. This
# deliberately exercises the packaged-resource lookup used by the installed
# Linux app; relying on a developer's pre-existing ignored runtime would make a
# clean checkout compile and then panic before its first window opened.
AVEN_SPEECH_GPU=cpu bun "$root/scripts/fetch-onnxruntime.ts"
AVEN_IDENTITY_BASE_URL="http://localhost:$E2E_IDENTITY_HOST_PORT" \
AVEN_API_BASE_URL="http://127.0.0.1:$E2E_API_HOST_PORT" \
cargo build --locked --release --features custom-protocol,e2e-voice-proof --manifest-path "$root/app/src-tauri/Cargo.toml" --bin aven-os-app
E2E_TAURI_APPLICATION="$root/target/rust/release/aven-os-app"
E2E_TAURI_DRIVER=${TAURI_DRIVER_BIN:-$HOME/.cargo/bin/tauri-driver}
E2E_TAURI_FIXTURE="$root/deploy/e2e/fixtures/e2e-document.txt"
if [ ! -x "$E2E_TAURI_APPLICATION" ] || [ ! -x "$E2E_TAURI_DRIVER" ]; then
  echo "The Tauri application and tauri-driver must both be executable." >&2
  exit 1
fi
export E2E_TAURI_APPLICATION E2E_TAURI_DRIVER E2E_TAURI_FIXTURE

E2E_AVEN_CEO_IPV4=""
attempt=0
while [ -z "$E2E_AVEN_CEO_IPV4" ] && [ "$attempt" -lt 5 ]; do
  E2E_AVEN_CEO_IPV4=$(getent ahostsv4 aven.ceo 2>/dev/null | awk 'NR == 1 { print $1; exit }')
  attempt=$((attempt + 1))
  [ -n "$E2E_AVEN_CEO_IPV4" ] || sleep 1
done
if [ -z "$E2E_AVEN_CEO_IPV4" ]; then
  echo "aven.ceo must resolve before the static-host E2E test can run." >&2
  exit 1
fi
E2E_AVEN_CEO_IPV6=$(bun -e "import {resolve6} from 'node:dns/promises'; console.log((await resolve6('aven.ceo').catch(()=>[])).join(','))")
export E2E_AVEN_CEO_IPV4 E2E_AVEN_CEO_IPV6

if [ "${E2E_SKIP_IMAGE_BUILD:-false}" != "true" ]; then
  docker build --secret id=npm_token,env=NODE_AUTH_TOKEN --file "$root/services/identity/Dockerfile" --tag aven-e2e-identity:local "$root"
  docker build --secret id=npm_token,env=NODE_AUTH_TOKEN --file "$root/services/aven-api/Dockerfile" --tag aven-e2e-api:local "$root"
  docker build --secret id=npm_token,env=NODE_AUTH_TOKEN --file "$root/services/checkout/Dockerfile" --tag aven-e2e-checkout:local "$root"
  docker build --secret id=npm_token,env=NODE_AUTH_TOKEN --file "$root/services/platform-provisioner/Dockerfile" --tag aven-e2e-platform-provisioner:local "$root"
  docker build --secret id=npm_token,env=NODE_AUTH_TOKEN --file "$root/services/intent-service/Dockerfile" --tag aven-e2e-intent-service:local "$root"
  docker build --secret id=npm_token,env=NODE_AUTH_TOKEN --file "$root/services/actor-runner/Dockerfile" --tag aven-e2e-actor-runner:local "$root"
  docker build --file "$root/services/artifact-store/Dockerfile" --tag aven-e2e-artifact-store:local "$root"
  docker build --file "$root/services/static-site-host/Dockerfile" --tag aven-e2e-static-site-host:local "$root"
fi

docker compose --project-name "$project" --file "$compose" config --quiet
docker compose --project-name "$project" --file "$compose" --profile hosting up --detach --wait --wait-timeout 360

E2E_SILENT_VOICE_FIXTURE=$(cargo run --quiet --locked \
  --manifest-path "$root/libs/aven-voice-runtime/Cargo.toml" \
  --features silent-audio-e2e \
  --example silent_audio_fixture)
E2E_SILENT_DUPLEX_FIXTURE=$(cargo run --quiet --locked \
  --manifest-path "$root/libs/aven-voice-runtime/Cargo.toml" \
  --features silent-audio-e2e \
  --example silent_duplex_conversation)
export E2E_SILENT_VOICE_FIXTURE E2E_SILENT_DUPLEX_FIXTURE

TEST_ACTOR_RUNNER_DATABASE_URL="postgres://postgres:platform-admin-e2e@127.0.0.1:$E2E_DATABASE_HOST_PORT/postgres" \
bun run --cwd "$root/services/actor-runner" test:e2e:persistence

TEST_ADMIN_DATABASE_URL="postgres://postgres:platform-admin-e2e@127.0.0.1:$E2E_DATABASE_HOST_PORT/postgres" \
bun run --cwd "$root/services/checkout" test

E2E_IDENTITY_ORIGIN="http://127.0.0.1:$E2E_IDENTITY_HOST_PORT" \
E2E_IDENTITY_BROWSER_ORIGIN="http://localhost:$E2E_IDENTITY_HOST_PORT" \
E2E_CHECKOUT_ORIGIN="http://127.0.0.1:$E2E_CHECKOUT_HOST_PORT" \
E2E_CHECKOUT_BROWSER_ORIGIN="http://localhost:$E2E_CHECKOUT_HOST_PORT" \
E2E_API_ORIGIN="http://127.0.0.1:$E2E_API_HOST_PORT" \
E2E_STATIC_ORIGIN="http://127.0.0.1:$E2E_STATIC_HOST_PORT" \
E2E_MAILPIT_ORIGIN="http://127.0.0.1:$E2E_MAILPIT_HOST_PORT" \
E2E_DATABASE_URL="postgres://postgres:platform-admin-e2e@127.0.0.1:$E2E_DATABASE_HOST_PORT/postgres" \
E2E_TAURI_APPLICATION="$E2E_TAURI_APPLICATION" \
E2E_TAURI_DRIVER="$E2E_TAURI_DRIVER" \
E2E_TAURI_FIXTURE="$E2E_TAURI_FIXTURE" \
E2E_SILENT_VOICE_FIXTURE="$E2E_SILENT_VOICE_FIXTURE" \
E2E_SILENT_DUPLEX_FIXTURE="$E2E_SILENT_DUPLEX_FIXTURE" \
bunx playwright test --config "$root/deploy/e2e/playwright.config.ts"

docker compose --project-name "$project" --file "$compose" ps
