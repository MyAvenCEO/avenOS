---
title: VAD-chunked Parakeet transcription — long voice notes never hang, stream partials
summary: Stop long mic recordings from stalling by transcribing them as bounded Silero-VAD speech segments through the existing Parakeet recognizer (instead of one whole-recording decode), emitting an incremental partial per segment and honoring a cancel flag. Keeps Parakeet; no new crate (sherpa-onnx 1.13 already ships the VAD).
owner: unassigned
created: 2026-06-22
updated: 2026-06-22
tags: [stt, asr, audio, tauri, rust, on-device]
# goal — single completion condition, provable from transcript command output.
goal: >-
  Voice notes from ~5s to ~10min transcribe in bounded time without hanging:
  `transcribe_audio` runs the existing Parakeet `OfflineRecognizer` over
  Silero-VAD speech segments — each hard-capped to a max window by a pure planner
  so no single decode is unbounded — instead of one whole-recording decode, emits
  an `asr:transcribe-progress` partial (cumulative text + fraction) per segment,
  and the decode loop honors a `cancelled` flag. The VAD model downloads/caches
  next to Parakeet (no new crate; sherpa-onnx 1.13 supplies `VoiceActivityDetector`).
  Proven from the transcript by: `cargo test -p aven-ai --features stt` green
  including new `split_into_windows` + `merge_segment_texts` unit tests; `cargo
  check -p aven-ai --features stt` and `cargo clippy -p aven-ai --features stt --
  -D warnings` exit 0; from `app/src-tauri`, `cargo check` (default features) and
  `cargo check --features local-voice` + `cargo clippy --features local-voice --
  -D warnings` exit 0; from `app/`, `bun --bun x svelte-kit sync && bun --bun x
  svelte-check --tsconfig ./tsconfig.json` exits 0 and `bun test tests` is green
  including the transcribe-progress store test; `bunx biome check <changed files>`
  exits 0 (repo baseline is not biome-clean, so the gate is scoped to changed
  files); `rg -n "VoiceActivityDetector|silero" libs/aven-ai/src/stt.rs` and `rg
  -n "asr:transcribe-progress" app/src-tauri/src/asr.rs app/src` show the VAD wired
  and the progress event emitted + consumed; and `git status --porcelain` lists
  only files in "Files to touch" (plus lockfiles). A live 10-min mic transcription
  (needs weights + a real mic) is a manual post-build check.
---

# VAD-chunked Parakeet transcription — long voice notes never hang, stream partials

## Context

The on-device STT today (shipped in [0005](../ship/0005-gemma-voice-transcription.md),
which evolved from Gemma E4B to **NVIDIA Parakeet-TDT via sherpa-onnx**) does a
**single whole-recording decode**:

```rust
// libs/aven-ai/src/stt.rs:161
pub fn transcribe(&self, pcm: &[f32], sample_rate: u32) -> String {
    let stream = self.rec.create_stream();
    stream.accept_waveform(sample_rate as i32, pcm);  // the ENTIRE recording at once
    self.rec.decode(&stream);                          // one unbounded decode
    stream.get_result().map(|r| r.text).unwrap_or_default()
}
```

The recognizer is a sherpa-onnx `OfflineRecognizer` (offline/batch — **not** an
online/streaming recognizer). The webview (`IntentComposer.svelte`) accumulates
every PCM chunk in memory with no cap and submits the whole buffer to
`transcribe_audio` only after recording stops. On a long recording this means:
nothing transcribes until stop, then one decode runs to completion with **no
timeout, no cancel, no progress** — so a long note looks frozen and can appear to
"never transcribe."

**Decision (user):** keep Parakeet; fix it with **chunked batch** decode, made
**VAD-aware** so chunks fall on natural silences. Reliability **and**
responsiveness both matter; target range **~5s to ~10min** per note.

**Key enabler:** sherpa-onnx **1.13 (already our dependency)** ships a
`VoiceActivityDetector` with `VadModelConfig` (Silero + TEN VAD), `accept_waveform`
→ `front`/`pop` yielding bounded `SpeechSegment`s, plus a `max_speech_duration`
cap. So VAD-aware chunking needs **no new crate** — only a tiny (~1–2 MB) Silero
VAD model file alongside Parakeet. Because the VAD lives in the Rust binding, the
chunking belongs in the **Rust backend** (the existing `spawn_blocking` decode
thread), which also lets Rust emit progress events natively.

