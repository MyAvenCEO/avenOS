# Rust build efficiency (target/ disk usage)

## Why `target/` grew to 120 GB

Cargo has **no garbage collector** for `target/`. Every time a build's inputs
change — a `Cargo.lock` bump, a feature flag, a rustc/toolchain update — Cargo
writes the new artifacts into a fresh content-hash directory and **leaves the old
one behind forever**. Over months of development this accumulates:

| Cause | Was | Notes |
|---|---|---|
| Stale `librocksdb-sys` native rebuilds | ~15 GB | **18 copies** in `debug/` alone, each a full ~1.5 GB C++ RocksDB compile from a past lockfile/feature variant. |
| `debug/deps` superseded artifacts | ~38 GB | Old `.rlib`/`.rmeta` never pruned. |
| `incremental/` on **release** triples | ~7.5 GB | Incremental only speeds iterative dev; on iOS/macOS release builds it's dead weight (leaked from the repo-wide `[build] incremental = true`). |
| `target/rust-dev-b` (2x dev harness) | ~0.7 GB | **Not** the problem — see below. |

The two-instance dev harness (`dev:app2x:mac`) uses a **separate**
`CARGO_TARGET_DIR` (`target/rust-dev-b`) on purpose: Cargo takes an exclusive
build-lock on a target dir, so two concurrent `cargo` processes can't share one.
That dir is tiny; the bloat is **temporal** (hoarded history), not the two
instances.

## The setup that keeps it efficient

### 1. sccache — shared compiler cache (per machine)

Configured in **`~/.cargo/config.toml`** (per-machine, *not* committed):

```toml
[build]
rustc-wrapper = "sccache"
[env]
CC = "sccache cc"
CXX = "sccache c++"
```

This is what makes the two dev instances genuinely cheap and stops RocksDB from
recompiling on every lockfile bump: the C++ objects compile **once globally** and
are reused across `target/rust`, `target/rust-dev-b`, and every future hash
variant. Measured: a full RocksDB C++ build dropped from minutes to **~372 cache
hits served instantly**, with the whole cache only **~163 MiB** (compressed) vs
1.5 GB per uncached build.

> **Why not commit it to the repo `.cargo/config.toml`?** That file ships in the
> Sprite deploy source tarball and is read by CI and other devs — none of which
> have sccache. A committed `rustc-wrapper = "sccache"` would break those builds
> with "sccache not found". Keep it per-machine.

Install: `brew install sccache`. Inspect: `sccache --show-stats`.

### 2. Release incremental off

`app/src-tauri/Cargo.toml` sets `[profile.release] incremental = false` so the
repo-wide dev `incremental = true` no longer leaks ~7.5 GB into release builds.

### 3. Periodic GC — `bun run gc:rust`

Reclaims stale artifacts **without a full rebuild** (sccache makes any forced
recompile cheap anyway):

```bash
bun run gc:rust          # keep last 7 days
DAYS=14 bun run gc:rust  # keep last 14 days
```

It drops release-incremental dirs, prunes all-but-newest RocksDB native builds,
and runs `cargo-sweep` (timestamp GC) over `target/rust`. Install the sweeper
once: `cargo install cargo-sweep`.

For a full reset (forces a clean rebuild), `bun run clean:app:rust` still exists.
