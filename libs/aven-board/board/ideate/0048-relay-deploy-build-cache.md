---
title: Speed up the sprite relay rebuild (~10–15 min → minutes)
summary: The CI/local relay deploy recompiles aven-node from near-scratch every time because the tarball extract resets source mtimes, defeating cargo incrementalism. Add a content-keyed cache (sccache) and/or preserve mtimes (rsync) so rebuilds are incremental.
owner: claude
created: 2026-06-14
updated: 2026-06-14
tags: [perf, ci, relay, deploy]
goal: <rough — to be made measurable in discovery>
---

# Speed up the sprite relay rebuild

## Context

Every relay deploy (`scripts/deploy-aven-node-sprite.ts`, run by the `next` CI
`deploy-relay` job and locally) takes **~10–15 min** and does NOT get faster over
time. The `target/` cargo cache IS preserved across deploys, but the deploy ships a
source **tarball** and extracts it with:

```
find . -maxdepth 1 -mindepth 1 ! -name target -exec rm -rf {} +
tar -xzf aven-src.tar.gz
```

The extract **resets every source file's mtime**, which defeats cargo's mtime-based
fingerprinting → it recompiles the workspace crates and (per the script's own comment)
RocksDB too, every time. Tarball mode exists because the Sprite's locked-down home
(`/home/sprite` `0750`) blocks a real `git` checkout (cargo's `access()` check fails),
so we can't just `git pull` to get a normal incremental tree. See memory
[[avenos-relay-sprite-deploy]] / [[avenos-next-channel-ci]].

## Goal

Rough: a typical no-source-change or small-change relay deploy should rebuild in a
few minutes (or seconds), not ~10–15 min. Make measurable in discovery (e.g. "second
consecutive deploy of the same commit finishes in < N min, proven by the deploy log
timing").

## Options to evaluate

1. **`sccache`** on the Sprite — compilation cache keyed by content hash, not mtime.
   Survives the mtime reset; biggest win is the C/C++ deps (RocksDB). Set
   `RUSTC_WRAPPER=sccache` for the on-Sprite `cargo build`. Bigger hammer, broad win.
2. **Preserve mtimes** — extract the tarball to a temp dir, then `rsync --checksum`
   into `SRC_DIR` so only genuinely-changed files get new mtimes. cargo then sees a
   normal incremental tree and recompiles just the changed crates. Cleaner
   architectural fix; needs `rsync` on the Sprite.
3. Combination (rsync for incrementalism + sccache as a safety net for cold deps).

## Next step

`/aven-discover 0048` — pick the approach, set a measurable timing goal, then build.
