#!/usr/bin/env bash
set -euo pipefail

root=$(cd -- "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)

pulumi() {
  if [[ "${1:-}" == login ]] || [[ "${1:-}" == stack && "${2:-}" == select ]]; then
    return 0
  fi
  if [[ "${1:-}" != stack || "${2:-}" != output || -z "${3:-}" ]]; then
    echo "unexpected pulumi invocation: $*" >&2
    return 1
  fi
  case "$3" in
    deployUser) printf '%s\n' aven-deploy ;;
    deploymentEnvironment) printf '%s\n' "$DEPLOYMENT_TARGET" ;;
    deploymentTarget)
      [[ "$DEPLOYMENT_TARGET" == identity ]] && printf '%s\n' identity || printf '%s\n' platform
      ;;
    identityIpv4Address|platformIpv4Address) printf '%s\n' 192.0.2.10 ;;
    platformIpv6Address) printf '%s\n' 2001:db8::10 ;;
    identityHostPublicKey|platformHostPublicKey) printf '%s\n' 'ssh-ed25519 AAAATEST' ;;
    platformIdentityProvisioningSecret) printf '%064d\n' 0 ;;
    tenantGrantPublicKey) printf '%s\n' test-public-key ;;
    *) printf '%s\n' test-secret ;;
  esac
}

dig() {
  local argument
  for argument in "$@"; do
    if [[ "$argument" == AAAA ]]; then
      printf '%s\n' 2001:db8::20
      return 0
    fi
  done
  printf '%s\n' 192.0.2.20
}

file_mode() {
  stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"
}

