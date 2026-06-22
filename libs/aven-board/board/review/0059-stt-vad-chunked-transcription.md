---
title: Live VAD-streamed Parakeet transcription — long voice notes never hang, partials stream while you talk
summary: Stop long mic recordings from stalling by streaming PCM to the backend during capture, where a Silero-VAD-driven session closes a speech segment on each natural pause (or a 30s safety cap) and decodes it once with Parakeet — no re-decoding, no unbounded decode. Partials preview live while you talk; the final transcript posts to the chat on stop. Keeps Parakeet; no new crate (sherpa-onnx 1.13 ships the VAD).
owner: unassigned
created: 2026-06-22
updated: 2026-06-22
tags: [stt, asr, audio, tauri, rust, on-device, streaming]
# goal — single completion condition, provable from transcript command output.
goal: >-
  Voice notes of any practical length (~5s to 10min+) transcribe live without
  hanging: while the mic records, PCM streams to the backend via
  `asr_stream_start`/`asr_stream_feed`/`asr_stream_finish`, where a
  Silero-VAD-driven `StreamTranscriber` closes a speech segment on each natural
  pause (or a 30s safety cap) and decodes it **once** with the Parakeet recognizer
  — no re-decoding and no unbounded decode (a pure `split_into_windows` planner
  re-splits any over-cap run) — emitting an `asr:transcribe-progress` partial per
  segment shown as a preview; on stop the session flushes the trailing speech and
  the final transcript is the only thing posted to the chat. The Silero VAD v5
  model caches next to Parakeet (no new crate; sherpa-onnx 1.13 supplies
  `VoiceActivityDetector`). Proven from the transcript by: `cargo test --lib
  --features stt` (in `libs/aven-ai`) green incl. `split_into_windows` +
  `merge_segment_texts` tests; `cargo clippy --lib --features stt -- -D warnings`
  exit 0; from `app/src-tauri`, `cargo check --features local-voice` exit 0; from
  `app/`, `bun --bun x svelte-kit sync && bun --bun x svelte-check` exit 0 and `bun
  test tests` green incl. the transcribe-progress test; `bunx biome check <changed
  files>` exit 0 (repo baseline isn't biome-clean, so scoped to changed files);
  `rg -n "VoiceActivityDetector|silero" libs/aven-ai/src/stt.rs`, `rg -n
  "StreamTranscriber" libs/aven-ai/src/stt.rs app/src-tauri/src/asr.rs`, and `rg -n
  "asr:transcribe-progress|asr_stream_" app/src-tauri/src app/src` show the VAD +
  streaming path wired, the event emitted + consumed, and the commands registered.
  (In this sandbox the cargo runs need `SHERPA_ONNX_ARCHIVE_DIR` pointing at the
  prebuilt sherpa archive and the GTK/webkit2gtk dev libs installed; a live mic
  transcript is a manual post-build check.)
---

# Live VAD-streamed Parakeet transcription

## Context

The on-device STT shipped in [0005](../ship/0005-gemma-voice-transcription.md)
(which evolved from Gemma E4B to **NVIDIA Parakeet-TDT via sherpa-onnx**) did a
**single whole-recording decode** in `libs/aven-ai/src/stt.rs`:

```rust
pub fn transcribe(&self, pcm: &[f32], sample_rate: u32) -> String {
    let stream = self.rec.create_stream();
    stream.accept_waveform(sample_rate as i32, pcm);  // the ENTIRE recording at once
    self.rec.decode(&stream);                          // one unbounded decode, no progress
    stream.get_result().map(|r| r.text).unwrap_or_default()
}
```

Nothing transcribed until the recording stopped, then one decode ran to
completion with **no timeout, no cancel, no progress** — so a long note looked
frozen and could appear to "never transcribe".

**Decisions (from the discovery interview, then refined during build):**

- **Keep Parakeet.** It's a sherpa-onnx `OfflineRecognizer` (decodes a complete
  buffer, not a live stream) — we chunk *around* it rather than swap models.
