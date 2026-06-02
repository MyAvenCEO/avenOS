---
title: Real voice-note transcription via Gemma on RedPill (Phala Cloud)
summary: Replace the faked voice-note transcripts in the intent composer with real audio capture sent to Gemma (google/gemma-4-31b-it) on RedPill/Phala Cloud, and stream the actual transcript into the /talk message stream.
owner: unassigned
created: 2026-06-02
updated: 2026-06-02
tags: [intent, talk, ai, audio]
goal: >-
  The composer voice-note path records real microphone audio and obtains its
  transcript from a server-side RedPill (OpenAI-compatible) call to
  google/gemma-4-31b-it that reads REDPILL_API_KEY from the repo-root .env; the
  returned transcript is what gets submitted to the /talk stream via
  onSubmitMessage, and VOICE_MOCK_TRANSCRIPTS is used only as an explicit
  offline/error fallback. Proven from the transcript by: `bunx biome check .`
  exits 0; from `app/`, `bun --bun x svelte-kit sync && bun --bun x svelte-check
  --tsconfig ./tsconfig.json` exits 0; `bun test tests` (in `app/`) is green
  including new unit tests for the audio-encode helper and the transcription
  client/endpoint; and `rg "VOICE_MOCK_TRANSCRIPTS" app/src` shows it referenced
  only inside the fallback branch, never as the default voice-note body. No
  files outside those listed in "Files to touch" are changed.
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
over Tauri IPC). So the talk stream already accepts a string body; we only need
the body to be a **real transcript** instead of a random mock.

We want to: capture the actual microphone audio, send it to **Gemma 4 31B**
(`google/gemma-4-31b-it`) on **RedPill / Phala Cloud** — which exposes an
OpenAI-compatible API — and submit the returned transcript to the `/talk`
stream. The key (`REDPILL_API_KEY`) lives in the **repo-root `.env`**.

This item only touches the **voice-note** branch of the composer. The text and
slash-command (`onCommandSubmit`) paths, and the `HitlActionBar` usages, must
keep working unchanged (they rely on the mock fallback when no transcription
implementation is supplied).

### Hard constraint discovered while planning (read before building)

The app ships as a **static SPA** —
[`app/svelte.config.js`](../../../../app/svelte.config.js) uses
`@sveltejs/adapter-static` with `fallback: 'index.html'`. There is **no
SvelteKit server at runtime in the Tauri bundle**, and Vite only exposes env
vars prefixed `VITE_/PUBLIC_/TAURI_ENV_` to the browser (see
[`app/vite.config.ts`](../../../../app/vite.config.ts)). Therefore:

- `REDPILL_API_KEY` **must never reach the browser bundle.** The model call has
  to run somewhere with the secret: a SvelteKit `+server.ts` (dev only) or the
  Tauri **Rust** backend (dev + shipped).
- A `+server.ts` endpoint runs under `bun dev:app` (vite dev) — which is exactly
  the "plug-and-play, I can't test it without the key" scenario described — but
  **adapter-static cannot build a non-prerenderable POST route**. See the
  decision in **Approach**: the endpoint must be excluded from the static build
  (or replaced by a Tauri command) so `app/build` keeps passing.

## Goal

When a user records a voice note in the composer, the app captures the audio,
sends it to `google/gemma-4-31b-it` on RedPill using the OpenAI SDK with the
repo-root `REDPILL_API_KEY`, and posts the **real transcript** into the `/talk`
message stream. The mock transcripts survive only as an offline/error fallback.

**Completion condition** (identical to frontmatter `goal`):

> The composer voice-note path records real microphone audio and obtains its
> transcript from a server-side RedPill (OpenAI-compatible) call to
> `google/gemma-4-31b-it` that reads `REDPILL_API_KEY` from the repo-root
> `.env`; the returned transcript is what gets submitted to the `/talk` stream
> via `onSubmitMessage`, and `VOICE_MOCK_TRANSCRIPTS` is used only as an
> explicit offline/error fallback. Proven from the transcript by: `bunx biome
> check .` exits 0; from `app/`, `bun --bun x svelte-kit sync && bun --bun x
> svelte-check --tsconfig ./tsconfig.json` exits 0; `bun test tests` (in `app/`)
> is green including new unit tests for the audio-encode helper and the
> transcription client/endpoint; and `rg "VOICE_MOCK_TRANSCRIPTS" app/src` shows
> it referenced only inside the fallback branch, never as the default
> voice-note body. No files outside "Files to touch" are changed.

> Note: the live RedPill round-trip **cannot be verified in this environment**
> (no API key, no microphone). The goal is deliberately written so every clause
> is provable from `lint` / `check` / `bun test` output plus a `rg` grep — the
> network call is covered by unit tests against a mocked OpenAI client, and the
> real call is exercised manually later with a key.

## Approach

Three pieces: **capture**, **transcribe (server-side)**, **wire to /talk**.

### 1. Keep the composer dumb — inject transcription via a prop