VAD-model research (top 3, as requested): **Silero VAD** (~1–2 MB, MIT,
widest-tested in sherpa-onnx — chosen), **TEN VAD** (~306 KB, Apache-2.0, ~32%
faster RTF — easy swap later via the shared `VadModelConfig`), **WebRTC VAD**
(158 KB GMM, lowest accuracy and **not** in sherpa-onnx → would need a separate
crate, rejected).

## Goal

A voice note of any practical length (≈5s–10min) transcribes in **bounded time**
and **never hangs**, showing **incremental partial text** as it goes, by decoding
**Silero-VAD speech segments** through the existing Parakeet recognizer instead of
one whole-recording decode — and the work is **cancellable**.

**Completion condition** (identical to frontmatter `goal`):

> Voice notes from ~5s to ~10min transcribe in bounded time without hanging:
> `transcribe_audio` runs the existing Parakeet `OfflineRecognizer` over
> Silero-VAD speech segments — each hard-capped to a max window by a pure planner
> so no single decode is unbounded — instead of one whole-recording decode, emits
> an `asr:transcribe-progress` partial per segment, and the decode loop honors a
> `cancelled` flag; the VAD model caches next to Parakeet (no new crate). Proven
> by the cargo test/check/clippy + bun check/test + biome + rg + git-status
> commands in the frontmatter `goal`. No files outside "Files to touch" change.

> Note: a real transcription run needs the Parakeet + Silero weights and a real
> microphone, **neither of which exists in CI** (same constraint as 0005). The
> goal is written so every clause is provable from `cargo
> test`/`check`/`clippy`, `bun check`/`test`, `biome`, and `rg` — the segment
> **planner** and transcript **merge** are pure and unit-tested without the model;
> the VAD/decode wiring is compiled + grep-verified; a live long-recording
> transcript is a manual, post-build check.

## Approach

Five pieces: **pure planner**, **VAD segmentation**, **segmented decode +
cancel/progress in `aven-ai`**, **VAD model download/cache**, **Tauri event +
webview partials**.

### 1. Pure, testable segment planner (`stt.rs`)

A pure function `split_into_windows(total_samples, sample_rate, max_window_secs,
overlap_secs) -> Vec<Range>` that tiles a length into bounded windows with a small
overlap and full coverage. Two jobs:

- **Fallback** when VAD is unavailable (model missing / load error) — degrade to
  fixed windows rather than the old unbounded decode.
- **Hard cap on VAD output**: any `SpeechSegment` longer than `max_window_secs`
  (continuous speech with no pause) is further split by this planner, so **no
  single `decode()` is ever unbounded** — this is the core anti-hang guarantee.

Pure ⇒ unit-testable without any model: covers a 10-min buffer into windows each
`≤ max_window_secs`, with the configured overlap and gap-free coverage.

A second pure helper `merge_segment_texts(parts: &[String]) -> String` joins
per-segment transcripts (trim + single-space, skip empties) — also unit-tested.

### 2. VAD segmentation via sherpa-onnx (`stt.rs`)

Add a `Vad` wrapper around sherpa-onnx `VoiceActivityDetector` configured with
**Silero VAD** (`VadModelConfig`/`SileroVadConfig`, `max_speech_duration` set to
our `max_window_secs`). Feed the full PCM via `accept_waveform`, drain
`front`/`pop` into `SpeechSegment`s, then apply the planner's hard cap (§1) to
each. Silence between segments is dropped (a quality/perf win on long notes).

### 3. Segmented decode with cancel + progress (`stt.rs`)

New method, leaving the existing `transcribe`/`transcribe_words` untouched:

```rust
pub fn transcribe_segmented(
    &self,
    pcm: &[f32],
    sample_rate: u32,
    vad: Option<&Vad>,
    cancelled: &dyn Fn() -> bool,          // mirrors the download `cancelled` predicate
    on_partial: &mut dyn FnMut(SegmentProgress), // cumulative text + (done, total)
) -> String
```

