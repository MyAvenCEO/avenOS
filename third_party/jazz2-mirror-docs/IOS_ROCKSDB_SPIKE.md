# iOS RocksDB spike — upstream `jazz-tools` (alpha.50 mirror)

Mandatory gate before full re-vendor of `third_party/jazz-tools`. **No SQLite** — RocksDB only.

## Pin

See [VENDOR_PIN.md](./VENDOR_PIN.md): git `232a9933`, npm **2.0.0-alpha.50**.

## Command

```bash
cd third_party/jazz2-upstream
rustup target add aarch64-apple-ios --toolchain 1.93.1-aarch64-apple-darwin  # required once per machine
cargo build -p jazz-tools --target aarch64-apple-ios --no-default-features --features client,rocksdb
```

Upstream `rust-toolchain.toml` pins **1.93.1** (AvenOS app workspace currently uses **1.88.0** via repo toolchain — align on re-vendor).

## AvenOS app after physical strip (`bfbc0d1`)

| Check | Result | Notes |
|---|---|---|
| `cd app/src-tauri && cargo check` | **PASS** | macOS host, stripped vendored fork |
| `cd app/src-tauri && cargo check --target aarch64-apple-ios` | **PASS** | ~2m 50s, dev profile |

## Isolated upstream spike

| Attempt | Result | Duration | Error / fix |
|---|---|---|---|
| 1 | **FAIL** | ~4m (partial compile) | `error[E0463]: can't find crate for core` — `aarch64-apple-ios` std not installed for **1.93.1** toolchain used by `jazz2-upstream/rust-toolchain.toml` |
| 2 (after `rustup target add aarch64-apple-ios --toolchain 1.93.1-aarch64-apple-darwin`) | **PASS** | **8m 34s** (515s) | `Finished dev profile`; `rust-rocksdb` + `jazz-tools` linked for iOS |

## Verdict

**Spike PASS** — upstream `jazz-tools` with `client,rocksdb` builds for `aarch64-apple-ios` on the alpha.50 mirror.

## Blockers for full re-vendor

| Item | Severity | Notes |
|---|---|---|
| Toolchain version gap (1.88 vs 1.93.1) | Plan | Decide whether AvenOS bumps `rust-toolchain` with re-vendor or pins upstream build to 1.88 |
| AvenOS P2P patches | Expected | `peer_transport`, fanout, `client-p2p` — not validated in isolated spike |
| Full workspace `cargo build` on iOS | Deferred | User stopped before full re-vendor / graph spike |

## Next step (out of scope here)

Replace `third_party/jazz-tools` from `crates/jazz-tools`, re-port patches, wipe `groove.surrealkv` → `jazz.rocksdb`.
