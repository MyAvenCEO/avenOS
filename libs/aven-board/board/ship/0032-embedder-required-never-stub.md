---
title: Embedder is required — never silently fall back to stub
summary: The app silently degrades to the StubEmbedder (hashed bag-of-words) whenever EmbeddingGemma isn't loaded — feature off, weights still downloading, ORT dylib missing, or load failure (the 0031 RotaryEmbedding error). Stub vectors are keyword-overlap, not meaning, AND mixing stub+Gemma embeddings permanently corrupts the store. Make the real embedder mandatory: download-on-first-use like voice STT, hard-block the turn until ready, NEVER stub.
owner: claude (aven-os-app + frontend)
created: 2026-06-13
updated: 2026-06-13
tags: [aven-brain, embedder, models, observability]
goal: "`grep -rn \"StubEmbedder\" app/src-tauri/src/avendb/brain_ipc.rs` returns NOTHING (the app embedder path is stub-free); `cargo build -p aven-os-app --features desktop-ai` AND `cargo build -p aven-os-app` (no brain-gemma) BOTH exit 0; with `brain-gemma` ON the `AppEmbedder` enum's only inhabited-by-construction variant is `Gemma` (compile-time guarantee — no stub variant exists); `app_embedder` returns `Err(EMBED_MODEL_NOT_READY)` and triggers the download when Gemma isn't loaded, so `brain_over` NEVER constructs a Brain with a fake embedder; `embedState` readiness is wired in `+layout.svelte`; the message send is gated on embed readiness (download-on-first-use, progress shown, blocked until ready); `bun run check` = 0 errors."
---

# Embedder is required — never silently fall back to stub

## Context

`app_embedder()` (`app/src-tauri/src/avendb/brain_ipc.rs`) uses the real `GemmaEmbedder`
(EmbeddingGemma-300m) only when ALL of: the `brain-gemma` feature is compiled, the ~1.23 GB weights
are on disk, the ONNX runtime dylib resolves, and `GemmaEmbedder::load()` succeeds. If ANY fails it
**silently** returns `AppEmbedder::Stub(StubEmbedder::new(EMBED_DIM))` — the EXACT same hashed
bag-of-words fake the tests use. Stub "embeddings" are keyword overlap, not semantics, so German
paraphrases don't match — a prime cause of the "memory is quite bad" report. The only signal today
is a `log::warn`. The smoking gun is board [[0031-onnxruntime-rotaryembedding-error]]: when the ONNX
model errors, Gemma fails to load → silent stub. Worse, mixing stub + Gemma vectors in one store
**permanently degrades recall** until a full `brainReembed`.

The full download machinery already exists on both sides (`embed_status` / `embed_start_download` /
`embed:model-download` progress events in `embed_model.rs`; the `$lib/embed/model-download-store.ts`
store) — it's the EXACT flow used by voice STT / LLM / TTS. The bug is purely that the brain doesn't
*require* it: it stubs instead of waiting.

**Decisions (confirmed with the user):**
- **Never stub.** Make it a compile-time guarantee, not a runtime check — remove the `Stub` variant
  from the app embedder path entirely.
- **Download-on-first-use, like voice STT.** First brain use triggers the download.
- **Hard-block the turn until ready.** The message can't be sent until Gemma is loaded; show
  "preparing memory model… X%" with live progress (the existing embed store).
- **Desktop now, iOS later.** Enforce on desktop (`desktop-ai` already compiles `brain-gemma`). iOS
  (`--no-default-features`, no embedder) is a tracked follow-up — there `brain_over` simply errors
  (brain disabled), never stubs. A cloud (Tinfoil) embedder is a possible future always-available path.

## Goal

The on-device brain embedder is **mandatory**: real EmbeddingGemma or nothing — never a fake. A turn
that needs the brain blocks (with download progress) until the model is ready; no stub vector ever
touches the store.

**Completion condition** (identical to frontmatter `goal:`): see above.

## Approach & milestones

- **M1 — Rust: never stub (compile-time) + require + download-trigger.**
  - Delete the `Stub` variant from `AppEmbedder`; under `brain-gemma` the only constructible variant
    is `Gemma`. Keep a never-constructed `Unavailable` placeholder so the type stays inhabited on
    builds without `brain-gemma`; embedding through it is `unreachable!` (it can never fabricate a
    vector). Remove the `StubEmbedder` / `EMBED_DIM` imports.
  - `app_embedder` returns `Result<AppEmbedder, String>`: `Ok(Gemma)` when loaded; else trigger
    `ensure_download` and return `Err(EMBED_MODEL_NOT_READY)`. `brain_over` propagates the error —
    it NEVER constructs a Brain without a real embedder.
  - Proof: the `grep` invariant + both `cargo build` targets green.
