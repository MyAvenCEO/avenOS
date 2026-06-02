---
title: Real voice-note transcription via Gemma on RedPill (Phala Cloud)
summary: Replace the faked voice-note transcripts in the intent composer with real microphone capture (real Tauri mic caps) sent client-side to Gemma (google/gemma-4-31b-it) on RedPill/Phala Cloud, and stream the actual transcript into the /talk message stream.
owner: unassigned
created: 2026-06-02
updated: 2026-06-02
tags: [intent, talk, ai, audio]
goal: >-
  The composer voice-note path records real microphone audio and obtains its
  transcript from a direct, client-side RedPill (OpenAI-compatible) call to
  google/gemma-4-31b-it using REDPILL_API_KEY sourced from the repo-root .env;
  the returned transcript is what gets submitted to the /talk stream via
  onSubmitMessage, and VOICE_MOCK_TRANSCRIPTS is used only as an explicit
  offline/error fallback. Proven from the transcript by: `bunx biome check .`
  exits 0; from `app/`, `bun --bun x svelte-kit sync && bun --bun x svelte-check
  --tsconfig ./tsconfig.json` exits 0; `bun test tests` (in `app/`) is green
  including new unit tests for the audio-encode helper and the transcription
  client; `rg "VOICE_MOCK_TRANSCRIPTS" app/src` shows it referenced only inside
  the fallback branch, never as the default voice-note body; and `rg
  "google/gemma-4-31b-it" app/src` shows the model wired into the RedPill call.
  No files outside those listed in "Files to touch" are changed.
---

# Real voice-note transcription via Gemma on RedPill (Phala Cloud)

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
body to be a **real transcript** instead of a random mock.

We want to: capture the actual microphone audio, send it to **Gemma 4 31B**
(`google/gemma-4-31b-it`) on **RedPill / Phala Cloud** — which exposes an
OpenAI-compatible API and **accepts audio input** — and submit the returned
transcript to the `/talk` stream. The key (`REDPILL_API_KEY`) lives in the
**repo-root `.env`**.

This item only touches the **voice-note** branch of the composer. The text and
slash-command (`onCommandSubmit`) paths, and the `HitlActionBar` usages, must
keep working unchanged (they rely on the mock fallback when no transcription
implementation is supplied).

### Decided architecture: client-side, direct, insecure-first

We are **not** building a server proxy for this item. The call to RedPill runs
**directly from the Tauri webview (browser) client**, with the API key reaching
the bundle. This is knowingly **insecure** (the key is exposed in the client) —
it is the agreed first cut; a proper proxy lands later as a separate item.

Consequences this plan accounts for:

- The app ships as a **static SPA** (`@sveltejs/adapter-static`,
  `fallback: index.html` in [`app/svelte.config.js`](../../../../app/svelte.config.js)),
  so there is no SvelteKit server to call anyway — client-side fits.
- Vite only exposes env vars matching `envPrefix` to the browser (see
  [`app/vite.config.ts`](../../../../app/vite.config.ts), which already loads the
  repo-root `.env` into `process.env`). Plain `REDPILL_API_KEY` is **not**
  exposed by default, so we must opt it in (see Approach §3).
- The OpenAI SDK refuses to run in a browser unless constructed with
  `dangerouslyAllowBrowser: true` — required here, and the flag name documents
  the trade-off.

## Goal

When a user records a voice note in the composer, the app captures the audio,
sends it from the client to `google/gemma-4-31b-it` on RedPill using the OpenAI
SDK with the repo-root `REDPILL_API_KEY`, and posts the **real transcript** into
the `/talk` message stream. The mock transcripts survive only as an
offline/error fallback.

**Completion condition** (identical to frontmatter `goal`):