- **Live streaming, VAD-driven (no re-decoding).** sherpa-onnx's
  `VoiceActivityDetector` is itself streaming: feed mic audio as it's captured and
  it emits a `SpeechSegment` each time it detects a pause. So we decode **each
  closed segment exactly once, live**, the same total work as the offline path but
  triggered at natural pause boundaries. (An earlier "re-decode the buffer on a
  timer" idea was rejected as wasteful — the VAD already makes the cut decision.)
- **30s safety cap, unbounded total length.** Natural pauses do the real
  segmenting; the cap (`max_speech_duration`) only fires during a pause-free
  monologue so a single decode is never unbounded and a partial still appears at
  least once a minute. You can record 10min+; only each *segment* is bounded.
- **Silero VAD v5** — the latest Silero the pinned sherpa-onnx (1.13) can load
  (v6 changed the model IO and isn't supported). ~2 MB bare `.onnx`, cached next to
  Parakeet. (TEN VAD is a trivial future swap via the shared `VadModelConfig`.)
- **Submission unchanged.** Partials are a **preview only**; the final transcript
  is posted to the chat exactly as today — when the human stops the recording and
  the flush completes.

**Key enabler:** sherpa-onnx **1.13 (already our dependency)** ships
`VoiceActivityDetector` + `VadModelConfig` (Silero + TEN). Confirmed against the
crate source: `accept_waveform(&[f32])`, `front()`/`pop()` → `SpeechSegment`
(`.samples()`), `flush()`, plus a `max_speech_duration` cap. So VAD-aware
streaming needs **no new crate** — only the small Silero model file.

## Goal

A voice note of any practical length transcribes **live** and **never hangs**:
text streams in as a preview while you talk (the VAD closes a segment on each
pause and Parakeet decodes it once), and the full transcript posts to the chat
when you stop. The work is bounded (30s safety cap) and cancellable.

**Completion condition** — identical to the frontmatter `goal`. A live mic
transcript needs the Parakeet + Silero weights and a real microphone (absent in
CI), so the goal is written to be provable from `cargo test`/`check`/`clippy`,
`bun test`/`svelte-check`, `biome`, and `rg`: the segment **planner** and
transcript **merge** are pure and unit-tested without a model; the VAD + streaming
session compile and are grep-verified; a live transcript is a manual post-build
check.

## Approach

### 1. Pure, testable core (`stt.rs`)
- `split_into_windows(total, max_window, overlap)` — tiles a length into bounded
  overlapping windows with gap-free coverage. The **anti-hang guarantee**: used to
  re-split any VAD segment that exceeds the cap, and as the no-VAD fallback. Pure
  ⇒ unit-tested.
- `merge_segment_texts(parts)` — trims/joins per-segment transcripts. Pure ⇒
  unit-tested.

### 2. Silero VAD wrapper + download (`stt.rs`)
- `VadSpec` + `download_file` (a bare `.onnx`, reusing the existing
  download/cancel/progress style) cache `silero_vad.onnx` next to Parakeet.
- `Vad` wraps `VoiceActivityDetector` (Silero, `max_speech_duration = 30s`,
  window 512 @ 16 kHz) with streaming helpers (`accept_window`, `take_front`,
  `flush`, `reset`).

### 3. Live streaming session (`stt.rs`)
- `StreamTranscriber::{new, accept, finish, segment_count}` holds an
  `Arc<Transcriber>` + a per-stream `Vad`. `accept(pcm)` feeds whole VAD windows
  and decodes any **just-closed** segments once (returns `Some(cumulative)` only
  when a segment closed — natural throttling); `finish()` flushes the trailing
  speech and returns the full transcript. Without a VAD it degrades to
  buffer-then-decode on finish (still bounded by the planner).
- The offline `transcribe_segmented` (+ `Vad::segments`) is kept as the
  single-shot path behind `transcribe_audio`.

### 4. Tauri streaming commands (`asr.rs`, `lib.rs`)
- `asr_stream_start` (loads model + a fresh VAD, spawns an **ordered** worker
  thread owning the `StreamTranscriber`), `asr_stream_feed` (sends a chunk down a
  single channel — ordered, non-blocking), `asr_stream_finish` (signals end, waits
  for the worker's final transcript). Registered in `generate_handler!`.
- The worker emits `asr:transcribe-progress` (`{ text, done, total }`,
  `total: 0` live) on each closed segment; a `transcribe_cancelled` flag (set by
  `reset`/delete) aborts it. Feature-off build = stub errors.

### 5. Webview (`IntentComposer.svelte`, `transcribe.ts`, `model-download-store.ts`)
- Capture at 16 kHz (request a 16 kHz `AudioContext`; downsample per chunk as a
  fallback). On the default Tauri route, `beginCapture` opens the session +
  subscribes to partials, `onaudioprocess` feeds each chunk, and `commitVoiceNote`
  finishes the session and submits the final transcript (cancel drains + discards).
- `transcribe.ts`: `startLiveTranscription` / `feedLiveTranscription` /
  `finishLiveTranscription` / `subscribeTranscribeProgress` clients.
- `model-download-store.ts`: pure `reduceTranscribeProgress` (event → `{ text,
  fraction }`), unit-tested.
- A live preview pill renders the cumulative partial in listening mode.

### Out of scope
- True online/streaming Parakeet (swapping the `OfflineRecognizer`).
- Diarization, language UI, translation, punctuation post-processing.
- TEN VAD (kept as a future swap via the shared `VadModelConfig`).

## Files to touch

- `libs/aven-ai/src/stt.rs` — pure planner + merge (tested), `Vad` (Silero) with
  streaming helpers + offline `segments`, `download_file`/`VadSpec`,
  `StreamTranscriber`, `transcribe_segmented`; existing `transcribe`/
  `transcribe_words` untouched (one pre-existing clippy nit fixed in place).
- `app/src-tauri/src/asr.rs` — `PROGRESS_EVENT` + `TranscribeProgress`;
  `ensure_vad`/`load_fresh_vad`; the streaming session (worker + channels) and
  `stream_start`/`stream_feed`/`stream_finish`; `transcribe_cancelled` flag; route
  offline `transcribe` through `transcribe_segmented`. Stubs for the feature-off build.
- `app/src-tauri/src/lib.rs` — register `asr_stream_start`/`_feed`/`_finish`.
- `app/src/lib/intent-mock/transcribe.ts` — live-stream clients + progress sink.
- `app/src/lib/asr/model-download-store.ts` — `reduceTranscribeProgress` + event const.
- `app/src/lib/intent-mock/IntentComposer.svelte` — 16 kHz capture, live feed,
  preview pill, finish-on-submit (offline single-shot path preserved for injected transcribers).
- `app/tests/transcribe-progress.test.ts` — **new** unit tests.

## Acceptance criteria

- [x] `cargo test --lib --features stt` (in `libs/aven-ai`) green incl.
  `split_into_windows` + `merge_segment_texts` — **verified: 5 passed**.
- [x] `cargo clippy --lib --features stt -- -D warnings` exit 0 — **verified**.
- [x] From `app/src-tauri`: `cargo check --features local-voice` exit 0 —
  **verified** (`aven-os-app` compiles, 1 pre-existing unrelated `push_line`
  warning); `cargo clippy --features local-voice` clean for the changed code.
  Needed GTK/webkit2gtk dev libs + `SHERPA_ONNX_ARCHIVE_DIR` (build-script
  download blocked here) + a dummy `onnxruntime/libonnxruntime.dylib` resource
  (gitignored; a pre-existing bundle-resource gap in this Linux checkout).
- [x] From `app/`: `bun --bun x svelte-kit sync && bun --bun x svelte-check
  --tsconfig ./tsconfig.json` exit 0 — **verified: 0 errors** (1 pre-existing
  unrelated warning in `aven-city`).
- [x] From `app/`: `bun test tests` green incl. the transcribe-progress test —
  **verified: 31 passed**.
- [x] `bunx biome check <changed files>` exit 0 — **verified** on all changed JS/TS.
- [x] `rg -n "VoiceActivityDetector|silero" libs/aven-ai/src/stt.rs` and `rg -n
  "StreamTranscriber" libs/aven-ai/src/stt.rs app/src-tauri/src/asr.rs` show the
  VAD + streaming path wired.
- [x] `rg -n "asr:transcribe-progress|asr_stream_" app/src-tauri/src app/src`
  shows the event + commands emitted/registered/consumed.
- [x] `git status --porcelain` lists only the files in "Files to touch" (plus the
  board card move, lockfiles, and the regenerated `gen/schemas/linux-schema.json`)
  — **verified clean** after the build.

## Verification

```bash
# rust core (from libs/aven-ai) — sandbox: point at the prebuilt sherpa archive
export SHERPA_ONNX_ARCHIVE_DIR=/path/to/dir/with/sherpa-onnx-v1.13.2-linux-x64-static-lib.tar.bz2
cargo test  --lib --features stt
cargo clippy --lib --features stt -- -D warnings

# rust backend (from app/src-tauri) — needs GTK/webkit2gtk dev libs installed
cargo check --features local-voice

# app workspace (from app/) — run `bun install` first if node_modules is absent
bun --bun x svelte-kit sync
bun --bun x svelte-check --tsconfig ./tsconfig.json
bun test tests

# changed-file lint (repo baseline is not biome-clean)
bunx biome check <changed files>

# guard greps (from repo root)
rg -n "VoiceActivityDetector|silero" libs/aven-ai/src/stt.rs
rg -n "StreamTranscriber" libs/aven-ai/src/stt.rs app/src-tauri/src/asr.rs
rg -n "asr:transcribe-progress|asr_stream_" app/src-tauri/src app/src
git status --porcelain
```

Live check is **manual, post-build** (needs Parakeet + Silero weights + a mic):
build with `--features local-voice`, run the app, record a long voice note in a
spark `/talk`, confirm the preview streams as you pause and the final transcript
posts on stop without hanging.

## Hand-off

```
/aven-review 0059
```

## Progress log

Newest entry first.

- `2026-06-22` — **Merged `dev` (365 commits) into the feature branch** to update
  it and re-verify against current `dev`. Only `Cargo.lock` + `bun.lock`
  conflicted (took dev's; no new deps added) — all source auto-merged.
  Re-verified on the merged tree: `svelte-check` 0 errors, `bun test tests` 35
  pass, and src-tauri `cargo check --features local-voice` **exit 0** (clean,
  same lone pre-existing `push_line` warning) — so the STT work compiles against
  current `dev`. **Renumbered 0055 → 0059** — `dev` already used 0055 (×2) and up
  to 0058. Feature branch now contains all of `dev` + this work, so landing it on
  `dev` later is a clean fast-forward.
- `2026-06-22` — **Built & all gates green; moved build → review.** Final
  verification: aven-ai `cargo test --lib --features stt` 5 pass + clippy clean;
  src-tauri `cargo check --features local-voice` **exit 0** (+ clippy clean for
  the changed code) — required GTK/webkit2gtk dev libs, `SHERPA_ONNX_ARCHIVE_DIR`,
  and a gitignored dummy onnxruntime resource; `svelte-check` 0 errors; `bun test
  tests` 31 pass; biome clean; all wiring greps pass; tree clean. Live mic
  transcript remains a manual post-build check.
- `2026-06-22` — **Re-specced to LIVE streaming + built.** Per the user: keep
  Parakeet, transcribe **live while the mic is open** (the VAD makes the chunking
  decision — decode each closed segment once, no re-decoding), 30s safety cap with
  unbounded total length, partials are preview-only and the final posts on stop
  (existing submission logic). Latest sherpa-compatible **Silero VAD v5**.
  Implemented: `StreamTranscriber` + `Vad` streaming helpers + pure planner/merge
  in `stt.rs`; `asr_stream_start/feed/finish` worker + `asr:transcribe-progress`
  in `asr.rs`; command registration in `lib.rs`; live capture/feed/preview in
  `IntentComposer`; stream clients + reducer + tests on the JS side. **Verified:**
  aven-ai `cargo test --lib --features stt` 5 pass + clippy clean (via
  `SHERPA_ONNX_ARCHIVE_DIR`, since the build-script download is blocked here);
  `svelte-check` 0 errors; `bun test tests` 31 pass; biome clean on changed files.
  src-tauri `cargo check --features local-voice` running (heavy; required
  installing GTK/webkit2gtk dev libs). Original offline-chunk approach kept as the
  `transcribe_audio` fallback.
- `2026-06-22` — Discovery: specced into `discover/` (follow-on to shipped 0005).
  Uncovered the goal (reliability + responsiveness for ~5s–10min notes), chose
  VAD-aware chunking keeping Parakeet, confirmed sherpa-onnx 1.13 already ships
  `VoiceActivityDetector`, picked Silero VAD. Moved discover → build.
```
