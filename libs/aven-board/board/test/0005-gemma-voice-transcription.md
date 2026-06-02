---
title: On-device voice-note transcription via Gemma 4 E4B (mistral.rs, in Tauri/Rust)
summary: Replace the faked voice-note transcripts in the intent composer with real microphone capture transcribed fully on-device by Gemma 4 E4B running in the Tauri Rust backend via the mistral.rs crate, and stream the real transcript into the /talk message stream.
owner: unassigned
created: 2026-06-02
updated: 2026-06-02
tags: [intent, talk, ai, audio, tauri, rust, on-device]
goal: >-
  The composer voice-note path records real microphone audio, sends it over a
  Tauri command to an on-device Gemma 4 E4B model loaded via the mistralrs crate
  in src-tauri, and submits the returned transcript to the /talk stream via
  onSubmitMessage; while the model is downloading/unavailable the mic button stays
  enabled but clicking it opens a mini modal with a download progress bar + short
  description instead of recording (never mocked), plus an ambient top-left
  download bar; VOICE_MOCK_TRANSCRIPTS survives only in the non-Tauri demo
  composer (HitlActionBar), and no network/API-key path is introduced. Proven
  from the transcript by: `bunx biome check .` exits 0; from `app/`, `bun --bun x
  svelte-kit sync && bun --bun x svelte-check --tsconfig ./tsconfig.json` exits
  0; from `app/`, `bun test tests` is green including new unit tests for the
  audio-encode helper and the transcribe client; from `app/src-tauri`, `cargo
  check --features local-asr` and `cargo clippy --features local-asr -- -D
  warnings` exit 0 (and `cargo check` with default features still exits 0); `rg
  "google/gemma-4-E4B-it" app/src-tauri` shows the model wired into a mistralrs
  call; `rg -i "redpill|REDPILL_API_KEY|dangerouslyAllowBrowser|api.redpill"
  app/src .env.example` returns nothing; and `rg "VOICE_MOCK_TRANSCRIPTS"
  app/src` shows it only in the fallback branch. No files outside "Files to
  touch" are changed.
---

# On-device voice-note transcription via Gemma 4 E4B (mistral.rs, in Tauri/Rust)

## Context

Today the "voice note" is **faked**. In
[`app/src/lib/intent-mock/IntentComposer.svelte`](../../../../app/src/lib/intent-mock/IntentComposer.svelte):

- Listening mode (`mode === 'listening'`) only renders a timer and animated
  waveform bars — there is **no** `getUserMedia` / `MediaRecorder`; no audio is
  captured.
- On commit, `commitVoiceNote()` picks a random string from the
  `VOICE_MOCK_TRANSCRIPTS` array and calls `onSubmitMessage(body, [])`.

`onSubmitMessage` is wired in
[`app/src/lib/sparks/SparkTalkPanel.svelte`](../../../../app/src/lib/sparks/SparkTalkPanel.svelte)
→ `handleComposerSubmit(message, files)` → `messages.create({ spark_id,
created_at_ms, author_did, body })` (the Groove-backed `jazz` store, persisted
over Tauri IPC). The talk stream already accepts a string body; we only need the
body to be a **real transcript**.

### Why on-device, and why E4B

Earlier this item targeted a hosted RedPill (Phala) call to `gemma-4-31b-it`.
That is dropped: **only the small Gemma 4 variants (E2B / E4B) accept audio
input** — the large hosted model does not. The audio-capable model is small
enough to **run locally**, so we transcribe **fully on-device** instead of over
the network. That also retires the whole insecure-key story (no
`REDPILL_API_KEY`, no `dangerouslyAllowBrowser`, no proxy) and works offline.