> The composer voice-note path records real microphone audio and obtains its
> transcript from a direct, client-side RedPill (OpenAI-compatible) call to
> `google/gemma-4-31b-it` using `REDPILL_API_KEY` sourced from the repo-root
> `.env`; the returned transcript is what gets submitted to the `/talk` stream
> via `onSubmitMessage`, and `VOICE_MOCK_TRANSCRIPTS` is used only as an explicit
> offline/error fallback. Proven from the transcript by: `bunx biome check .`
> exits 0; from `app/`, `bun --bun x svelte-kit sync && bun --bun x svelte-check
> --tsconfig ./tsconfig.json` exits 0; `bun test tests` (in `app/`) is green
> including new unit tests for the audio-encode helper and the transcription
> client; `rg "VOICE_MOCK_TRANSCRIPTS" app/src` shows it referenced only inside
> the fallback branch, never as the default voice-note body; and `rg
> "google/gemma-4-31b-it" app/src` shows the model wired into the RedPill call.
> No files outside "Files to touch" are changed.

> Note: the live RedPill round-trip **cannot be verified in this environment**
> (no API key, no microphone). The goal is deliberately written so every clause
> is provable from `lint` / `check` / `bun test` output plus `rg` greps — the
> network call is covered by unit tests against a mocked OpenAI client, and the
> real call is exercised manually later with a key.

## Approach

Four pieces: **request mic capability (Tauri)**, **capture**, **transcribe
(client-side, direct)**, **wire to /talk**.

### 0. Request the actual Tauri microphone capabilities

`getUserMedia({ audio: true })` runs inside the Tauri **webview**, which is
sandboxed by the OS and currently grants **no** microphone access — today
[`app/src-tauri/Info.plist`](../../../../app/src-tauri/Info.plist) holds only
`ITSAppUsesNonExemptEncryption`, and
[`app/src-tauri/capabilities/default.json`](../../../../app/src-tauri/capabilities/default.json)
has no media grant. Without the platform mic permission, `getUserMedia` rejects
(or silently fails) and we'd never leave the mock path. Wire the real caps per
platform:

- **macOS** — add `NSMicrophoneUsageDescription` to `app/src-tauri/Info.plist`
  (WKWebView refuses the mic without it). If the macOS build uses the hardened
  runtime / app sandbox, also add the `com.apple.security.device.audio-input`
  entitlement.
- **iOS** — add `NSMicrophoneUsageDescription` to the iOS Info.plist /
  [`tauri.ios.conf.json`](../../../../app/src-tauri/tauri.ios.conf.json) and the
  audio-input entitlement in
  [`ios-template/aven-os-app_iOS.entitlements`](../../../../app/src-tauri/ios-template/aven-os-app_iOS.entitlements).
- **Linux (WebKitGTK) / Windows (WebView2)** — the webview emits a
  permission-request the host must grant; handle it on the Rust side
  (`on_webview_event` / WebView2 `PermissionRequested`) so the mic request is
  approved instead of auto-denied. Scope this to the `main` window.

The first device use still triggers the OS permission prompt (expected); the
usage-description string is what that prompt shows. Confirm the exact macOS
hardened-runtime / sandbox situation before deciding whether the entitlement is
required (see Open decisions).

### 1. Keep the composer dumb — inject transcription via a prop

`IntentComposer` lives under `intent-mock/` and is reused by `HitlActionBar`. Do
**not** hardcode the SDK call in it. Add one optional prop:

```ts
onTranscribeAudio?: (audio: Blob) => Promise<string>
```

- Real audio capture (getUserMedia + MediaRecorder) is added to the composer's
  listening mode so a `Blob` actually exists on commit.
- `commitVoiceNote()` becomes async: stop the recorder → get the `Blob` → if
  `onTranscribeAudio` is provided, `await` it and submit the returned transcript
  via `onSubmitMessage(transcript, [])`; otherwise (or on error / mic denied)
  fall back to a random `VOICE_MOCK_TRANSCRIPTS` entry.
