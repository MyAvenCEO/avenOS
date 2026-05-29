#!/usr/bin/env bash
# Copy jazz2-upstream/crates/jazz-tools → third_party/jazz-tools and strip native-Tauri dead weight.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UPSTREAM="${ROOT}/third_party/jazz2-upstream/crates/jazz-tools"
DEST="${ROOT}/third_party/jazz-tools"
BACKUP="${ROOT}/.avenos-revendor-backup"

if [[ ! -d "$UPSTREAM" ]]; then
	echo "revendor: missing $UPSTREAM — clone jazz2-upstream first" >&2
	exit 1
fi

mkdir -p "$BACKUP"
for f in UPSTREAM.md Cargo.toml src/lib.rs src/peer_transport.rs src/avenos_client.rs tests/peer_transport_codec.rs; do
	if [[ -f "$DEST/$f" ]]; then
		backup_name="$(echo "$f" | tr '/' '_')"
		cp -f "$DEST/$f" "$BACKUP/$backup_name"
	fi
done

rm -rf "$DEST"
mkdir -p "$DEST"
rsync -a --exclude='.git' "$UPSTREAM/" "$DEST/"

# Strip server / CLI / benches / examples (AvenOS client-p2p only)
rm -rf \
	"$DEST/src/main.rs" \
	"$DEST/src/commands" \
	"$DEST/src/server" \
	"$DEST/benches" \
	"$DEST/examples" \
	"$DEST/tests/rocksdb_storage_integration.rs" \
	"$DEST/tests/sqlite_storage_integration.rs" \
	"$DEST/tests/sync_telemetry_otel.rs"

# Restore AvenOS overlays if present
for f in UPSTREAM.md Cargo.toml src/lib.rs src/peer_transport.rs src/avenos_client.rs tests/peer_transport_codec.rs; do
	backup_name="$(echo "$f" | tr '/' '_')"
	if [[ -f "$BACKUP/$backup_name" ]]; then
		mkdir -p "$DEST/$(dirname "$f")"
		cp -f "$BACKUP/$backup_name" "$DEST/$f"
	fi
done

echo "revendor: copied $(basename "$UPSTREAM") → third_party/jazz-tools (stripped server/cli/benches)"
