#!/usr/bin/env bash
set -euo pipefail

umask 077

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REMOTE_APP_DIR=/opt/aven-api

usage() {
	cat <<'EOF'
Usage:
  observe.sh [profile] [status]
  observe.sh [profile] services
  observe.sh [profile] health
  observe.sh [profile] logs [service ...] [--since duration] [--tail lines] [--follow]

Examples:
  observe.sh next
  observe.sh next services
  observe.sh next health
  observe.sh next logs app
  observe.sh next logs app email-worker --since 30m --tail 500
  observe.sh next logs app --follow

The default profile is "next" and the default command is "status". A profile
loads .env.<profile> from this directory. Log output defaults to the last hour
and 200 lines per service.
EOF
}

fail() {
	printf 'stack-observe: %s\n' "$*" >&2
	exit 1
}

profile=next
case "${1:-}" in
	''|status|services|health|logs|--help|-h) ;;
	*)
		profile=$1
		shift
		;;
esac

case "${1:-status}" in
	--help|-h)
		usage
		exit 0
		;;
	status|services|health|logs)
		command=${1:-status}
		if (($# > 0)); then
			shift
		fi
		;;
	*)
		usage >&2
		exit 2
		;;
esac

[[ "$profile" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || fail "invalid profile: $profile"

readonly ENV_FILE="$SCRIPT_DIR/.env.$profile"
[[ -f "$ENV_FILE" ]] || fail "missing $ENV_FILE; copy .env.example and set its values"

env_mode=
if env_mode=$(stat -f '%Lp' "$ENV_FILE" 2>/dev/null); then
	:
elif env_mode=$(stat -c '%a' "$ENV_FILE" 2>/dev/null); then
	:
else
	fail "cannot inspect permissions for $ENV_FILE"
fi
case "$env_mode" in
	400|600) ;;
	*) fail "$ENV_FILE must have mode 600 or 400; run: chmod 600 '$ENV_FILE'" ;;
esac

# The profile is local, user-owned configuration. It contains paths and public
# endpoints, never private-key contents or deployment secrets.
# shellcheck source=/dev/null
source "$ENV_FILE"

: "${SSH_HOST:?Set SSH_HOST in $ENV_FILE}"
: "${SSH_USER:?Set SSH_USER in $ENV_FILE}"
: "${SSH_IDENTITY_FILE:?Set SSH_IDENTITY_FILE in $ENV_FILE}"
: "${SSH_KNOWN_HOSTS_FILE:?Set SSH_KNOWN_HOSTS_FILE in $ENV_FILE}"
: "${PUBLIC_BASE_URL:?Set PUBLIC_BASE_URL in $ENV_FILE}"

SSH_PORT=${SSH_PORT:-22}

valid_port() {
	[[ "$1" =~ ^[0-9]+$ ]] && ((10#$1 >= 1 && 10#$1 <= 65535))
}

valid_port "$SSH_PORT" || fail "invalid SSH_PORT: $SSH_PORT"
[[ "$SSH_USER" =~ ^[a-z_][a-z0-9_-]*$ ]] || fail "invalid SSH_USER: $SSH_USER"
[[ "$PUBLIC_BASE_URL" =~ ^https://[^/[:space:]]+/?$ ]] ||
	fail 'PUBLIC_BASE_URL must be an HTTPS origin without a path'

case "$SSH_IDENTITY_FILE" in
	/*) ;;
	*) fail 'SSH_IDENTITY_FILE must be an absolute path' ;;
esac
case "$SSH_KNOWN_HOSTS_FILE" in
	/*) ;;
	*) fail 'SSH_KNOWN_HOSTS_FILE must be an absolute path' ;;
esac

[[ -r "$SSH_IDENTITY_FILE" ]] || fail "SSH identity is not readable: $SSH_IDENTITY_FILE"
[[ -r "$SSH_KNOWN_HOSTS_FILE" ]] || fail "known_hosts is not readable: $SSH_KNOWN_HOSTS_FILE"

host_key_name=$SSH_HOST
if [[ "$SSH_PORT" != 22 ]]; then
	host_key_name="[$SSH_HOST]:$SSH_PORT"
fi
ssh-keygen -F "$host_key_name" -f "$SSH_KNOWN_HOSTS_FILE" >/dev/null ||
	fail "no host key for $host_key_name in $SSH_KNOWN_HOSTS_FILE"

readonly TARGET="$SSH_USER@$SSH_HOST"
ssh_args=(
	-T
	-p "$SSH_PORT"
	-i "$SSH_IDENTITY_FILE"
	-o BatchMode=yes
	-o ConnectTimeout=10
	-o IdentitiesOnly=yes
	-o StrictHostKeyChecking=yes
	-o "UserKnownHostsFile=$SSH_KNOWN_HOSTS_FILE"
	-o ServerAliveInterval=30
	-o ServerAliveCountMax=3
)

run_compose() {
	local quoted_args
	printf -v quoted_args ' %q' \
		sudo docker compose \
		--env-file .env \
		-f docker-compose.yml \
		-f docker-compose.deploy.yml \
		"$@"
	ssh "${ssh_args[@]}" "$TARGET" "cd $REMOTE_APP_DIR &&$quoted_args"
}

require_no_args() {
	(($# == 0)) || fail "$command does not accept arguments"
}

print_context() {
	printf 'Remote stack\n'
	printf '  profile: %s\n' "$profile"
	printf '  host:    %s\n' "$SSH_HOST"
}

case "$command" in
	status)
		require_no_args "$@"
		print_context
		run_compose ps --all
		;;
	services)
		require_no_args "$@"
		run_compose config --services
		;;
	health)
		require_no_args "$@"
		command -v curl >/dev/null 2>&1 || fail 'curl is not installed or not on PATH'
		base_url=${PUBLIC_BASE_URL%/}
		printf 'Readiness\n'
		curl --fail --silent --show-error --connect-timeout 10 --max-time 30 \
			"$base_url/api/health/ready"
		printf '\n\nStatus\n'
		curl --fail --silent --show-error --connect-timeout 10 --max-time 30 \
			"$base_url/api/health/status"
		printf '\n'
		;;
	logs)
		tail_lines=200
		since=1h
		follow=false
		services=()
		while (($# > 0)); do
			case "$1" in
				--tail)
					(($# >= 2)) || fail '--tail requires a line count'
					tail_lines=$2
					shift 2
					;;
				--since)
					(($# >= 2)) || fail '--since requires a duration'
					since=$2
					shift 2
					;;
				--follow|-f)
					follow=true
					shift
					;;
				--help|-h)
					usage
					exit 0
					;;
				--*) fail "unknown logs option: $1" ;;
				*)
					[[ "$1" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || fail "invalid service name: $1"
					services+=("$1")
					shift
					;;
			esac
		done

		[[ "$tail_lines" =~ ^[0-9]+$ ]] &&
			((10#$tail_lines >= 1 && 10#$tail_lines <= 10000)) ||
			fail '--tail must be between 1 and 10000'
		[[ "$since" =~ ^[1-9][0-9]*(ms|s|m|h)$ ]] ||
			fail '--since must be a positive duration such as 30m, 1h, or 250ms'

		if ((${#services[@]} > 0)); then
			available_services=$(run_compose config --services)
			for requested_service in "${services[@]}"; do
				service_found=false
				while IFS= read -r available_service; do
					if [[ "$requested_service" == "$available_service" ]]; then
						service_found=true
						break
					fi
				done <<<"$available_services"
				$service_found || fail "unknown service for $profile: $requested_service"
			done
		fi

		log_args=(logs --no-color --timestamps --tail "$tail_lines" --since "$since")
		$follow && log_args+=(--follow)
		log_args+=("${services[@]}")
		print_context
		printf '  since:   %s\n' "$since"
		printf '  tail:    %s per service\n' "$tail_lines"
		run_compose "${log_args[@]}"
		;;
esac