- `SparkTalkPanel` passes a real `onTranscribeAudio` that calls the transcription
  client. `HitlActionBar` passes nothing → keeps the mock, so retrain/HITL flows
  are untouched.

This keeps the mock a true fallback (satisfies the `rg` clause of the goal) and
isolates the SDK/secret concern to one small client module.

### 2. Transcription client — `openai` SDK pointed at RedPill, in the browser

A browser-side module `app/src/lib/intent-mock/transcribe.ts`:

```ts
import OpenAI from 'openai'

const client = new OpenAI({
  apiKey: import.meta.env.REDPILL_API_KEY,
  baseURL: 'https://api.redpill.ai/v1', // CONFIRM exact base URL
  dangerouslyAllowBrowser: true,         // intentional: insecure client-side first cut
})

export async function transcribeVoiceNote(audio: Blob): Promise<string> {
  const { base64, format } = await encodeAudio(audio) // from audio-encode.ts
  const res = await client.chat.completions.create({
    model: 'google/gemma-4-31b-it', // CONFIRM exact RedPill model slug
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'Transcribe this voice note verbatim. Return only the transcript.' },
        { type: 'input_audio', input_audio: { data: base64, format } },
      ],
    }],
  })
  return res.choices[0]?.message?.content?.trim() ?? ''
}
```

Gemma is a multimodal chat model that **takes audio**, so transcription goes
through `chat.completions` with an `input_audio` content part (base64) — not the
Whisper-style `audio.transcriptions.*` route.

### 3. Expose `REDPILL_API_KEY` to the client (insecure, by design)

