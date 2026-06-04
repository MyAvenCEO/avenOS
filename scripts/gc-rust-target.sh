#!/usr/bin/env bash
# Reclaim disk from the Rust build cache WITHOUT a full rebuild.
#
# Cargo never garbage-collects target/: every Cargo.lock bump, feature change, or
# rustc update leaves the previous build's artifacts behind forever. Over months
# that grows to 100+ GB (e.g. 18 stale 1.5 GB RocksDB C++ rebuilds, tens of GB of
# superseded deps). This prunes the dead artifacts; sccache (~/.cargo/config.toml)
# then makes any forced recompile cheap. See docs/RustBuildEfficiency.md.
#
# Usage: bun run gc:rust            # keep last 7 days of artifacts (default)
#        DAYS=14 bun run gc:rust    # keep last 14 days
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
target="$repo_root/target/rust"
days="${DAYS:-7}"

if [ ! -d "$target" ]; then
  echo "no target dir at $target — nothing to GC"
  exit 0
fi

before=$(du -sh "$target" 2>/dev/null | cut -f1)
echo "target/rust before: $before"

# 1) Drop release-target incremental dirs (incremental only helps iterative dev;
#    on the iOS/macOS release triples it is pure waste).
find "$target" -type d -path '*/release/incremental' -prune -exec rm -rf {} + 2>/dev/null || true

# 2) Keep only the newest native RocksDB build per build dir; the rest are stale
#    1.5 GB C++ rebuilds from past lockfile/feature variants.
for builddir in "$target"/debug/build "$target"/*/release/build "$target"/*/debug/build; do
  [ -d "$builddir" ] || continue
  ( cd "$builddir" && ls -dt rust-librocksdb-sys-*/ 2>/dev/null | tail -n +2 \
      | while read -r d; do rm -rf "$d"; done ) || true
done

# 3) Timestamp-based GC of everything else not touched in the last $days days.
if command -v cargo-sweep >/dev/null 2>&1; then
  ( cd "$repo_root/app/src-tauri" && cargo-sweep sweep --time "$days" ) || true
else
  echo "cargo-sweep not installed — skipping dep GC (cargo install cargo-sweep)"
fi

after=$(du -sh "$target" 2>/dev/null | cut -f1)
echo "target/rust after:  $after"
command -v sccache >/dev/null 2>&1 && sccache --show-stats 2>/dev/null | grep -iE "Cache size|Compile requests$" || true
