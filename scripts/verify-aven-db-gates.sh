#!/usr/bin/env bash
# Verification gates after jazz2 re-vendor (libs/aven-db). Toolchain: app/src-tauri/rust-toolchain.toml.
#
# Single Cargo target for the whole repo: AvenOS/.cargo/config.toml → target/rust/
# Do not run parallel `cargo` on that directory — if file-locked, stop other cargo processes first.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -z "${RUSTUP_TOOLCHAIN:-}" ]]; then
  RUSTUP_TOOLCHAIN="$(grep -E '^[[:space:]]*channel[[:space:]]*=' app/src-tauri/rust-toolchain.toml 2>/dev/null | sed -E 's/.*"([^"]+)".*/\1/')"
  RUSTUP_TOOLCHAIN="${RUSTUP_TOOLCHAIN:-1.93.1}"
fi
export RUSTUP_TOOLCHAIN

echo "== cargo check macOS (app/src-tauri; builds aven-db once) =="
cd "$ROOT/app/src-tauri"
cargo check

echo "== sync_transport_codec + sync_core (reuses target/rust) =="
cargo test --manifest-path "$ROOT/libs/aven-db/Cargo.toml" --features client-p2p --test sync_transport_codec
cargo test --manifest-path "$ROOT/libs/aven-db/Cargo.toml" --features client-p2p --test sync_core

echo "== cargo check iOS =="
cargo check --target aarch64-apple-ios

echo "== bun run check (app) =="
cd "$ROOT/app"
bun run check

echo "verify-aven-db-gates: all automated gates passed"