`IntentComposer` lives under `intent-mock/` and is reused by `HitlActionBar`. Do
**not** hardcode `fetch`/SDK calls in it. Add one optional prop:

```ts
onTranscribeAudio?: (audio: Blob) => Promise<string>
```

- Real audio capture (getUserMedia + MediaRecorder) is added to the composer's
  listening mode so a `Blob` actually exists on commit.
- `commitVoiceNote()` becomes: stop the recorder → get the `Blob` → if
  `onTranscribeAudio` is provided, `await` it and submit the returned transcript;
  otherwise (or on error) fall back to a random `VOICE_MOCK_TRANSCRIPTS` entry.
- `SparkTalkPanel` passes a real `onTranscribeAudio` that calls the
  transcription client. `HitlActionBar` passes nothing → keeps the mock, so
  retrain/HITL flows are untouched.

This keeps the mock as a true fallback (satisfies the `rg` clause of the goal)
and isolates all network/secret concerns to the talk surface + a small client.

### 2. Server-side transcription — `openai` SDK pointed at RedPill

RedPill / Phala is OpenAI-compatible, so use the official `openai` package:

```ts
import OpenAI from 'openai'
import { env } from '$env/dynamic/private' // server-only; never bundled to client

const client = new OpenAI({
  apiKey: env.REDPILL_API_KEY,
  baseURL: 'https://api.redpill.ai/v1', // CONFIRM exact base URL
})
```

Gemma is a **multimodal chat** model, not a Whisper-style speech endpoint, so
transcription goes through **chat.completions with an audio content part**
(base64-encoded audio), *not* `client.audio.transcriptions.*`:

```ts
const res = await client.chat.completions.create({
  model: 'google/gemma-4-31b-it', // CONFIRM exact RedPill model slug
  messages: [{
    role: 'user',
    content: [
      { type: 'text', text: 'Transcribe this voice note verbatim. Return only the transcript.' },
      { type: 'input_audio', input_audio: { data: base64Audio, format: 'webm' } },
    ],
  }],
})
const transcript = res.choices[0]?.message?.content?.trim() ?? ''
```

**Where this runs** — pick in **Open decisions** before building:

- **Option A (recommended for "plug-and-play" dev): SvelteKit `+server.ts`** at
  `app/src/routes/api/transcribe/+server.ts` (POST, multipart or base64 JSON).
  Reads `REDPILL_API_KEY` via `$env/dynamic/private`. Works under `bun dev:app`.
  Must be kept out of the static build: add `export const prerender = false`
  and gate the static `tauri:build` so adapter-static does not try to emit it
  (e.g. build-time exclude, or `// @ts-ignore`-style guard documented inline).
  The browser → endpoint call uses a relative URL so it only works in dev/served
  mode — acceptable for the first cut.
- **Option B (production-correct): Tauri Rust command** (`groove_runtime` op or a
  dedicated `transcribe_audio` command) that calls RedPill with `reqwest`,
  reading `REDPILL_API_KEY` from the process env. Works in the shipped bundle and
  keeps the key fully off the web layer. More work; not the "standard openai
  sdk" the request describes.

Recommendation: implement **Option A** now (matches the request and is testable
in dev), and leave a `TODO` + a follow-up inbox item for **Option B** so the
shipped Tauri app also works. Flag this explicitly in the Progress log.

### 3. Wire `REDPILL_API_KEY`

- Add `REDPILL_API_KEY="your-redpill-api-key"` to
  [`.env.example`](../../../../.env.example) (the repo root) with a one-line
  comment and the RedPill model/base-URL reference.
- The real `.env` already exists at repo root and is git-ignored; the dev
  scripts load it (`bun --env-file=../.env`, plus Vite `loadEnv`). No new env
  plumbing needed — just read it server-side.

### Out of scope

- Streaming/partial transcripts (return the full string once).
- Diarization, language selection UI, translation.
- The Tauri/Rust production path (Option B) beyond a documented TODO + follow-up
  inbox item — unless the Open decision flips to B.
- Audio transcoding (webm/opus → wav/mp3). Send the recorder's native container
  and confirm RedPill accepts it; transcoding is a follow-up if it does not.

## Steps

1. **Add real capture to the composer.** In `IntentComposer.svelte`, on
   `openListening()` start `navigator.mediaDevices.getUserMedia({ audio: true })`
   + `MediaRecorder`; collect chunks; on `stopListening()`/cancel, stop the
   stream and tracks. Handle permission denial gracefully (fall back to mock,
   surface nothing scary). Keep the existing timer/waveform UI.
2. **Add the `onTranscribeAudio` prop** and rewrite `commitVoiceNote()` to be
   async: assemble the `Blob`, call the prop if present, submit the resulting
   transcript via `onSubmitMessage(transcript, [])`; on missing prop or any
   error, fall back to a `VOICE_MOCK_TRANSCRIPTS` entry. Show the existing
   `submitBusy` affordance while transcribing.
3. **Create the transcription client** `app/src/lib/intent-mock/transcribe.ts`
   (browser-side): POST the audio to the endpoint, return the transcript string.
   Pure, unit-testable; injectable `fetch` for tests.
