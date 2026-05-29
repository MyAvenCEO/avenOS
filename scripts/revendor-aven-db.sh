#!/usr/bin/env bash
# DEPRECATED — aven-db is a permanent AvenOS fork; do not re-copy from jazz2-upstream.
set -euo pipefail

cat >&2 <<'EOF'
revendor-aven-db.sh is deprecated.

libs/aven-db is a full AvenOS fork (see libs/aven-db/UPSTREAM.md).
Edit libs/aven-db in place; do not rsync from tools/jazz2-upstream.

Use: bash ./scripts/verify-aven-db-gates.sh
EOF
exit 1