`app/vite.config.ts` already copies the repo-root `.env` into `process.env`. To
make the key readable from the browser as `import.meta.env.REDPILL_API_KEY`, add
`'REDPILL_'` to Vite's `envPrefix` (currently `['VITE_', 'PUBLIC_',
'TAURI_ENV_']`). That exposes any `REDPILL_`-prefixed var to the bundle —
intended here, and scoped narrowly to that prefix. Add a clear inline comment
that this is the insecure first-cut path pending a proxy.

- Add `REDPILL_API_KEY="your-redpill-api-key"` to
  [`.env.example`](../../../../.env.example) with a one-line comment + the model
  / base-URL reference and a "exposed to client; proxy later" warning.
- The real `.env` already exists at repo root and is git-ignored; dev scripts
  load it (`bun --env-file=../.env` + Vite `loadEnv`). No new env plumbing beyond
  the `envPrefix` opt-in.

### Out of scope

- Any server/proxy for the key (explicitly deferred to a later item).
- Streaming/partial transcripts (return the full string once).
- Diarization, language selection UI, translation.
- Audio transcoding (webm/opus → wav/mp3). Send the recorder's native container
  and confirm RedPill accepts it; transcoding is a follow-up if it does not.

## Steps

0. **Request Tauri mic caps.** Add `NSMicrophoneUsageDescription` to
   `app/src-tauri/Info.plist` (+ iOS Info.plist/entitlements), and add the
   webview permission-request grant on the Rust side for Linux/Windows. Verify a
   real recording starts in `bun dev:app` (manual; OS prompt appears once).
1. **Add real capture to the composer.** In `IntentComposer.svelte`, on
   `openListening()` start `navigator.mediaDevices.getUserMedia({ audio: true })`
   + `MediaRecorder`; collect chunks; on `stopListening()`/cancel, stop the
   stream and tracks. Handle permission denial gracefully (fall back to mock).
   Keep the existing timer/waveform UI.
2. **Add the `onTranscribeAudio` prop** and rewrite `commitVoiceNote()` to be
   async: assemble the `Blob`, call the prop if present, submit the resulting
   transcript via `onSubmitMessage(transcript, [])`; on missing prop or any
   error, fall back to a `VOICE_MOCK_TRANSCRIPTS` entry. Show the existing
   `submitBusy` affordance while transcribing.
3. **Add the encode helper** `app/src/lib/intent-mock/audio-encode.ts`
   (Blob/ArrayBuffer → base64 + mime/format detection). Pure + unit-testable.
4. **Create the transcription client** `app/src/lib/intent-mock/transcribe.ts`
   using the `openai` SDK against RedPill with `dangerouslyAllowBrowser: true`
   and `import.meta.env.REDPILL_API_KEY`. Keep the OpenAI client injectable so
   tests can pass a fake.
5. **Expose the key:** add `'REDPILL_'` to `envPrefix` in `app/vite.config.ts`
   with an inline insecurity comment.
6. **Wire `SparkTalkPanel`** to pass `onTranscribeAudio={transcribeVoiceNote}` to
   its `IntentComposer`.
7. **Add `openai`** to `app/package.json` dependencies; update lockfile.
8. **Add `REDPILL_API_KEY`** to `.env.example`.
9. **Tests** under `app/tests/`: encode helper round-trip; transcription client
   against a mocked OpenAI client (assert model id, base URL, `dangerouslyAllowBrowser`,
   key sourced from `import.meta.env`, transcript extraction, and error →
   fallback signalling).
10. **Run the verification block**; check off acceptance criteria; update the
    Progress log; `git mv` to `test/`.

## Files to touch

- `app/src-tauri/Info.plist` — add `NSMicrophoneUsageDescription` (macOS mic prompt).
- `app/src-tauri/tauri.ios.conf.json` + `app/src-tauri/ios-template/aven-os-app_iOS.entitlements` — iOS mic usage description + audio-input entitlement.
- `app/src-tauri/src/` (Rust) — grant the webview microphone permission-request on Linux/Windows (`on_webview_event` / WebView2 `PermissionRequested`), scoped to `main`. *(macOS entitlement in a `.entitlements`/`tauri.conf.json` bundle config only if hardened-runtime/sandbox requires it — see Open decisions.)*
- `app/src/lib/intent-mock/IntentComposer.svelte` — real MediaRecorder capture in
  listening mode; new `onTranscribeAudio` prop; async `commitVoiceNote()` with
  mock-only-as-fallback.
- `app/src/lib/intent-mock/audio-encode.ts` — **new**: Blob → base64/format helper.
- `app/src/lib/intent-mock/transcribe.ts` — **new**: client-side RedPill call via
  `openai` SDK (`dangerouslyAllowBrowser`), returns the transcript.
- `app/src/lib/sparks/SparkTalkPanel.svelte` — pass `onTranscribeAudio` to the composer.
- `app/vite.config.ts` — add `'REDPILL_'` to `envPrefix` (insecure client exposure).
- `app/package.json` (+ `bun.lock`) — add `openai`.
- `.env.example` — add `REDPILL_API_KEY` with comment + model/base-URL note + insecurity warning.
- `app/tests/transcribe.test.ts`, `app/tests/audio-encode.test.ts` — **new** unit tests.

## Open decisions (confirm before building)

- **macOS hardened runtime / sandbox.** Decides whether
  `NSMicrophoneUsageDescription` alone is enough or the
  `com.apple.security.device.audio-input` entitlement is also required. Confirm
  against the current macOS bundle/signing config before adding an entitlements
  file.
- **Webview permission-request hook.** Confirm the Tauri v2 API surface for
  granting the mic permission-request on WebKitGTK (Linux) and WebView2
  (Windows) in this app's Rust entrypoint.
- **Exact RedPill base URL and model slug.** Plan assumes
  `https://api.redpill.ai/v1` and `google/gemma-4-31b-it` (from the
  phala.com/.../google/gemma-4-31b-it link). Confirm against RedPill docs.
- **Audio content-part shape.** Plan assumes OpenAI-style `input_audio`
  (`{ data: base64, format }`) on a `chat.completions` message. Confirm RedPill's
  exact field names for Gemma audio input.
