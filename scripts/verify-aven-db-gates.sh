#!/usr/bin/env bash
# Verification gates after jazz2 re-vendor (libs/aven-db). Requires Rust 1.93.1.
#
# Single Cargo target for the whole repo: AvenOS/.cargo/config.toml → target/rust/
# Do not run parallel `cargo` on that directory — if file-locked, stop other cargo processes first.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export RUSTUP_TOOLCHAIN="${RUSTUP_TOOLCHAIN:-1.93.1}"

echo "== cargo check macOS (app/src-tauri; builds aven-db once) =="
cd "$ROOT/app/src-tauri"
cargo check

echo "== peer_transport_codec (reuses target/rust) =="
cargo test --manifest-path "$ROOT/libs/aven-db/Cargo.toml" --features client-p2p --test peer_transport_codec

echo "== cargo check iOS =="
cargo check --target aarch64-apple-ios

echo "== bun run check (app) =="
cd "$ROOT/app"
bun run check

echo "verify-aven-db-gates: all automated gates passed"
