#!/usr/bin/env bash
# Render a deny-all internal boundary when identity has no platform callers.
render_identity_caddy() {
  local source=$1 destination=$2 standalone=$3
  case "$standalone" in true|false) ;; *) return 64 ;; esac
  install -m 644 "$source" "$destination"
  if [[ "$standalone" == true ]]; then
    sed -i '/not remote_ip/d' "$destination"
  fi
}