- **Audio container.** MediaRecorder typically emits `webm/opus`. Confirm RedPill
  accepts it; otherwise add transcoding (follow-up, out of scope here).

## Acceptance criteria

Each box must be checkable from the transcript (a command + its output proves it).

- [ ] `bunx biome check .` exits 0 — proven by running it.
- [ ] From `app/`: `bun --bun x svelte-kit sync && bun --bun x svelte-check --tsconfig ./tsconfig.json` exits 0 — proven by running it.
- [ ] From `app/`: `bun test tests` is green, including the new `audio-encode` and `transcribe` unit tests — proven by the test output.
- [ ] `rg "VOICE_MOCK_TRANSCRIPTS" app/src` shows the array referenced only inside the fallback branch of `commitVoiceNote()`, never as the default voice-note body — proven by the grep output + the surrounding diff.
- [ ] `rg "google/gemma-4-31b-it" app/src` shows the model id wired into the RedPill `chat.completions` call — proven by the grep output.
- [ ] `rg "REDPILL_API_KEY|REDPILL_" .env.example app/vite.config.ts app/src` shows the key in `.env.example`, the `REDPILL_` `envPrefix` opt-in in `vite.config.ts`, and client-side use via `import.meta.env.REDPILL_API_KEY` — proven by the grep output.
- [ ] `rg "dangerouslyAllowBrowser" app/src` shows the OpenAI client constructed for the browser (the documented insecure-first decision) — proven by the grep output.
- [ ] `rg "NSMicrophoneUsageDescription" app/src-tauri` shows the macOS/iOS mic usage description wired into the Tauri config — proven by the grep output. (The OS permission prompt itself is a manual, post-build check.)
- [ ] `git status --porcelain` lists only the files in "Files to touch" (plus `bun.lock`) — proven by the status output.

## Verification

```bash
# repo root
bunx biome check .

# app workspace
cd app
bun --bun x svelte-kit sync
bun --bun x svelte-check --tsconfig ./tsconfig.json
bun test tests

# guard clauses (run from repo root)
rg "VOICE_MOCK_TRANSCRIPTS" app/src
rg "google/gemma-4-31b-it" app/src
rg "REDPILL_API_KEY|REDPILL_" .env.example app/vite.config.ts app/src
rg "dangerouslyAllowBrowser" app/src
rg "NSMicrophoneUsageDescription" app/src-tauri
git status --porcelain
```

The live RedPill round-trip is **manual, post-merge** (needs `REDPILL_API_KEY` +
a mic): set the key in repo-root `.env`, `bun dev:app`, open a spark's `/talk`,
record a voice note, confirm the streamed message body is the real transcript.

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

- `2026-06-02` — Added the **Tauri microphone capability** request (per
  direction): today `src-tauri` grants no mic access, so `getUserMedia` would
  fail and never leave the mock. Plan now wires `NSMicrophoneUsageDescription`
  (macOS/iOS) + audio-input entitlement, and a Rust-side webview
  permission-request grant for Linux/Windows, as Step 0 with its own files,
  open decisions, and acceptance criterion.
- `2026-06-02` — Simplified per direction: **client-side, direct, insecure-first**
  — dropped the SvelteKit/Rust server-proxy options entirely (proxy is a later
  item). Confirmed Gemma takes audio input, so removed the "blocked if no audio
  modality" risk. Key now exposed to the browser via a `REDPILL_` `envPrefix`
  opt-in in `vite.config.ts` + `dangerouslyAllowBrowser` on the OpenAI client.
  Updated Approach, Files to touch, goal, and acceptance criteria accordingly.
- `2026-06-02` — Planned and specced directly into `plan/`. Mapped the faked
  voice-note path (`commitVoiceNote` → `VOICE_MOCK_TRANSCRIPTS`), the
  `onSubmitMessage` → `SparkTalkPanel.handleComposerSubmit` → `messages.create`
  flow into `/talk`, and the absence of any existing AI backend.
