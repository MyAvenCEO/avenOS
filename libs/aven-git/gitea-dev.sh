#!/bin/sh
# Headless Gitea lifecycle for the aven-git spike (board 0162).
#
# The "user's server" simulated locally: everything a browser wizard would do
# happens here as commands, because the real target is a per-user remote server
# provisioned by the 24/7 aven agent with no human at a web UI. The app talks
# to the result exclusively over /api/v1 — same as it will remotely.
#
#   gitea-dev.sh up     boot (admin + token minted before first start)
#   gitea-dev.sh smoke  create repo `spike-hello` via the API and list it back
#   gitea-dev.sh down   stop the background server
#   gitea-dev.sh wipe   down + delete all state for a from-scratch rerun
set -eu

DIR="$(cd "$(dirname "$0")" && pwd)"
DATA="$DIR/.gitea-dev"
INI="$DATA/app.ini"
PID="$DATA/gitea.pid"
TOKEN_FILE="$DATA/token"
LOG="$DATA/gitea.log"

PORT=3300
URL="http://localhost:$PORT"
ADMIN_USER="aven"
ADMIN_PASS="aven-dev-password-1"
ADMIN_EMAIL="aven@localhost.local"
GITEA="${GITEA_BIN:-gitea}"

die() {
	echo "aven-git: $*" >&2
	exit 1
}

# Every gitea CLI call needs the same config + work dir; the CLI writes the
# SQLite DB directly, which is why admin + token are minted BEFORE `web` runs.
gitea_cli() {
	GITEA_WORK_DIR="$DATA" "$GITEA" --config "$INI" "$@"
}

running() {
	[ -f "$PID" ] && kill -0 "$(cat "$PID")" 2>/dev/null
}

write_ini() {
	mkdir -p "$DATA"
	cat >"$INI" <<EOF
APP_NAME = aven-git dev
RUN_MODE = prod
WORK_PATH = $DATA

[server]
HTTP_PORT = $PORT
ROOT_URL = $URL/
DISABLE_SSH = true
OFFLINE_MODE = true

[database]
DB_TYPE = sqlite3
PATH = $DATA/gitea.db

[repository]
ROOT = $DATA/repos

; INSTALL_LOCK is the whole point: no web wizard, ever.
[security]
INSTALL_LOCK = true

; Spike-grade CORS so the app webview (a different origin) can call /api/v1
; directly. The real per-user server gets proper auth + a tight allowlist.
[cors]
ENABLED = true
ALLOW_DOMAIN = *
HEADERS = Content-Type,User-Agent,Authorization

[service]
DISABLE_REGISTRATION = true

[log]
MODE = file
ROOT_PATH = $DATA/log
EOF
}

up() {
	command -v "$GITEA" >/dev/null 2>&1 || die "gitea binary not found — brew install gitea (or set GITEA_BIN)"
	if running; then
		echo "already running at $URL"
		[ -f "$TOKEN_FILE" ] && echo "token: $(cat "$TOKEN_FILE")"
		return 0
	fi
	write_ini

	# The wizard normally migrates the DB on first run; headless, we do it here.
	gitea_cli migrate >/dev/null

	# Admin, idempotently: `user create` fails if the user exists, which is fine.
	if gitea_cli admin user list 2>/dev/null | awk '{print $2}' | grep -qx "$ADMIN_USER"; then
		echo "admin '$ADMIN_USER' exists"
	else
		gitea_cli admin user create \
			--username "$ADMIN_USER" --password "$ADMIN_PASS" --email "$ADMIN_EMAIL" \
			--admin --must-change-password=false
		echo "admin '$ADMIN_USER' created"
	fi

	if [ ! -s "$TOKEN_FILE" ]; then
		gitea_cli admin user generate-access-token \
			--username "$ADMIN_USER" --token-name "dev-$$" --scopes all --raw >"$TOKEN_FILE"
		echo "token minted"
	fi

	GITEA_WORK_DIR="$DATA" "$GITEA" web --config "$INI" >"$LOG" 2>&1 &
	echo $! >"$PID"

	i=0
	until curl -fs "$URL/api/v1/version" >/dev/null 2>&1; do
		i=$((i + 1))
		[ "$i" -gt 60 ] && die "server did not come up — see $LOG"
		sleep 0.5
	done
	echo "up at $URL ($(curl -fs "$URL/api/v1/version"))"
	echo "token: $(cat "$TOKEN_FILE")"
}

smoke() {
	[ -s "$TOKEN_FILE" ] || die "no token — run: gitea-dev.sh up"
	TOKEN="$(cat "$TOKEN_FILE")"

	# Create is idempotent for the smoke: 409 (exists) passes, anything else fails.
	code="$(curl -s -o "$DATA/create.json" -w '%{http_code}' \
		-X POST "$URL/api/v1/user/repos" \
		-H "Authorization: token $TOKEN" -H 'Content-Type: application/json' \
		-d '{"name":"spike-hello","auto_init":true,"private":true}')"
	case "$code" in
	201) echo "created repo spike-hello" ;;
	409) echo "repo spike-hello already exists" ;;
	*) die "create failed with HTTP $code: $(cat "$DATA/create.json")" ;;
	esac

	echo "repos:"
	names="$(curl -fs "$URL/api/v1/user/repos" -H "Authorization: token $TOKEN" |
		grep -o '"name":"[^"]*"' | cut -d'"' -f4 | sort -u)"
	echo "$names"
	echo "$names" | grep -qx "spike-hello" || die "spike-hello missing from the list"
	echo "smoke OK"
}

down() {
	if running; then
		kill "$(cat "$PID")"
		rm -f "$PID"
		echo "stopped"
	else
		rm -f "$PID"
		echo "not running"
	fi
}

wipe() {
	down
	rm -rf "$DATA"
	echo "wiped $DATA"
}

case "${1:-}" in
up) up ;;
smoke) smoke ;;
down) down ;;
wipe) wipe ;;
*) die "usage: gitea-dev.sh up|smoke|down|wipe" ;;
esac
