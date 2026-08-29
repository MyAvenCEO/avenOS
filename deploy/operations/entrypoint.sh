#!/bin/sh
set -eu

case "${1:-loop}" in
  backup) exec /operations/backup.sh ;;
  health) exec /operations/healthcheck.sh ;;
  restore) shift; exec /operations/restore.sh "$@" ;;
  loop)
    interval=${BACKUP_INTERVAL_SECONDS:-3600}
    case "$interval" in *[!0-9]*|'') echo 'invalid backup interval' >&2; exit 64 ;; esac
    while :; do
      if /operations/backup.sh; then
        sleep "$interval" & wait $!
      else
        # Retry transient provider/database failures without a tight loop.
        sleep 300 & wait $!
      fi
    done
    ;;
  *) echo 'usage: entrypoint.sh [loop|backup|health|restore]' >&2; exit 64 ;;
esac
