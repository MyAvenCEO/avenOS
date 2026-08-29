#!/bin/sh
set -eu

state=${BACKUP_STATE_ROOT:-/var/lib/aven-backups}/last-success
[ -r "$state" ] || { echo 'no successful backup recorded' >&2; exit 1; }
last=$(cut -d' ' -f1 < "$state")
timestamp=$(cut -d' ' -f2 < "$state")
case "$last" in *[!0-9]*|'') echo 'invalid backup success marker' >&2; exit 1 ;; esac
now=$(date -u +%s)
maximum=${BACKUP_MAX_AGE_SECONDS:-7200}
[ $((now - last)) -le "$maximum" ] || { echo "backup is stale: $timestamp" >&2; exit 1; }
echo "backup current: $timestamp"