For each planned segment: bail if `cancelled()`, `create_stream` →
`accept_waveform(segment)` → `decode` → `get_result`, append to the running
transcript via `merge_segment_texts`, and call `on_partial` with the cumulative
text and `segment_index/segment_count`. Returns the full transcript. The
`cancelled`/progress shape mirrors the module's existing download contract (the
file already passes a `cancelled` predicate + progress sink for downloads).

### 4. VAD model download/cache (`stt.rs`)

Add a `ModelSpec`-style entry (or a small dedicated downloader) for the Silero VAD
ONNX into the same models root as Parakeet, reusing the existing download/extract
+ `files_present` machinery. If the VAD file is absent, segmentation falls back to
the §1 fixed-window planner (still bounded — no regression to the old hang).

### 5. Tauri progress event + webview partials (`asr.rs`, app)

- In `app/src-tauri/src/asr.rs`, add `pub const PROGRESS_EVENT: &str =
  "asr:transcribe-progress"` and have `transcribe` (the real `imp::transcribe`)
  call `transcribe_segmented`, mapping each `on_partial` to
  `app.emit(PROGRESS_EVENT, { text, done, total })` (throttled), mirroring the
  existing `DOWNLOAD_EVENT`/`emit` pattern. Wire a `cancelled` source (reuse the
  epoch/cancel state already in `asr.rs`).
- The final `VoiceNote` is returned as today (full transcript + derived title).
- App side: a small listener (in `transcribe.ts` / the asr store) surfaces the
  cumulative partial so `IntentComposer` can show streaming text + a percent
  while the decode runs. Keep the existing final-submit path
  (`onSubmitMessage(transcript, [])`) unchanged.

### Out of scope

- True online/streaming Parakeet (swapping to an `OnlineRecognizer`) — explicitly
  not doing it; we keep the offline recognizer and chunk around it.
- Diarization, language UI, translation, punctuation post-processing.
- Re-architecting the webview's in-memory PCM accumulation (the 10-min target fits
  in memory; unbounded-length streaming-to-disk is a later card if needed).
- TEN VAD (kept as a trivial future swap via the shared `VadModelConfig`).

## Steps

1. **Planner + merge (pure):** add `split_into_windows` + `merge_segment_texts`
   to `stt.rs` with unit tests (`#[cfg(test)]`), no model needed.
2. **VAD wrapper:** add `Vad` over sherpa-onnx `VoiceActivityDetector` (Silero),
   `max_speech_duration = max_window_secs`.
3. **Segmented decode:** add `transcribe_segmented(... cancelled, on_partial ...)`;
   apply the §1 hard cap to every segment; leave existing methods intact.
4. **VAD model download:** add the Silero VAD spec/download into the models root,
   reusing existing download/extract; fall back to fixed-window planner if absent.
5. **Tauri wiring:** add `PROGRESS_EVENT`, route `imp::transcribe` through
   `transcribe_segmented`, emit throttled partials, pass a cancel source.
6. **Webview partials:** listen for `asr:transcribe-progress`; show cumulative
   text + percent in `IntentComposer`; final submit unchanged.
7. **JS test:** unit-test the progress reducer (events → accumulated partial text
   + fraction).
8. **Verify:** run all commands below; check off criteria; update Progress log;
   `git mv` discover → build (via `/aven-build`).

## Files to touch

- `libs/aven-ai/src/stt.rs` — `split_into_windows` + `merge_segment_texts` (pure,
  tested), `Vad` wrapper (Silero `VoiceActivityDetector`), `transcribe_segmented`
  (cancel + per-segment progress), Silero VAD `ModelSpec`/download; existing
  `transcribe`/`transcribe_words` untouched.
- `app/src-tauri/src/asr.rs` — `PROGRESS_EVENT = "asr:transcribe-progress"`; route
  `imp::transcribe` through `transcribe_segmented`; emit throttled partials; pass
  a `cancelled` source from the existing epoch/cancel state.
- `app/src/lib/intent-mock/transcribe.ts` — listen for `asr:transcribe-progress`,
  expose cumulative partial + fraction to the caller.
- `app/src/lib/intent-mock/IntentComposer.svelte` — render streaming partial text
  + percent during transcription (final submit path unchanged).
- `app/src/lib/asr/model-download-store.ts` *(or a small new helper)* — reducer
  mapping `asr:transcribe-progress` events → `{ text, fraction }` (unit-tested).