- **M2 — Frontend: download-on-first-use + hard-block + progress (mirror STT/LLM).**
  - Wire `startEmbedReadiness()` in `+layout.svelte` (alongside `startAsrReadiness`) so `embedState`
    is live.
  - Gate the message send on `embedState.status === 'ready'`: if not ready, call `startEmbedDownload()`
    and surface a blocking "preparing memory model… X%" state (reuse `embedDownloadFraction`); do not
    send until ready. Recognize the backstop `EMBED_MODEL_NOT_READY` error from brain ops and route it
    to the same state rather than a generic failure.

## Files to touch

- `app/src-tauri/src/avendb/brain_ipc.rs` — `AppEmbedder`, `app_embedder`, `brain_over`, imports.
- `app/src/routes/+layout.svelte` — wire `startEmbedReadiness`.
- `app/src/lib/identities/*` (talk panel / agent send path) — the readiness gate + progress UI.

## Acceptance criteria

- [x] `grep -rn "StubEmbedder" app/src-tauri/src/avendb/brain_ipc.rs` returns nothing (✓ verified).
- [x] `cargo build -p aven-os-app --features desktop-ai` exits 0; `cargo build -p aven-os-app` exits 0
      (both verified).
- [x] `app_embedder` returns `Err(EMBED_MODEL_NOT_READY)` + triggers `ensure_download` when Gemma not
      loaded; `brain_over` resolves the embedder with `?` so it NEVER constructs a stub Brain. The
      `AppEmbedder` enum has no stub variant — only `Gemma` is constructible (compile-time guarantee).
- [x] `startEmbedReadiness` wired in `+layout.svelte`; the agent `submit()` hard-blocks the turn when
      `embedState !== ready` (triggers `startEmbedDownload`, shows "preparing memory model… X%"), and
      the roundtrip catch hard-blocks the reply on the `EMBED_MODEL_NOT_READY` backstop (load-failure
      path that slips past the download gate, e.g. the 0031 ONNX error).
- [x] `bun run check` = 0 errors / 0 warnings.

## Verification

```
grep -rn "StubEmbedder" app/src-tauri/src/avendb/brain_ipc.rs   # expect: no matches
cargo build -p aven-os-app --features desktop-ai
cargo build -p aven-os-app
cd app && bun run check
```

## Progress log

Newest entry first.

- `2026-06-13` — **Build complete (M1+M2), all gates green.**
  - **M1 (Rust)**: removed the `Stub` variant from `AppEmbedder` — under `brain-gemma` only `Gemma`
    is constructible (compile-time "never stub"); a never-built `Unavailable` placeholder keeps the
    type inhabited on no-gemma builds (embedding through it is `unreachable!`). `app_embedder` now
    returns `Result` — `Err(EMBED_MODEL_NOT_READY)` + `ensure_download` when Gemma isn't loaded;
    `brain_over` resolves it with `?` (never a stub Brain). `brain_ipc_status` reports the real
    `brain.embedder_dim()` (new accessor). Both `cargo build` targets green; `grep StubEmbedder` clean.
  - **M2 (frontend)**: wired `startEmbedReadiness` in `+layout.svelte`; the agent `submit()` hard-blocks
    the turn when the embedder isn't ready (triggers the download, shows "preparing memory model… X%");
    the brain-roundtrip catch hard-blocks the reply (no context-free answer) on the
    `EMBED_MODEL_NOT_READY` backstop. `bun run check` = 0/0.
  - Follow-ups (not in scope): iOS embedder (no `brain-gemma` there yet); a possible cloud (Tinfoil)
    embedder as an always-available path; and the underlying [[0031-onnxruntime-rotaryembedding-error]]
    load failure (now surfaced loudly instead of silently stubbed).
- `2026-06-13` — Discovery: user reported the silent stub fallback as the likely root cause of bad
  recall (confirmed via the new debug export's `trace.embedder` field plan). Forks resolved: hard-block
  the turn until ready; desktop now / iOS later. Spec written. Builds on [[0029-brain-observability-foundation]]
  and the [[0031-onnxruntime-rotaryembedding-error]] infra bug.