**Engine:** [`mistralrs`](https://crates.io/crates/mistralrs) — a Rust-native
inference engine with **day-0 Gemma 4 support across all modalities (text,
image, video, audio)**, embeddable as a **library crate**. It takes audio as
`AudioInput` (raw PCM samples + sample rate) and runs ISQ-quantized weights on
CPU / CUDA / Metal. (Candle was the runner-up — lighter binary but no ready E4B
audio path; llama.cpp/`llama-cpp-2` is text-only for these models today. See the
research thread / Sources.)

Inference belongs in the **Tauri Rust backend** (`app/src-tauri`), which already
hosts the app's heavy lifting (the Groove engine, crypto, P2P) and registers
`#[tauri::command]`s via `tauri::generate_handler!` in
[`app/src-tauri/src/lib.rs`](../../../../app/src-tauri/src/lib.rs). The webview
captures audio and calls a new command; Rust does the model work and returns the
transcript.

This item only touches the **voice-note** branch of the composer. The text and
slash-command (`onCommandSubmit`) paths and the `HitlActionBar` usages keep
working unchanged (they rely on the mock fallback when no transcription
implementation is supplied).

## Goal

When a user records a voice note, the app captures the audio, hands it to an
on-device Gemma 4 E4B model running in the Rust backend (via `mistralrs`), and
posts the **real transcript** into the `/talk` stream. Mock transcripts survive
only as a non-Tauri / error fallback. No network or API key is introduced.

**Completion condition** (identical to frontmatter `goal`):

> The composer voice-note path records real microphone audio, sends it over a
> Tauri command to an on-device Gemma 4 E4B model loaded via the `mistralrs`
> crate in `src-tauri`, and submits the returned transcript to the `/talk` stream
> via `onSubmitMessage`; while the model is downloading/unavailable the mic button
> stays enabled but clicking it opens a **mini modal** with a download progress
> bar + short description instead of recording (never mocked), plus an ambient
> top-left download bar; `VOICE_MOCK_TRANSCRIPTS` survives only in the non-Tauri
> demo composer (`HitlActionBar`), and no network/API-key path is introduced.
> Proven by the lint/check/test/clippy/grep commands in the frontmatter `goal`. No
> files outside "Files to touch" are changed.

> Note: an actual transcription run needs the **E4B weights + a real
> microphone**, neither of which exists in CI. The goal is written so every
> clause is provable from `cargo check`/`clippy`, `bun check`/`lint`/`test`, and
> `rg` greps — the model call is compiled and unit-tested with the engine
> mocked/feature-gated; a live transcript is a manual, post-build check.

## Approach

Four pieces: **mic caps**, **capture → PCM**, **Rust command + mistral.rs E4B**,
**wire to /talk**.

### 0. Request the actual Tauri microphone capabilities

`getUserMedia({ audio: true })` runs in the Tauri **webview** (wry), which grants
**no** mic access today — [`app/src-tauri/Info.plist`](../../../../app/src-tauri/Info.plist)
holds only `ITSAppUsesNonExemptEncryption` and
[`capabilities/default.json`](../../../../app/src-tauri/capabilities/default.json)
has no media grant. The capabilities ACL does **not** cover `getUserMedia`; it's
an OS + native-webview concern (researched against the Tauri/wry issues in
Sources):

- **macOS (WKWebView)** — add `NSMicrophoneUsageDescription` to `Info.plist`
  (merged with Tauri's generated plist). The webview must delegate
  `requestMediaCapturePermissionForOrigin` — recent **wry** implements it, so
  **bump Tauri/wry** if the pinned version predates the fix. Under hardened
  runtime / sandbox, also add `com.apple.security.device.audio-input` via an
  `Entitlements.plist` wired in `tauri.conf.json` (`bundle.macOS.entitlements`).
- **iOS** — `NSMicrophoneUsageDescription` in the iOS plist
  ([`tauri.ios.conf.json`](../../../../app/src-tauri/tauri.ios.conf.json)) +
  audio-input entitlement
  ([`ios-template/aven-os-app_iOS.entitlements`](../../../../app/src-tauri/ios-template/aven-os-app_iOS.entitlements)).
- **Linux (WebKitGTK)** — ⚠️ **the heavy one, and this dev box is Linux**. Stock
  WebKitGTK ships without media-stream/WebRTC, so `getUserMedia` is unavailable
  unless WebKitGTK was built with `-DENABLE_MEDIA_STREAM=ON -DENABLE_WEB_RTC=ON`
  (+ GStreamer `gst-plugins-good/base/bad`). On the Rust side the webview must
  enable + grant it:

  ```rust
  settings.set_enable_webrtc(true);
  settings.set_enable_media_stream(true);
  settings.set_media_playback_requires_user_gesture(false);
  webview.connect_permission_request(|_, req| { req.allow(); true });
  ```
- **Windows (WebView2)** — handle `PermissionRequested` → allow the microphone.

### 1. Capture audio → PCM in the webview

`mistralrs` wants **PCM samples + sample rate**, so the cleanest path is to
capture raw PCM directly and skip container/codec decoding:

- On `openListening()`, `getUserMedia({ audio: true })` → Web Audio
  (`AudioContext` + an `AudioWorkletNode` or `ScriptProcessor`) to accumulate
  `Float32` PCM and record the `AudioContext.sampleRate`.
- On commit, stop tracks and produce `{ pcm: Float32Array, sampleRate: number }`.
  Downsample/convert to the model's expected rate (commonly 16 kHz) either here
  or in Rust — decide in Open decisions.
- Keep the existing timer/waveform UI. (Alternative: `MediaRecorder` → webm/opus
  and decode in Rust with `symphonia`; rejected as the default because it adds a
  Rust codec dependency for no benefit when Web Audio already yields PCM.)

### 2. Keep the composer dumb — inject transcription via a prop

`IntentComposer` (under `intent-mock/`, also used by `HitlActionBar`) must not
hardcode the IPC call. Add two optional props:

```ts
onTranscribeAudio?: (audio: { pcm: Float32Array; sampleRate: number }) => Promise<string>
/** When set, the mic stays enabled but routes to the mini modal instead of recording. */
voiceUnavailableReason?: string | null
/** Fired when the mic is clicked while voiceUnavailableReason is set (parent opens the modal). */
onVoiceUnavailableClick?: () => void
```

Behavior (the real `/talk` path — `onTranscribeAudio` provided):

- **Button stays enabled. Model not ready → open a mini modal, don't record,
  don't mock.** When `voiceUnavailableReason` is set (model downloading / not
  built / load error), the mic button is **not** disabled — clicking it (or the
  hold/double-tap gesture) does **not** start recording; instead the composer
  fires `onVoiceUnavailableClick()` and the parent opens a **mini modal** showing
  a **download progress bar + a short description** of what's happening (§3.5).
  **No `VOICE_MOCK_TRANSCRIPTS` is used here.**
- **Model ready →** `commitVoiceNote()` records as normal, then async: assemble
  the PCM, `await onTranscribeAudio(...)`, submit the transcript via
  `onSubmitMessage(transcript, [])`, showing the existing `submitBusy` affordance
  while transcribing. On a transcription **error** (model present but inference
  fails), surface a brief error (reuse `SparkTalkPanel`'s `err`); post nothing —
  still no mock.

`SparkTalkPanel` owns the readiness signal (from the model-download store, §3.5)
and passes `voiceUnavailableReason` + `onVoiceUnavailableClick` + `onTranscribeAudio`.
`HitlActionBar` passes none → it stays a pure UI demo and keeps
`VOICE_MOCK_TRANSCRIPTS` as its only, non-Tauri mock. So the mock survives **only**
in the demo composer, never as a substitute for the real on-device transcription.

### 3. Rust command + on-device Gemma 4 E4B (mistral.rs)

Add a feature-gated module + Tauri command in `src-tauri`:

- **Cargo:** add `mistralrs` behind a default-off feature `local-asr`
  (`[features] local-asr = ["dep:mistralrs"]`), with per-platform accel features
  (Metal on macOS, CUDA optional on Linux/Windows, plain CPU fallback). Gating
  keeps default `cargo check`/CI light and the heavy ML dep opt-in.
- **Command:** `#[tauri::command] async fn transcribe_audio(pcm: Vec<f32>,
  sample_rate: u32, app: AppHandle) -> Result<String, String>`, registered in the
  `tauri::generate_handler![…]` list in `lib.rs`. When `local-asr` is off it
  returns `Err("local ASR not built")` → readiness store = `unavailable` →
  clicking the mic opens the mini modal (not mocked, not disabled).
- **Model lifecycle:** build the E4B model once (lazy `OnceCell` / Tauri managed
  state), e.g. id `google/gemma-4-E4B-it` with ISQ 8-/4-bit quant; hold it in
  `.manage(...)` alongside `ManagedJazz`. Run inference on a blocking thread
  (`tokio::task::spawn_blocking`) so it never stalls the IPC/event loop.
- **Inference:** wrap the PCM in mistral.rs `AudioInput { pcm, sample_rate }`, send
  a message like *"Transcribe this voice note verbatim. Return only the
  transcript."*, return the model's text. (Confirm exact `mistralrs` builder /
  `AudioInput` API against the installed version — see Open decisions.)

### 3.5. Weights: first-run background download + top-left progress

The E4B weights are **not** bundled — they download on first run, in the
background, without blocking app start or the IPC loop.

- **Location.** Store under the app's `.avenOS` root in a `models/` subdir:
  `tauri_plugin_self::paths::aven_os_app_base(&app).join("models")` →
  `.avenOS/models/google__gemma-4-E4B-it/…`. (Add a small `models_dir()` helper
  next to the existing `db_dir` / `identity_crypto_dir` path helpers for
  consistency.) If the files already exist, skip the download.
- **Trigger + non-blocking.** Kick the download from a **background task** in
  Tauri `setup()` (`tauri::async_runtime::spawn`), the same place the Groove
  actor / drains are spawned in [`lib.rs`](../../../../app/src-tauri/src/lib.rs).
  App boot and every other command proceed normally while it runs. Stream to disk
  (HF hub or `reqwest` streaming) so memory stays flat; resume/overwrite-partial
  on restart.
- **Readiness gates recording, not the button (no mock).** A small JS **readiness
  store** derives availability from the `asr:model-download` events (+ an initial
  `asr_status` command): `downloading | ready | error | unavailable` (the last =
  `local-asr` not built). `SparkTalkPanel` maps anything other than `ready` to a
  `voiceUnavailableReason` string passed to the composer; while set, clicking the
  (still-enabled) mic opens the **mini modal** instead of recording (§2) — never
  silently mocked. Once ready, the model loads lazily on first use and is cached
  in managed state.
- **Progress events.** Rust emits Tauri events as bytes arrive, e.g.
  `app.emit("asr:model-download", { name, receivedBytes, totalBytes, status })`
  (`status` ∈ `downloading | ready | error`) — mirroring the existing
  Rust→webview event pattern (`attachSelfRustEventMirrors`). Throttle to ~1–2/s.
Two UI surfaces, both fed by the readiness store:

- **Ambient top-left indicator.** A global component
  `app/src/lib/asr/ModelDownloadIndicator.svelte` rendered once in the **root
  layout** ([`app/src/routes/+layout.svelte`](../../../../app/src/routes/+layout.svelte),
  alongside the global drag overlay), positioned **fixed top-left**
  (`fixed left-2 top-2 z-50`, `pointer-events-none`). While downloading it shows a
  thin determinate **progress bar** + a **small model-name label** (e.g.
  `Gemma 4 E4B · 312 MB / 4.1 GB`). **Hidden** when idle; auto-dismisses shortly
  after `status: ready`; brief note on `status: error`. Tauri-runtime only;
  unobtrusive, must not overlap interactive top-left nav.
- **Click-triggered mini modal.** A new component
  `app/src/lib/asr/VoiceModelDownloadModal.svelte` — a small, dismissible modal
  opened when the user clicks the mic **before the model is ready** (§2). It
  renders the same **progress bar** plus a **short description** of what's
  happening and why voice notes aren't available yet, e.g. *"Setting up on-device
  voice transcription. Gemma 4 E4B is downloading (312 MB / 4.1 GB) — this runs
  once and works offline after."* Closes on backdrop/Esc; if the model becomes
  `ready` while open, it can swap to a "ready — tap the mic to record" state.

### 4. Wire to /talk

`SparkTalkPanel` provides:
- `onTranscribeAudio` = a small browser client
  `app/src/lib/intent-mock/transcribe.ts` that calls
  `invoke('transcribe_audio', { pcm, sampleRate })` and returns the string,
- `voiceUnavailableReason` derived from the readiness store (§3.5) — `null` when
  `ready`, else a short reason, and
- `onVoiceUnavailableClick` = open the `VoiceModelDownloadModal` (§3.5).

The transcript flows through the unchanged `onSubmitMessage → handleComposerSubmit
→ messages.create` path into `/talk`. While not `ready`, the mic stays clickable
but opens the mini modal instead of recording; the ambient top-left bar shows
background download progress.

### Out of scope

- Streaming/partial transcripts (return the full string once).
- Diarization, language UI, translation, punctuation post-processing.
- Mobile shipping of E4B (size/RAM likely prohibitive — see Risks); desktop first.
- Bundling weights in-repo / in the installer — rejected; we download on first run
  (Approach §3.5).

## Steps

0. **Mic caps.** Add `NSMicrophoneUsageDescription` (macOS/iOS) + entitlement;
   add the Linux/Windows webview permission-grant on the Rust side.
1. **PCM capture** in `IntentComposer.svelte` via Web Audio; stop/cleanup tracks.
2. **`onTranscribeAudio` prop** + async `commitVoiceNote()` with mock-only-as-fallback.
3. **`transcribe.ts`** browser client: `invoke('transcribe_audio', …)` → string.
4. **Rust module** `app/src-tauri/src/asr.rs` (feature `local-asr`): mistralrs E4B
   load + `transcribe_audio` command (readiness-gated); register in
   `generate_handler!`; managed state.
5. **Weights download (Rust):** `models_dir()` path helper → `.avenOS/models/`;
   background streaming download spawned in `setup()`; emit `asr:model-download`
   progress events; skip if present.
6. **Readiness + click-routing:** `asr_status` command + `model-download-store.ts`
   (status `downloading|ready|error|unavailable`); add `voiceUnavailableReason` +
   `onVoiceUnavailableClick` props to `IntentComposer` — mic stays enabled but
   routes to the modal when not ready; **no mock on the real path**.
7. **UI surfaces:** `ModelDownloadIndicator.svelte` (ambient top-left bar) mounted
   in the root layout under the Tauri guard; `VoiceModelDownloadModal.svelte` (mini
   modal with progress bar + short description) opened by `SparkTalkPanel` on
   `onVoiceUnavailableClick`. Both driven by the readiness store.
8. **Cargo:** add `mistralrs` behind `local-asr` (+ accel features); ensure default
   `cargo check` stays green and `--features local-asr` compiles.
9. **Wire `SparkTalkPanel`** to pass `onTranscribeAudio` + `voiceUnavailableReason`
   + `onVoiceUnavailableClick`, and render the modal.
10. **Tests** (`app/tests/`): audio-encode/PCM helper round-trip; transcribe client
    against a mocked `invoke` (ready → transcript; error → surfaced, no message);
    readiness store reduces `asr:model-download` events → `{progress, status,
    voiceUnavailableReason}`.
11. **Run verification**; check off criteria; update Progress log; `git mv` to `test/`.

## Files to touch

- `app/src-tauri/Info.plist` — `NSMicrophoneUsageDescription` (macOS).
- `app/src-tauri/tauri.ios.conf.json` + `app/src-tauri/ios-template/aven-os-app_iOS.entitlements` — iOS mic usage + audio-input entitlement.
- `app/src-tauri/Entitlements.plist` (**new**, macOS) + `app/src-tauri/tauri.conf.json` (`bundle.macOS.entitlements`) — only if hardened runtime/sandbox requires `com.apple.security.device.audio-input`.
- `app/src-tauri/src/` (Rust webview wiring) — Linux `set_enable_webrtc/media_stream` + `connect_permission_request`; Windows WebView2 `PermissionRequested`; scoped to `main`.
- `app/src-tauri/src/asr.rs` — **new**: `mistralrs` E4B load + `transcribe_audio` + `asr_status` commands (readiness-gated) + background weights download into `.avenOS/models/` emitting `asr:model-download` progress events (feature `local-asr`).
- `app/src-tauri/src/lib.rs` — register `transcribe_audio` + `asr_status` in `generate_handler!`; `.manage()` the model state; declare `mod asr`; spawn the background download in `setup()`.
- `libs/tauri-plugin-self/` (paths) — add a `models_dir()` helper beside `db_dir`/`identity_crypto_dir` (`.avenOS/models/`).
- `app/src/lib/asr/model-download-store.ts` — **new**: readiness store (`asr_status` + `asr:model-download` → `{ status, received, total, model, voiceUnavailableReason }`).
- `app/src/lib/asr/ModelDownloadIndicator.svelte` — **new**: ambient top-left progress bar + model name, fed by the store.
- `app/src/lib/asr/VoiceModelDownloadModal.svelte` — **new**: mini modal (progress bar + short description) shown when the mic is clicked before the model is ready.
- `app/src/routes/+layout.svelte` — mount `<ModelDownloadIndicator />` once (Tauri-guarded), fixed top-left.
- `app/src-tauri/Cargo.toml` (+ `Cargo.lock`) — add `mistralrs` behind `local-asr` + accel features; possible Tauri/wry bump for macOS mic.
- `app/src/lib/intent-mock/IntentComposer.svelte` — Web Audio PCM capture; `onTranscribeAudio` + `voiceUnavailableReason` + `onVoiceUnavailableClick` props; async `commitVoiceNote()`; mic stays enabled but routes to the modal when not ready (real path never mocks).
- `app/src/lib/intent-mock/transcribe.ts` — **new**: `invoke('transcribe_audio', …)` client.
- `app/src/lib/intent-mock/audio-encode.ts` — **new**: PCM accumulation / Float32↔Int16 / resample helper (pure, unit-testable).
- `app/src/lib/sparks/SparkTalkPanel.svelte` — pass `onTranscribeAudio` + `voiceUnavailableReason` + `onVoiceUnavailableClick` (from the readiness store); render `<VoiceModelDownloadModal />`.
- `app/tests/transcribe.test.ts`, `app/tests/audio-encode.test.ts` — **new** unit tests.

> Note: **no** `.env.example`, `vite.config.ts`, or `openai`/RedPill changes —
> the network path is gone.

## Open decisions / risks (confirm before building)

- **✅ Weights distribution — decided.** E4B at 4-bit ISQ is multi-GB. We
  **download on first run** into `.avenOS/models/`, **in the background and
  non-blocking**, with an ambient top-left progress bar + a click-triggered mini
  modal. Fully specced in Approach §3.5. (Trade-off accepted: until the first
  download finishes, clicking the mic shows the mini modal instead of recording —
  no mock; offline-first holds once cached.)
- **🔴 Linux WebKitGTK WebRTC.** Stock WebKitGTK can't do `getUserMedia`; this dev
  box is Linux. Verify the environment's WebKitGTK has media-stream/WebRTC before
  relying on live capture here (macOS/iOS/Windows are config-only).
- **🟠 `mistralrs` build weight & platform features.** Heavy dependency (long
  compile, large binary, accel toolchains). Feature-gate behind `local-asr`
  (default off) so CI/default builds stay light; pick the accel feature per
  target. Confirm it builds in this toolchain (`rust 1.93`).
- **mistral.rs API surface.** Confirm the installed `mistralrs` version's builder
  + `AudioInput` (PCM + sample rate) signatures and the exact E4B model id
  (`google/gemma-4-E4B-it` assumed from the day-0 docs; confirm casing/slug).
- **Sample rate / format.** Confirm E4B's expected input rate (likely 16 kHz) and
  resample in JS (Web Audio) or Rust.
- **macOS hardened runtime / wry version** — as in Step 0.
- **Mobile.** E4B may be too large for phones; treat mobile as out of scope until
  a size/RAM check says otherwise.

## Acceptance criteria

Each box must be checkable from the transcript (a command + its output proves it).

- [ ] `bunx biome check .` exits 0.
- [ ] From `app/`: `bun --bun x svelte-kit sync && bun --bun x svelte-check --tsconfig ./tsconfig.json` exits 0.
- [ ] From `app/`: `bun test tests` is green, including the new `audio-encode` and `transcribe` unit tests.
- [ ] From `app/src-tauri`: `cargo check` (default features) exits 0 **and** `cargo check --features local-asr` + `cargo clippy --features local-asr -- -D warnings` exit 0.
- [ ] `rg "google/gemma-4-E4B-it" app/src-tauri` shows the model id wired into a `mistralrs` call.
- [ ] `rg -i "redpill|REDPILL_API_KEY|dangerouslyAllowBrowser|api.redpill" app/src .env.example` returns nothing (the network/key path is fully removed).
- [ ] `rg "VOICE_MOCK_TRANSCRIPTS" app/src` shows the array referenced only inside the fallback branch of `commitVoiceNote()`.
- [ ] `rg "NSMicrophoneUsageDescription" app/src-tauri` shows the mic usage description wired in.
- [ ] `rg -n "models" libs/tauri-plugin-self app/src-tauri/src/asr.rs` shows the `.avenOS/models/` dir helper + first-run download target; `rg "tauri::async_runtime::spawn|spawn" app/src-tauri/src/lib.rs` shows the download kicked from `setup()` (non-blocking).
- [ ] `rg "asr:model-download" app/src app/src-tauri` shows the progress event emitted (Rust) and consumed (store), and `rg -n "ModelDownloadIndicator" app/src/routes/+layout.svelte` shows the top-left indicator mounted.
- [ ] `rg -n "VoiceModelDownloadModal|onVoiceUnavailableClick" app/src` shows the mini modal exists and the mic routes to it (not to recording) when the model isn't ready — i.e. the mic button is **not** disabled.
- [ ] `git status --porcelain` lists only the files in "Files to touch" (plus lockfiles).

## Verification

```bash
# repo root
bunx biome check .

# app workspace
cd app
bun --bun x svelte-kit sync
bun --bun x svelte-check --tsconfig ./tsconfig.json
bun test tests

# rust backend
cd src-tauri
cargo check                              # default features stay green
cargo check --features local-asr
cargo clippy --features local-asr -- -D warnings

# guard greps (from repo root)
rg "google/gemma-4-E4B-it" app/src-tauri
rg -i "redpill|REDPILL_API_KEY|dangerouslyAllowBrowser|api.redpill" app/src .env.example
rg "VOICE_MOCK_TRANSCRIPTS" app/src
rg "NSMicrophoneUsageDescription" app/src-tauri
rg "asr:model-download" app/src app/src-tauri
rg -n "ModelDownloadIndicator" app/src/routes/+layout.svelte
rg -n "VoiceModelDownloadModal|onVoiceUnavailableClick" app/src
rg -n "models" libs/tauri-plugin-self app/src-tauri/src/asr.rs
git status --porcelain
```

The live transcription is **manual, post-build** (needs the E4B weights + a mic):
build with `--features local-asr`, run the app, open a spark's `/talk`, record a
voice note, confirm the streamed body is the real transcript.

## Hand-off

```
/board-goal plan/0005-gemma-voice-transcription
```

…or hand the condition straight to the built-in loop:

```
/goal <paste the Completion condition above>
```

## Progress log

Newest entry first.

- `2026-06-02` — **Unavailable-model UX refined:** don't disable the mic. The
  button stays enabled; clicking it before the model is ready opens a **mini
  modal** (`VoiceModelDownloadModal.svelte`) with the download progress bar + a
  short description, instead of recording (still no mock). Composer gains
  `onVoiceUnavailableClick`; the ambient top-left bar remains for background
  progress. Updated §2/§3.5/§4, goal, files, steps, and acceptance criteria.
- `2026-06-02` — **Weights = first-run background download** (decided). Store under
  `.avenOS/models/` (new `models_dir()` helper in `tauri-plugin-self` paths),
  streamed non-blocking from a `setup()` background task; `transcribe_audio` is
  readiness-gated (later refined: not-ready → mini modal, not mock — see newest
  entry). Added a global **top-left progress indicator** (`ModelDownloadIndicator.svelte` + a store) mounted in the
  root layout, fed by `asr:model-download` Tauri events (progress bar + small
  model-name label, auto-hide when idle). Updated Approach (§3.5), Steps, Files,
  acceptance criteria, and verification greps.
- `2026-06-02` — **Re-specced to the on-device path.** Only Gemma 4 E2B/E4B accept
  audio, so dropped the hosted RedPill call entirely (no key, no proxy, no
  `dangerouslyAllowBrowser`) and moved inference into the Tauri **Rust** backend
  via the **`mistralrs`** crate (day-0 Gemma 4 audio; `AudioInput` = PCM + sample
  rate; ISQ; CPU/CUDA/Metal). New shape: Web Audio PCM capture in the webview → a
  feature-gated (`local-asr`) `transcribe_audio` Tauri command loading
  `google/gemma-4-E4B-it` → transcript → `/talk`. Added weights-distribution and
  build-weight risks; kept the Tauri mic-caps work (still needed for `getUserMedia`).
  Rewrote goal/criteria to add `cargo check`/`clippy` and a grep proving the
  RedPill path is gone.
- `2026-06-02` — Researched RedPill + Tauri mic; confirmed RedPill base URL but
  could not confirm large-Gemma audio (phala page 403). Earlier client-side /
  server iterations now superseded by the on-device path above.
- `2026-06-02` — Planned and specced directly into `plan/`. Mapped the faked
  voice-note path (`commitVoiceNote` → `VOICE_MOCK_TRANSCRIPTS`) and the
  `onSubmitMessage` → `SparkTalkPanel.handleComposerSubmit` → `messages.create`
  flow into `/talk`.

## Sources

- mistral.rs (Gemma 4 day-0, audio, Rust SDK): <https://github.com/EricLBuehler/mistral.rs>, <https://crates.io/crates/mistralrs>
- Candle (runner-up): <https://github.com/huggingface/candle>, <https://github.com/huggingface/candle/tree/main/candle-examples/examples/gemma>
- llama.cpp / `llama-cpp-2` (text-only for these models today): <https://crates.io/crates/llama-cpp-2>, <https://github.com/ggml-org/llama.cpp/discussions/15194>, <https://github.com/ggml-org/llama.cpp/issues/23688>
- Tauri/wry mic: <https://v2.tauri.app/distribute/macos-application-bundle/>, <https://github.com/tauri-apps/wry/issues/1195>, <https://github.com/tauri-apps/tauri/issues/12547>, <https://github.com/tauri-apps/tauri/discussions/8426>
