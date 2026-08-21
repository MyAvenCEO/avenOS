#!/usr/bin/env bash
set -euo pipefail

umask 077

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

usage() {
	cat <<'EOF'
Usage:
  connect.sh [profile]
  connect.sh [profile] --psql [database]

Examples:
  connect.sh next
  connect.sh next --psql
  connect.sh next --psql cust_example

The default profile is "next". A profile loads .env.<profile> from this
directory. The foreground tunnel is closed with Ctrl-C.
EOF
}

fail() {
	printf 'db-tunnel: %s\n' "$*" >&2
	exit 1
}

profile=next
mode=tunnel
database_override=

if (($# > 0)) && [[ "$1" != --* ]]; then
	profile=$1
	shift
fi

case "${1:-}" in
	'') ;;
	--psql)
		mode=psql
		shift
		database_override=${1:-}
		if (($# > 0)); then
			shift
		fi
		;;
	--help|-h)
		usage
		exit 0
		;;
	*)
		usage >&2
		exit 2
		;;
esac

(($# == 0)) || fail 'too many arguments'
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

# The file is local, user-owned configuration. Keep assignments shell-local so
# database credentials are not inherited by the SSH process.
# shellcheck source=/dev/null
source "$ENV_FILE"

: "${SSH_HOST:?Set SSH_HOST in $ENV_FILE}"
: "${SSH_USER:?Set SSH_USER in $ENV_FILE}"
: "${SSH_IDENTITY_FILE:?Set SSH_IDENTITY_FILE in $ENV_FILE}"
: "${SSH_KNOWN_HOSTS_FILE:?Set SSH_KNOWN_HOSTS_FILE in $ENV_FILE}"

SSH_PORT=${SSH_PORT:-22}
LOCAL_DB_PORT=${LOCAL_DB_PORT:-55433}
REMOTE_DB_HOST=${REMOTE_DB_HOST:-127.0.0.1}
REMOTE_DB_PORT=${REMOTE_DB_PORT:-55432}
PGDATABASE=${PGDATABASE:-aven}

valid_port() {
	[[ "$1" =~ ^[0-9]+$ ]] && ((10#$1 >= 1 && 10#$1 <= 65535))
}

valid_port "$SSH_PORT" || fail "invalid SSH_PORT: $SSH_PORT"
valid_port "$LOCAL_DB_PORT" || fail "invalid LOCAL_DB_PORT: $LOCAL_DB_PORT"
valid_port "$REMOTE_DB_PORT" || fail "invalid REMOTE_DB_PORT: $REMOTE_DB_PORT"
[[ "$REMOTE_DB_HOST" == 127.0.0.1 ]] || fail 'REMOTE_DB_HOST must remain 127.0.0.1'

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
	-N
	-T
	-p "$SSH_PORT"
	-i "$SSH_IDENTITY_FILE"
	-L "127.0.0.1:$LOCAL_DB_PORT:$REMOTE_DB_HOST:$REMOTE_DB_PORT"
	-o IdentitiesOnly=yes
	-o StrictHostKeyChecking=yes
	-o "UserKnownHostsFile=$SSH_KNOWN_HOSTS_FILE"
	-o ExitOnForwardFailure=yes
	-o ServerAliveInterval=30
	-o ServerAliveCountMax=3
)

printf 'Database tunnel\n'
printf '  profile:  %s\n' "$profile"
printf '  local:    127.0.0.1:%s\n' "$LOCAL_DB_PORT"
printf '  database: %s\n' "${database_override:-$PGDATABASE}"
if [[ -n "${PGUSER:-}" ]]; then
	printf '  user:     %s\n' "$PGUSER"
fi

if [[ "$mode" == tunnel ]]; then
	printf '  close:    Ctrl-C\n'
	# Do not retain or expose database credentials in the SSH process.
	export -n PGPASSWORD 2>/dev/null || true
	exec ssh "${ssh_args[@]}" "$TARGET"
fi

command -v psql >/dev/null 2>&1 || fail 'psql is not installed or not on PATH'
: "${PGUSER:?Set PGUSER in $ENV_FILE for --psql}"
: "${PGPASSWORD:?Set PGPASSWORD in $ENV_FILE for --psql}"

runtime_dir=$(mktemp -d "${TMPDIR:-/tmp}/aven-db-tunnel.XXXXXX")
control_socket="$runtime_dir/ssh-control"
cleanup() {
	ssh -S "$control_socket" -O exit "$TARGET" >/dev/null 2>&1 || true
	rm -f -- "$control_socket"
	rmdir -- "$runtime_dir" 2>/dev/null || true
}
trap cleanup EXIT INT TERM HUP

# Authentication happens before SSH backgrounds itself, so an encrypted key
# may prompt here. Loading it into ssh-agent avoids repeated prompts.
ssh "${ssh_args[@]}" -M -S "$control_socket" -f "$TARGET"

PGHOST=127.0.0.1 \
	PGPORT="$LOCAL_DB_PORT" \
	PGDATABASE="${database_override:-$PGDATABASE}" \
	PGUSER="$PGUSER" \
	PGPASSWORD="$PGPASSWORD" \
	psql