4. **Create the endpoint** (Option A) `app/src/routes/api/transcribe/+server.ts`:
   construct the `openai` client against RedPill, read `REDPILL_API_KEY` from
   `$env/dynamic/private`, call `chat.completions.create` with the audio part,
   return `{ transcript }`. `export const prerender = false`; guard so
   adapter-static build still succeeds.
5. **Add a small encode helper** `app/src/lib/intent-mock/audio-encode.ts`
   (Blob/ArrayBuffer → base64 + mime/format detection) and unit-test it.
6. **Wire `SparkTalkPanel`** to pass `onTranscribeAudio={transcribeVoiceNote}`
   to its `IntentComposer`.
7. **Add `openai`** to `app/package.json` dependencies; update lockfile.
8. **Add `REDPILL_API_KEY`** to `.env.example`.
9. **Tests** under `app/tests/`: encode helper round-trip; transcription client
   against a mocked `fetch`; endpoint handler against a mocked OpenAI client
   (assert model id, base URL, key sourced from env, transcript extraction, and
   error → non-200).
10. **Run the verification block**; check off acceptance criteria; update the
    Progress log; `git mv` to `test/`.

## Files to touch

- `app/src/lib/intent-mock/IntentComposer.svelte` — real MediaRecorder capture in
  listening mode; new `onTranscribeAudio` prop; async `commitVoiceNote()` with
  mock-only-as-fallback.
- `app/src/lib/intent-mock/transcribe.ts` — **new**: browser client that POSTs
  audio and returns the transcript.
- `app/src/lib/intent-mock/audio-encode.ts` — **new**: Blob → base64/format helper.
- `app/src/routes/api/transcribe/+server.ts` — **new** (Option A): RedPill call
  via `openai` SDK; `REDPILL_API_KEY` from `$env/dynamic/private`; `prerender = false`.
- `app/src/lib/sparks/SparkTalkPanel.svelte` — pass `onTranscribeAudio` to the composer.
- `app/package.json` (+ `bun.lock`) — add `openai`.
- `.env.example` — add `REDPILL_API_KEY` with comment + model/base-URL note.
- `app/tests/transcribe.test.ts`, `app/tests/audio-encode.test.ts` — **new** unit tests.

## Open decisions (resolve before building)

- **A vs B (where the model call runs).** A = SvelteKit `+server.ts` (dev,
  matches the request); B = Tauri Rust command (production-correct). Recommend A
  now + a follow-up inbox item for B. *If shipping in the Tauri bundle is a
  requirement of this item, switch to B and revise Files-to-touch.*
- **Exact RedPill base URL and model slug.** Plan assumes
  `https://api.redpill.ai/v1` and `google/gemma-4-31b-it` (from the
  phala.com/.../google/gemma-4-31b-it link). Confirm against RedPill docs.
- **Gemma audio modality.** Assumes `chat.completions` `input_audio` content
  parts are supported. If Gemma on RedPill does not accept audio, this item is
  blocked on a speech-capable model — surface immediately rather than faking it.
- **Audio container.** MediaRecorder typically emits `webm/opus`. Confirm RedPill
  accepts it; otherwise add transcoding (follow-up).

## Acceptance criteria

Each box must be checkable from the transcript (a command + its output proves it).

- [ ] `bunx biome check .` exits 0 — proven by running it.
- [ ] From `app/`: `bun --bun x svelte-kit sync && bun --bun x svelte-check --tsconfig ./tsconfig.json` exits 0 — proven by running it.
- [ ] From `app/`: `bun test tests` is green, including the new `audio-encode` and `transcribe`/endpoint unit tests — proven by the test output.
- [ ] `rg "VOICE_MOCK_TRANSCRIPTS" app/src` shows the array referenced only inside the fallback branch of `commitVoiceNote()`, never as the default voice-note body — proven by the grep output + the surrounding diff.
- [ ] `rg "REDPILL_API_KEY" .env.example app/src` shows the key added to `.env.example` and read only via `$env/dynamic/private` (server side), with **no** `VITE_/PUBLIC_/TAURI_ENV_` prefix and no browser reference — proven by the grep output.
- [ ] `rg "google/gemma-4-31b-it" app/src` shows the model id wired into the RedPill `chat.completions` call — proven by the grep output.
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
rg "REDPILL_API_KEY" .env.example app/src
rg "google/gemma-4-31b-it" app/src
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

- `2026-06-02` — Planned and specced directly into `plan/`. Mapped the faked
  voice-note path (`commitVoiceNote` → `VOICE_MOCK_TRANSCRIPTS`), the
  `onSubmitMessage` → `SparkTalkPanel.handleComposerSubmit` → `messages.create`
  flow into `/talk`, and the absence of any existing AI backend. Surfaced the
  adapter-static / no-runtime-server constraint and the A-vs-B decision for
  where the RedPill call runs. Goal written to be provable from
  lint/check/test/grep output since the live call can't be tested here.