- `app/tests/transcribe-progress.test.ts` — **new**: progress-reducer unit test.
- `libs/aven-ai/Cargo.toml` / `app/src-tauri/Cargo.toml` — only if a new
  feature-gated dep is needed (expected: **none** — sherpa-onnx 1.13 already ships
  the VAD); lockfiles may update.

## Acceptance criteria

Each box must be checkable from the transcript (a command + its output proves it).

- [ ] `cargo test -p aven-ai --features stt` is green, including new
  `split_into_windows` (10-min buffer → windows each ≤ max, correct overlap, full
  coverage) and `merge_segment_texts` tests.
- [ ] `cargo check -p aven-ai --features stt` and `cargo clippy -p aven-ai
  --features stt -- -D warnings` exit 0.
- [ ] From `app/src-tauri`: `cargo check` (default features) exits 0 **and** `cargo
  check --features local-voice` + `cargo clippy --features local-voice -- -D
  warnings` exit 0.
- [ ] From `app/`: `bun --bun x svelte-kit sync && bun --bun x svelte-check
  --tsconfig ./tsconfig.json` exits 0.
- [ ] From `app/`: `bun test tests` is green, including the transcribe-progress
  reducer test.
- [ ] `bunx biome check <changed files>` exits 0 (scoped to changed files; repo
  baseline is not biome-clean).
- [ ] `rg -n "VoiceActivityDetector|silero" libs/aven-ai/src/stt.rs` shows Silero
  VAD wired, and `rg -n "transcribe_segmented" libs/aven-ai/src/stt.rs
  app/src-tauri/src/asr.rs` shows the segmented path is the one used.
- [ ] `rg -n "asr:transcribe-progress" app/src-tauri/src/asr.rs app/src` shows the
  progress event emitted (Rust) and consumed (webview).
- [ ] `rg -n "cancelled" libs/aven-ai/src/stt.rs` shows the decode loop checks a
  cancel flag (per-segment).
- [ ] `git status --porcelain` lists only files in "Files to touch" (plus
  lockfiles).

## Verification

```bash
# rust core (aven-ai)
cargo test  -p aven-ai --features stt
cargo check -p aven-ai --features stt
cargo clippy -p aven-ai --features stt -- -D warnings

# rust backend (src-tauri)
cd app/src-tauri
cargo check                                  # default features stay green
cargo check  --features local-voice
cargo clippy --features local-voice -- -D warnings
cd ../..

# app workspace
cd app
bun --bun x svelte-kit sync
bun --bun x svelte-check --tsconfig ./tsconfig.json
bun test tests
cd ..

# changed-file lint (repo baseline is not biome-clean)
bunx biome check <changed files>

# guard greps (from repo root)
rg -n "VoiceActivityDetector|silero" libs/aven-ai/src/stt.rs
rg -n "transcribe_segmented" libs/aven-ai/src/stt.rs app/src-tauri/src/asr.rs
rg -n "asr:transcribe-progress" app/src-tauri/src/asr.rs app/src
rg -n "cancelled" libs/aven-ai/src/stt.rs
git status --porcelain
```

Live check is **manual, post-build** (needs Parakeet + Silero weights + a mic):
build with `--features local-voice`, run the app, record a ~10-min voice note in a
spark `/talk`, and confirm partial text streams in and the full transcript posts
without hanging.

## Hand-off

```
/aven-build 0055
```

…or hand the condition straight to the built-in loop:

```
/goal <paste the Completion condition above>
```

## Progress log

Newest entry first.

- `2026-06-22` — Discovery: specced directly into `discover/` (no prior ideate
  card; this is the follow-on to shipped 0005). Uncovered the goal (reliability +
  responsiveness for ~5s–10min notes), chose **VAD-chunked batch decode keeping
  Parakeet**, and confirmed **sherpa-onnx 1.13 already ships `VoiceActivityDetector`
  (Silero/TEN)** → no new crate. Decisions locked: chunking in the **Rust
  backend**, **Silero VAD** boundaries with a pure hard-cap planner (anti-hang
  guarantee) + fixed-window fallback, and **incremental `asr:transcribe-progress`
  partials**. Made "done" provable from `cargo test/check/clippy` (pure planner +
  merge unit tests), `bun check/test`, `biome`, and `rg` — live long-recording
  transcript is a manual post-build check.
```