assert_ssh_arguments() {
  local argument path identities_only=false
  while (($# > 0)); do
    argument=$1
    shift
    if [[ "$argument" == -i ]]; then
      path=${1:?missing SSH identity path}
      shift
      [[ -f "$path" && "$(file_mode "$path")" == 600 ]]
    elif [[ "$argument" == UserKnownHostsFile=* ]]; then
      path=${argument#UserKnownHostsFile=}
      [[ -f "$path" && "$(file_mode "$path")" == 600 ]]
    elif [[ "$argument" == IdentitiesOnly=yes ]]; then
      identities_only=true
    fi
  done
  [[ "$identities_only" == true ]]
}

ssh() {
  assert_ssh_arguments "$@"
}

ssh-keyscan() {
  local host=${*: -1}
  printf '%s ssh-ed25519 AAAATEST\n' "$host"
}

scp() {
  assert_ssh_arguments "$@"
  if [[ "$DEPLOYMENT_TARGET" == identity ]]; then
    local source=${@: -2:1}
    local expected
    expected=$(jq length <<<"$IDENTITY_PLATFORM_TARGETS_JSON")
    if [[ "$expected" == 0 ]]; then
      grep -Fq 'IDENTITY_ALLOW_NO_PLATFORMS="true"' "$source/.env"
      grep -Fq 'IDENTITY_PROVISIONING_SECRETS=""' "$source/.env"
      ! grep -q 'remote_ip' "$source/Caddyfile"
      grep -q 'respond @untrusted_internal 404' "$source/Caddyfile"
    else
      grep -Fq 'IDENTITY_ALLOW_NO_PLATFORMS="false"' "$source/.env"
      grep -q 'not remote_ip' "$source/Caddyfile"
    fi
    for target in next production; do
      if ! jq -e --arg target "$target" 'index($target) != null' <<<"$IDENTITY_PLATFORM_TARGETS_JSON" >/dev/null; then
        local domain=aven.ceo
        [[ "$target" == next ]] && domain=next.aven.ceo
        ! grep -Fq "https://portal.$domain" "$source/.env"
      fi
    done
  fi
}

curl() {
  return 0
}

bun() {
  if [[ "$1" == "$root/scripts/validate-deploy-manifest.ts" ]]; then
    command bun "$@"
    return
  fi
  [[ "$1" == "$root/scripts/reconcile-deployed-polar-webhook.ts" ]]
  [[ "$DEPLOYMENT_TARGET" == next || "$DEPLOYMENT_TARGET" == production ]]
}

run_target() (
  export DEPLOYMENT_TARGET=$1
  export IDENTITY_PLATFORM_TARGETS_JSON=${2:-'["next","production"]'}
  export PULUMI_STACK="organization/aven-platform/$DEPLOYMENT_TARGET"
  export PULUMI_BACKEND=s3://test-state
  export NEXT_PULUMI_STACK=organization/aven-platform/next
  export NEXT_PULUMI_BACKEND=s3://next-state
  export NEXT_STATE_S3_ACCESS_KEY_ID=test
  export NEXT_STATE_S3_SECRET_ACCESS_KEY=test
  export NEXT_PULUMI_CONFIG_PASSPHRASE=test
  export PRODUCTION_PULUMI_STACK=organization/aven-platform/production
  export PRODUCTION_PULUMI_BACKEND=s3://production-state
  export PRODUCTION_STATE_S3_ACCESS_KEY_ID=test
  export PRODUCTION_STATE_S3_SECRET_ACCESS_KEY=test
  export PRODUCTION_PULUMI_CONFIG_PASSPHRASE=test
  # Unselected credentials must not be required or read.
  if [[ "$DEPLOYMENT_TARGET" == identity ]]; then
    for target in next production; do
      if ! jq -e --arg target "$target" 'index($target) != null' <<<"$IDENTITY_PLATFORM_TARGETS_JSON" >/dev/null; then
        for suffix in PULUMI_STACK PULUMI_BACKEND STATE_S3_ACCESS_KEY_ID STATE_S3_SECRET_ACCESS_KEY PULUMI_CONFIG_PASSPHRASE; do
          unset "${target^^}_${suffix}"
        done
      fi
    done
  fi
  export GHCR_USER=test
  export GHCR_TOKEN=test
  export OPERATIONS_IMAGE=operations:test
  export DATABASE_IMAGE=database:test
  export PROXY_IMAGE=proxy:test
  export BACKUP_REPOSITORY_BASE=s3:https://example.test/backup
  export BACKUP_S3_ACCESS_KEY_ID=test
  export BACKUP_S3_SECRET_ACCESS_KEY=test
  export BACKUP_S3_REGION=hel1
  export BACKUP_RESTIC_PASSWORD=test
  export RECOVER_FROM_BACKUP=false
  export IDENTITY_IMAGE=identity:test
  export API_IMAGE=api:test
  export CHECKOUT_IMAGE=checkout:test
  export STATIC_SITE_HOST_IMAGE=static:test
  export PLATFORM_PROVISIONER_IMAGE=provisioner:test
  export INTENT_SERVICE_IMAGE=intent:test
  export ACTOR_RUNNER_IMAGE=actor:test
  export ARTIFACT_STORE_IMAGE=artifact:test
  export POLAR_API_KEY=test
  export POLAR_WEBHOOK_SECRET=test
  export SMTP_URL=smtp://example.test
  export SMTP_FROM=test@example.test
  export DOWNLOAD_URL=https://example.test/download
  export LLM_GATEWAY_MODELS_JSON='[]'
  export LLM_GATEWAY_CREDENTIALS_JSON='{}'
  export GITHUB_RUN_ID=release-script-test
  export GITHUB_RUN_ATTEMPT=1
  export DEPLOYED_REF_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  while read -r name image; do export "$name=$image"; done < <(
    command bun -e 'import {releaseImages} from "./scripts/lib/platform-release.ts"; for(const [key,image] of Object.entries(releaseImages)) console.log(`${key} ghcr.io/myavenceo/${image}@sha256:${"a".repeat(64)}`)'
  )
  RELEASE_MANIFEST=$(command bun -e 'import {releaseImages} from "./scripts/lib/platform-release.ts"; console.log(JSON.stringify({version:1,sha:process.env.DEPLOYED_REF_SHA,runId:1,images:Object.fromEntries(Object.keys(releaseImages).map(key=>[key,process.env[key]]))}))')
  export RELEASE_MANIFEST
  source "$root/deploy/release/deploy.sh"
)

output_file=$(mktemp)
trap 'rm -f "$output_file"' EXIT
for target in identity next production; do
  run_target "$target" >"$output_file" 2>&1
  if grep -Fq 'test-secret' "$output_file"; then
    echo "release deployment exposed a Pulumi secret for $target" >&2
    exit 1
  fi
done
for selection in '[]' '["next"]' '["production"]'; do
  run_target identity "$selection" >"$output_file" 2>&1 || { cat "$output_file"; exit 1; }
done
# Validate the caller list before any SSH or state access.
for selection in '["next","next"]' '["other"]' 'null' '{}'; do
  if run_target identity "$selection" >"$output_file" 2>&1; then
    echo 'Invalid identity caller selection was accepted' >&2
    exit 1
  fi
done
echo 'release deployment staging passed for identity, next, and production'
