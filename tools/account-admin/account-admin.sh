#!/usr/bin/env bash
set -euo pipefail

umask 077

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

usage() {
	cat <<'EOF'
Usage:
  account-admin.sh [profile] list
  account-admin.sh [profile] promote <user-id-or-email> [--yes]
  account-admin.sh [profile] demote <user-id-or-email> [--allow-resource-suspension] [--yes]

Examples:
  account-admin.sh next list
  account-admin.sh next promote owner@example.com
  account-admin.sh production demote 7d496202-cceb-4c8f-9964-42ebba78e6ea

The default profile is "next". A profile loads .env.<profile> from this
directory. Promotion and demotion require an interactive confirmation unless
--yes is passed. Demotion refuses to suspend admin-dependent resources unless
--allow-resource-suspension is also passed.
EOF
}

fail() {
	printf 'account-admin: %s\n' "$*" >&2
	exit 1
}

profile=next
if (($# > 0)) && [[ "$1" != list && "$1" != promote && "$1" != demote && "$1" != --* ]]; then
	profile=$1
	shift
fi

case "${1:-}" in
	list|promote|demote)
		command=$1
		shift
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

selector=
assume_yes=false
allow_resource_suspension=false
if [[ "$command" == promote || "$command" == demote ]]; then
	selector=${1:-}
	[[ -n "$selector" ]] || fail "$command requires a user id or email"
	shift
	while (($# > 0)); do
		case "$1" in
			--yes) assume_yes=true ;;
			--allow-resource-suspension) allow_resource_suspension=true ;;
			*) fail "unknown option: $1" ;;
		esac
		shift
	done
fi

(($# == 0)) || fail 'too many arguments'
if [[ "$command" != demote && "$allow_resource_suspension" == true ]]; then
	fail '--allow-resource-suspension is valid only with demote'
fi
[[ "$profile" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || fail "invalid profile: $profile"
[[ "$selector" != *$'\n'* && "$selector" != *$'\r'* ]] || fail 'selector must be one line'

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

# This user-owned file contains the database password, but never a private key
# or passphrase. Values remain shell-local until the psql child is launched.
# shellcheck source=/dev/null
source "$ENV_FILE"

: "${SSH_HOST:?Set SSH_HOST in $ENV_FILE}"
: "${SSH_USER:?Set SSH_USER in $ENV_FILE}"
: "${SSH_IDENTITY_FILE:?Set SSH_IDENTITY_FILE in $ENV_FILE}"
: "${SSH_KNOWN_HOSTS_FILE:?Set SSH_KNOWN_HOSTS_FILE in $ENV_FILE}"
: "${PGUSER:?Set PGUSER in $ENV_FILE}"
: "${PGPASSWORD:?Set PGPASSWORD in $ENV_FILE}"

SSH_PORT=${SSH_PORT:-22}
LOCAL_DB_PORT=${LOCAL_DB_PORT:-55434}
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
command -v psql >/dev/null 2>&1 || fail 'psql is not installed or not on PATH'

host_key_name=$SSH_HOST
if [[ "$SSH_PORT" != 22 ]]; then
	host_key_name="[$SSH_HOST]:$SSH_PORT"
fi
ssh-keygen -F "$host_key_name" -f "$SSH_KNOWN_HOSTS_FILE" >/dev/null ||
	fail "no host key for $host_key_name in $SSH_KNOWN_HOSTS_FILE"

readonly TARGET="$SSH_USER@$SSH_HOST"
runtime_dir=$(mktemp -d "${TMPDIR:-/tmp}/aven-account-admin.XXXXXX")
control_socket="$runtime_dir/ssh-control"
cleanup() {
	ssh -S "$control_socket" -O exit "$TARGET" >/dev/null 2>&1 || true
	rm -f -- "$control_socket"
	rmdir -- "$runtime_dir" 2>/dev/null || true
}
trap cleanup EXIT INT TERM HUP

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

printf 'Account administration\n'
printf '  profile:  %s\n' "$profile"
printf '  server:   %s\n' "$SSH_HOST"
printf '  database: %s\n' "$PGDATABASE"
printf '  operator: %s\n\n' "$PGUSER"

# Authentication completes before SSH backgrounds, so encrypted keys can
# prompt here. The control socket lets cleanup close only this tool's tunnel.
ssh "${ssh_args[@]}" -M -S "$control_socket" -f "$TARGET"

run_psql() {
	PGHOST=127.0.0.1 \
	PGPORT="$LOCAL_DB_PORT" \
	PGDATABASE="$PGDATABASE" \
	PGUSER="$PGUSER" \
	PGPASSWORD="$PGPASSWORD" \
	PGAPPNAME=aven-account-admin \
	psql -X --no-psqlrc --set=ON_ERROR_STOP=1 "$@"
}

if [[ "$command" == list ]]; then
	run_psql --file "$SCRIPT_DIR/sql/list.sql"
	exit 0
fi

match_count=$(
	run_psql \
		--tuples-only \
		--no-align \
		--quiet \
		--set=selector="$selector" \
		--file "$SCRIPT_DIR/sql/match-count.sql"
)
[[ "$match_count" == 1 ]] || fail "selector matched $match_count accounts; use an exact user id or email"

run_psql --set=selector="$selector" --file "$SCRIPT_DIR/sql/show-account.sql"

impact_count=0
if [[ "$command" == demote ]]; then
	impact_count=$(
		run_psql \
			--tuples-only \
			--no-align \
			--quiet \
			--set=selector="$selector" \
			--file "$SCRIPT_DIR/sql/impact-count.sql"
	)
	if ((impact_count > 0)); then
		printf 'Admin-dependent resources that demotion will suspend:\n'
		run_psql --set=selector="$selector" --file "$SCRIPT_DIR/sql/show-impacted-resources.sql"
		if [[ "$allow_resource_suspension" != true ]]; then
			fail "demotion would suspend $impact_count resources; review them and pass --allow-resource-suspension to proceed"
		fi
	fi
fi

new_role=user
event_type=account.admin.demoted
if [[ "$command" == promote ]]; then
	new_role=admin
	event_type=account.admin.promoted
fi

if [[ "$assume_yes" != true ]]; then
	[[ -t 0 ]] || fail 'confirmation requires a terminal; pass --yes for non-interactive use'
	confirmation_phrase=$command
	if ((impact_count > 0)); then
		confirmation_phrase="demote and suspend $impact_count resources"
	fi
	printf 'Type "%s" to set this account role to %s: ' "$confirmation_phrase" "$new_role"
	read -r confirmation
	[[ "$confirmation" == "$confirmation_phrase" ]] || fail 'confirmation did not match; no change made'
fi

run_psql \
	--set=selector="$selector" \
	--set=new_role="$new_role" \
	--set=event_type="$event_type" \
	--set=allow_resource_suspension="$allow_resource_suspension" \
	--file "$SCRIPT_DIR/sql/set-role.sql"
