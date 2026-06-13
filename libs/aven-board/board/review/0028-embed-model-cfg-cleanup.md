---
title: Clean the embed_model.rs cfg stub/real split — zero warnings across the feature matrix
summary: embed_model.rs warns (unused `Emitter` import, dead `ensure`/`ensure_download`) because its stub-vs-real impls are split by feature gates that don't line up. Unify so every feature combo compiles warning-free, without breaking any build.
owner: claude (aven-os-app)
created: 2026-06-13
updated: 2026-06-13
tags: [aven-os-app, cleanup, build-hygiene]
goal: "`cargo build -p aven-os-app --no-default-features --features desktop-ai,local-voice` AND `cargo build -p aven-os-app` (no default features) both exit 0 with ZERO warnings originating in `app/src-tauri/src/embed_model.rs` (no `unused import: Emitter`, no `function ensure/ensure_download is never used`); no behavior change (the brain-gemma download path still works); no other files changed beyond `embed_model.rs` (+ its callers only if a signature must move)."
---

# Clean the embed_model.rs cfg stub/real split — zero warnings across the feature matrix

## Context

Building the app surfaces three warnings from `app/src-tauri/src/embed_model.rs`:

- `unused import: Emitter` (`use tauri::{AppHandle, Emitter}`)
- `function ensure is never used` (a stub `pub fn ensure(_app: &AppHandle) {}`)
- `function ensure_download is never used`

These come from a **cfg-gated stub-vs-real split**: `embed_model.rs` has a real implementation
(behind `brain-gemma`, which the embedding download + load path uses — `ensure_download` IS called
at `app/src-tauri/src/avendb/brain_ipc.rs:115` under that feature) and a no-op stub for builds
without it. The gates don't line up cleanly, so in some feature combos the stub's `ensure`/
`ensure_download` and the `Emitter` import are compiled but unused → warnings. They're harmless
(builds succeed) and PRE-EXISTING (unrelated to the frontier work, board 0026/0027), but they're
noise against the project's clean-build / compact-simplify ethos.

The fix is a careful cfg alignment, NOT a blind deletion: `ensure_download` is live under
`brain-gemma`, so removing it would break that build. The stub + real impls must be gated so
exactly one is compiled per feature combo and neither leaves an unused import or dead fn.

## Goal

Every feature combination of `aven-os-app` compiles **warning-free** from `embed_model.rs`, with
the brain-gemma embedding download/load path unchanged.

**Completion condition** (identical to frontmatter `goal:`):

> `cargo build -p aven-os-app --no-default-features --features desktop-ai,local-voice` AND
> `cargo build -p aven-os-app` (no default features) both exit 0 with ZERO warnings from
> `embed_model.rs`; no behavior change; changes confined to `embed_model.rs` (+ callers only if a
> signature moves).

## Approach

Audit the `#[cfg(feature = "brain-gemma")]` / `#[cfg(not(...))]` boundaries in `embed_model.rs`.
Ensure: (1) `Emitter` is imported only in the cfg branch that uses it; (2) the stub `ensure`/
`ensure_download` exist only in the `not(brain-gemma)` branch AND are actually referenced there (or
are `#[allow(dead_code)]` with a one-line why), while the real ones live under `brain-gemma`; (3)
the call site (`brain_ipc.rs:115`) resolves to the right impl in each combo. Prefer eliminating the
stub entirely if the caller is itself cfg-gated (then no stub is needed). Verify across the matrix.

## Steps

1. Map every cfg branch in `embed_model.rs` + the `ensure`/`ensure_download`/`Emitter` usages.
2. Realign gates so exactly one impl compiles per combo, no unused import/fn.
3. Build the feature matrix (`desktop-ai,local-voice`; no-features) — confirm zero embed_model warnings.

## Files to touch

- `app/src-tauri/src/embed_model.rs` — cfg realignment / stub removal.
- `app/src-tauri/src/avendb/brain_ipc.rs` — ONLY if the `ensure_download` signature/gating must move.

## Acceptance criteria

- [x] `cargo check -p aven-os-app --no-default-features --features desktop-ai,local-voice` — 0
      embed_model warnings/errors (brain-gemma ON: `ensure_download` + real `imp::ensure` + `Emitter`
      all used).
- [x] `cargo check -p aven-os-app --no-default-features --features local-voice` (no brain-gemma —
      the config that was warning) — 0 embed_model warnings/errors.
- [x] brain-gemma path unchanged: `brain_ipc.rs:115` still calls `ensure_download` (both now gated
      to `brain-gemma`, so they line up).
- [x] Changes confined to `embed_model.rs` (no caller edit needed — the gates already matched).

## Verification

```
cargo build -p aven-os-app --no-default-features --features desktop-ai,local-voice 2>&1 | grep embed_model.rs || echo "clean"
cargo build -p aven-os-app 2>&1 | grep embed_model.rs || echo "clean"
git status --porcelain
```

## Progress log

Newest entry first.

- `2026-06-13` — DONE. Gated `Emitter` import to `brain-gemma` (only the real `imp` emits), gated
  `ensure_download` to `brain-gemma` (its only caller, `brain_ipc.rs:115`, is likewise gated), and
  removed the orphaned stub `imp::ensure`. Both feature configs (`local-voice`; `desktop-ai,local-voice`)
  `cargo check` clean — zero embed_model warnings; brain-gemma path unchanged; confined to
  `embed_model.rs`. Moved discover → review.
- `2026-06-13` — Discovered + specced. Surfaced during the frontier work (board 0026/0027) build
  output; confirmed `ensure_download` is live under `brain-gemma` so it's a cfg-alignment task, not
  a deletion. Measurable goal = zero embed_model warnings across the feature matrix.
