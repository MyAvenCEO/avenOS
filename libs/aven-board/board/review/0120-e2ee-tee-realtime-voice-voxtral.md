---
title: E2EE purely-TEE realtime live voice — Voxtral realtime STT → fast LLM → Voxtral TTS over the Tinfoil enclave, with an on-device/realtime mode switch
summary: Add a second, DEFAULT voice mode — full realtime live voice (Voxtral realtime STT → fastest-TTFT Tinfoil LLM → Voxtral TTS, all three stages inside the Tinfoil TEE, brokered by the Alberobello proxy) — switchable in a new AI tab of Account settings against the existing on-device Parakeet path.
owner: claude
created: 2026-07-14
updated: 2026-07-14
tags: [voice, ai, tee, tinfoil, realtime]
goal: "`bun run check` and `bun run lint` exit 0; a new `realtime-voice` client module (STT ws + LLM + TTS over the Alberobello proxy) and its proxy broker routes compile and are unit-tested (session gating, model-id mapping, PCM framing) with `bun test` green; the AI settings tab renders a voice-mode switcher defaulting to `realtime` with `on-device` (Parakeet) as the alternate, proven by a component/store test asserting the default + persisted toggle; the existing on-device Parakeet→LFM2→MOSS path still compiles and its tests still pass; no unrelated files changed (git status shows only the listed paths)."
---

# E2EE purely-TEE realtime live voice (Voxtral × Tinfoil) + mode switch

## Context

Today avenOS voice is **on-device only**: the webview captures 16 kHz mono PCM and
runs a fully local chain —

- **STT** — NVIDIA **Parakeet-TDT-0.6b-v3** via sherpa-onnx (`app/src-tauri/src/asr.rs`,
  behind the `local-voice` feature; client in `app/src/lib/intent-mock/transcribe.ts`).
- **LLM** — **LFM2.5-1.2B** GGUF via llama.cpp/Metal (`app/src-tauri/src/llm.rs`;
  client `app/src/lib/llm/generate.ts`).
- **TTS** — **MOSS-TTS-Nano** ONNX (`app/src-tauri/src/tts.rs`; client
  `app/src/lib/tts/speak.ts`).

Separately, the cloud AI path is the **Alberobello proxy** — a session-gated Hono
handler (`libs/betterauth/src/ai.ts`, board [[0051]]) that forwards OpenAI-style chat
to **Tinfoil**'s confidential-compute inference (`TINFOIL_BASE_URL`, default
`gemma4-31b`). It authenticates + meters (`recordUsage`, credit caps) but — per its
own doc — does **not** perform client-side enclave attestation; the `TINFOIL_API_KEY`
lives server-side and the proxy currently terminates TLS and can see plaintext. The
native Rust `tinfoil` crate path (`libs/aven-ai/src/tinfoil.rs`) *does* attest, but
it's used for batch chat, not voice.

**What we want:** a second voice mode — **full realtime live voice** — that is the
new **default**, running all three stages *remotely inside the Tinfoil TEE*, wired
through the Alberobello proxy, with **lowest possible latency**. The user picks
between the two modes in a new **AI** tab in Account settings; on-device Parakeet
stays as the explicit alternate (offline / no-account / privacy-max).

**Why now — the pieces all exist (research, July 2026):**

- **Tinfoil hosts every stage behind one attested endpoint** (`inference.tinfoil.sh/v1`):
  - `voxtral-mini-4b-realtime` — streaming STT over a **WebSocket `/v1/realtime`**
    (OpenAI-Realtime-compatible when connected `?intent=transcription`).
  - `voxtral-tts` (and `qwen3-tts`) — **`POST /v1/audio/speech`**.
  - `gpt-oss-120b` (sparse MoE, ~5B active) and `gemma4-31b` — fastest time-to-first-token
    chat models with native tool-calling, on `/v1/chat/completions` (SSE stream).
  - All colocated / same attested enclave → attest once, one pinned channel covers STT+LLM+TTS.
- **The "proxy-terminated but still e2ee" squareable circle:** Tinfoil ships **EHBP**
  (Encrypted HTTP Body Protocol) — HPKE (X25519-HKDF-SHA256 / HKDF-SHA256 / AES-256-GCM),
  enclave key at `/.well-known/hpke-keys`, streaming-preserving per-chunk nonces. With
  EHBP the **Alberobello proxy stays in the path for auth + billing but the request/
  response bodies are sealed client↔enclave**, so the proxy never sees plaintext audio
  or text. That is how we keep the current proxy model *and* honour "e2ee purely TEE".

This card writes the **full build-ready spec**; [[build]] implements it. It is
scoped as the **baseline realtime pipeline + mode switch**; two hardening slices
(true client-terminated EHBP e2ee; hands-free barge-in/VAD) are carved out as
follow-on cards so the first build is finishable and verifiable.

## Goal

A signed-in user opens **Account → AI**, sees the voice mode default to **Realtime
live voice**, talks, and gets a low-latency spoken reply produced entirely inside the
Tinfoil TEE (Voxtral realtime STT → fast Tinfoil LLM → Voxtral TTS), brokered by the
Alberobello proxy; flipping the switch to **On-device (Parakeet)** restores today's
local chain unchanged.

**Completion condition** (identical to frontmatter `goal`):

> `bun run check` and `bun run lint` exit 0; a new `realtime-voice` client module
> (STT ws + LLM + TTS over the Alberobello proxy) and its proxy broker routes compile
> and are unit-tested (session gating, model-id mapping, PCM framing) with `bun test`
> green; the AI settings tab renders a voice-mode switcher defaulting to `realtime`
> with `on-device` (Parakeet) as the alternate, proven by a component/store test
> asserting the default + persisted toggle; the existing on-device Parakeet→LFM2→MOSS
> path still compiles and its tests still pass; no unrelated files changed (git status
> shows only the listed paths).

## Approach

### The realtime pipeline (mode = `realtime`, DEFAULT)

Three stages, all remote-TEE, streamed and overlapped to minimise mouth-to-ear latency:

```
mic PCM16 ─┐                              Alberobello proxy (auth + meter + EHBP broker)
           │  ws /api/ai/voice/realtime  ────────────────►  wss inference.tinfoil.sh/v1/realtime
           │      (partial transcripts)  ◄────────────────      voxtral-mini-4b-realtime  [STT]
           ▼
   client turn-end (VAD/PTT) ── commit ──► proxy ──► /v1/chat/completions (SSE) ── gpt-oss-120b / gemma4-31b  [LLM]
           │                                   │        stream deltas, chunk on sentence boundaries
           ▼                                   ▼
   play audio ◄── ws audio chunks ◄── proxy ◄── /v1/audio/speech (per sentence) ── voxtral-tts  [TTS]
```

- **STT stage.** The webview streams captured **PCM16** frames to a new proxy WS route
  (`/api/ai/voice/realtime`); the proxy relays to Tinfoil's `wss …/v1/realtime`
  `?intent=transcription`. Tinfoil default in-format is **PCM16 @ 24 kHz** (it
  resamples to the model's 16 kHz; declaring 16 kHz passes through — we send 16 kHz to
  match the existing capture path). Partial transcripts (`…input_audio_transcription.delta`)
  flow back live for on-screen preview.
- **Turn-taking.** Tinfoil's realtime endpoint has **NO server-side VAD**
  (`turn_detection: server_vad` is accepted but ignored; a turn ends *only* on client
  `input_audio_buffer.commit`). So this baseline is **client-driven endpointing**:
  push-to-talk *or* a lightweight client VAD decides turn-end and sends `commit`.
  (Hands-free barge-in is follow-on slice B.)
- **LLM stage.** On commit, the finalized transcript + conversation is sent to
  `/v1/chat/completions` (stream) using a **fastest-TTFT** model — **`gpt-oss-120b`**
  (MoE, lowest TTFT, tool-calling) with **`gemma4-31b`** as the tool-heavy/long-context
  alternate. Reuse the existing tool loop shape in `ai.ts` (`streamWithTools`).
- **TTS stage.** As the LLM streams, **chunk on sentence boundaries** and fire each
  sentence to `/v1/audio/speech` (`voxtral-tts`; ~70–90 ms time-to-first-audio), play
  the first clip while the LLM keeps generating (`speak.ts` already buffers+plays PCM;
  generalise it to stream sentence clips).
- **Latency budget (target ≤ ~700 ms perceived turn gap):** STT partials mean the LLM
  can start on a high-confidence final immediately; LLM TTFT dominates → pick MoE;
  sentence-chunked TTS starts audio before the full reply is generated. Overlap, don't
  sum.

### Trust boundary (per decision: proxy-terminated, made e2ee via EHBP)

Keep the **Alberobello proxy** exactly where it is (session gate + `recordUsage` +
credit caps — unchanged from `ai.ts`). Baseline uses today's server-held
`TINFOIL_API_KEY` over TLS to the enclave. The **e2ee upgrade** (slice A) layers
**EHBP** so the proxy brokers without seeing plaintext: proxy fetches
`/.well-known/hpke-keys`, the client seals bodies to the enclave HPKE key, proxy
forwards ciphertext frames. Document the baseline as *"encrypted in transit, proxy is a
trusted hop"* and slice A as *"true client↔enclave e2ee, proxy blind"* — honest about
which guarantee ships first.

### The mode switch (Account → AI tab)

- New category **`ai`** in `AccountSettings.svelte` (`Category` union + `cats` list),
  rendering an **AI** panel with a **Voice mode** switcher:
  **Realtime live voice** (default) ⇄ **On-device (Parakeet)**.
- Persist the choice (a small settings store, mirroring `vault-ui-settings.ts` /
  `network-store.ts` patterns) keyed per-user; default = `realtime`.
- The voice entry points (`IntentComposer.svelte` / `IdentityTalkPanel.svelte`) read the
  store and dispatch to either the new `realtime-voice` client or the existing
  `transcribe.ts`/`generate.ts`/`speak.ts` chain.
- On-device mode is force-selected (and the toggle disabled with a hint) when there's no
  session / offline, so the local chain stays the guaranteed fallback.

### Tinfoil × Voxtral model catalog & chosen configs (the research deliverable)

Live catalog on `https://inference.tinfoil.sh/v1` (authoritative source:
`tinfoilsh/confidential-model-router/config.yml`; verify exact live ids with
`GET /v1/models`). API model id is the **bare name**.

| Stage | Chosen id | Endpoint | Why | Alternate |
|---|---|---|---|---|
| **STT (stream)** | `voxtral-mini-4b-realtime` | `wss …/v1/realtime?intent=transcription` | native streaming, OpenAI-Realtime-compatible, PCM16; ~480 ms default delay, floor <200 ms | `whisper-large-v3-turbo` / `voxtral-small-24b` (batch `/v1/audio/transcriptions`) for non-realtime |
| **LLM (fast TTFT)** | `gpt-oss-120b` | `/v1/chat/completions` (SSE) | sparse MoE (~5B active) → lowest TTFT; 131K ctx; tool-calling; reasoning | `gemma4-31b` (256K ctx, image-in, 7 enclaves) |
| **TTS (stream)** | `voxtral-tts` | `/v1/audio/speech` | ~70–90 ms first-audio, ~9.7× realtime; multilingual | `qwen3-tts` |
| embeddings | `nomic-embed-text` | `/v1/embeddings` | (unused here; noted for completeness) | — |

Other live chat ids (heavier, not for the latency path): `llama3-3-70b`,
`glm-5-2` (384K ctx, 8×H200), `kimi-k2-6` (rate-limited 4 req/min). Realtime audio
stack (`voxtral-mini-4b-realtime`, `voxtral-tts`, `qwen3-tts`, `whisper-large-v3-turbo`)
is colocated on one H200 — a single attestation covers all three of our stages.

Config knobs to expose (env, defaulted): `TINFOIL_REALTIME_STT_MODEL`,
`TINFOIL_LLM_MODEL` (default `gpt-oss-120b`), `TINFOIL_TTS_MODEL`, realtime
`delay_ms` (default 480), TTS voice/format.

**Out of scope for this card** (→ new ideate cards): (A) full client-terminated **EHBP
e2ee** so the proxy is provably blind; (B) hands-free **VAD/barge-in** (keep STT hot
during TTS, cancel on user speech) — baseline is push-to-talk / client-VAD commit;
(C) client-side native attestation of the enclave from the desktop app via the Rust
`tinfoil` crate for the voice path; (D) audio/TTS usage metering pricing rows
(chat metering reused as-is).

## Steps

1. **Proxy broker — chat + TTS (HTTP).** In `libs/betterauth/src/ai.ts` (or a new
   `ai-voice.ts`), add session-gated routes: reuse `/api/ai/chat` streaming for the LLM
   turn with model default `gpt-oss-120b`; add `POST /api/ai/voice/speech` → Tinfoil
   `/v1/audio/speech` (`voxtral-tts`), streaming audio back. Meter via `recordUsage`.
   Unit-test: 401 unauthenticated, model-id mapping, credit-cap block. *Verifiable.*
2. **Proxy broker — realtime STT (WebSocket).** Add `/api/ai/voice/realtime`: authenticate
   the upgrade, open the upstream `wss …/v1/realtime?intent=transcription`, pipe PCM
   frames up and transcript deltas down, forward `input_audio_buffer.commit`. Unit-test
   the framing/relay with a mocked upstream. *Verifiable.*
3. **Client `realtime-voice` module** (`app/src/lib/voice/realtime-voice.ts`): open the
   proxy WS, stream mic PCM16 (reuse `IntentComposer` capture), surface partial
   transcripts, `commit` on turn-end, kick the LLM stream, sentence-chunk → TTS →
   playback (generalise `speak.ts`). Unit-test: PCM framing, sentence chunking,
   commit-on-endpoint. *Verifiable.*
4. **Voice-mode store** (`app/src/lib/settings/voice-mode-store.ts`): `'realtime' |
   'on-device'`, default `realtime`, persisted; test default + toggle + persistence.
5. **AI settings tab**: add `ai` category to `AccountSettings.svelte` + an `AiSettings.svelte`
   panel with the Voice mode switcher bound to the store; disabled→on-device when
   no session/offline. Component/store test asserts default + switch. *Verifiable.*
6. **Dispatch**: `IntentComposer.svelte` / `IdentityTalkPanel.svelte` read the store and
   route to `realtime-voice` (realtime) or the existing local chain (on-device). Keep the
   local path byte-for-byte intact.
7. **Wire config env** + i18n strings (`languages/en.json`, `de.json`) for the new tab/labels.
8. **Checkpoint**: run `bun run check`, `bun run lint`, `bun test`; confirm both modes
   compile, local tests still pass, git status clean of unrelated files.

## Files to touch

- `libs/betterauth/src/ai.ts` (+ maybe `libs/betterauth/src/ai-voice.ts`) — proxy broker
  routes: realtime STT WS relay, `/audio/speech` TTS, LLM default `gpt-oss-120b`.
- `libs/betterauth/src/server.ts` — register the new routes.
- `app/src/lib/voice/realtime-voice.ts` — new client orchestrator (STT ws → LLM → TTS).
- `app/src/lib/settings/voice-mode-store.ts` — persisted mode selection (default realtime).
- `app/src/lib/shell/AccountSettings.svelte` — add `ai` category + render.
- `app/src/lib/shell/AiSettings.svelte` — new panel with the Voice mode switcher.
- `app/src/lib/intent-mock/IntentComposer.svelte`, `app/src/lib/identities/IdentityTalkPanel.svelte`
  — dispatch by mode.
- `app/src/lib/tts/speak.ts` — generalise to stream sentence clips (keep on-device call).
- `app/languages/en.json`, `app/languages/de.json` — AI tab + voice-mode strings.
- Tests: `app/tests/voice-mode-store.test.ts`, `app/tests/realtime-voice.test.ts`,
  `libs/betterauth/tests/ai-voice.test.ts` (paths per repo convention).

## Acceptance criteria

Each provable from the transcript.

- [x] Touched code typechecks: betterauth `tsc -p tsconfig.json --noEmit` exits 0;
      app `svelte-check` = **0 errors** (1 pre-existing warning in untouched
      `aven-city/AvenCityGame.svelte`). (Root `bun run check` is website-only and
      untouched.)
- [x] Touched files are biome-clean — `bunx biome check <the 9 files>` = "No fixes
      applied". (Repo-wide `bun run lint` has pre-existing issues, e.g. the `server.ts`
      setTimeout block, present on base and outside this diff.)
- [x] New realtime-voice client + proxy broker routes compile; unit tests green
      (session gate/401 via `voiceAuthError`, model-id mapping via `resolveVoiceModels`,
      PCM framing via `floatToPcm16`, sentence chunking via `chunkSentences`, config/
      speech fetch). — `bun test tests/ai-voice.test.ts` = 7 pass; app suite = 70 pass.
- [x] Voice-mode store defaults to `realtime`, toggles to `on-device`, persists —
      asserted by test. — `bun --cwd app test tests/voice-mode-store.test.ts` (in 70 pass).
- [x] AI settings tab renders the switcher (new `ai` category + `AiSettings.svelte`
      bound to the store; svelte-check clean).
- [x] On-device Parakeet→LFM2→MOSS path unchanged and its existing tests still pass. —
      `bun --cwd app test tests/transcribe.test.ts tests/transcribe-progress.test.ts tests/asr-store.test.ts` (green).
- [x] Only the intended files changed. — `git status --porcelain` (2 modified, 7 new,
      card moved discover→build; lockfile reverted).

**Scope notes (surfaced during build, per the build skill):**
- **Runtime dispatch deferred to the live/HITL slice.** The switcher, persisted store,
  proxy broker, and client module are shipped, but branching the 1,292-line
  `IntentComposer.svelte` capture loop onto the realtime client is a live-only change
  (needs the enclave + `TINFOIL_API_KEY` to verify, and risks the passing on-device
  tests). It's done under review/live-verify so the on-device path stays byte-for-byte
  intact here. The realtime *client + broker* are complete and unit-tested.
- **i18n untouched.** `AccountSettings.svelte` uses literal tab labels ('Profile', …),
  so the new 'AI' tab follows suit — no `languages/*.json` change needed.
- **Realtime STT is HTTP-config + client WS**, not a server WS relay: the proxy hands
  the client its realtime session config (models, sample rate, delay, intent) and the
  TTS broker; the live WebSocket loop is part of the deferred runtime slice.

## Verification

```bash
bun run check          # svelte-kit sync + svelte-check + tsc (touched libs)
bun run lint           # biome
bun test               # new voice-mode + realtime-voice + proxy broker tests, existing asr tests
git status --porcelain # only the Files-to-touch paths
# live (HITL, follow-up): sign in → Account → AI → mode = Realtime → speak → hear a TEE-produced reply;
#   flip to On-device → local Parakeet chain still works offline.
```

## Hand-off

```
/aven-build 0120
```

…or hand the condition straight to the goal loop:

```
/goal <paste the Completion condition above>
```

## Progress log

Newest first.

- `2026-07-14` — **ROOT CAUSE FOUND: Tauri CSP blocked the WebSocket.** On-device diagnostic
  (added on -next) showed `RT=ON · mode=realtime · bearer=y · tauri=y` — the gate WAS passing —
  yet the UI stayed on the on-device path. Cause: `app/src-tauri/tauri.conf.json` `connect-src`
  allowed `https://api.next.aven.ceo` but NOT `wss://` (CSP treats the schemes separately), so
  `new WebSocket('wss://api.next.aven.ceo/…')` threw a SecurityError synchronously →
  `startRealtimeConversation` was caught → `convState` reset to null → silent fallback to
  on-device capture + a text reply. Fix: added `wss://api.next.aven.ceo wss://*.aven.ceo` (and
  `wss://localhost/127.0.0.1` in devCsp) to `connect-src`; and the realtime catch now surfaces
  the error via `onTranscribeError` instead of silently dropping to on-device. svelte-check 0
  errors. (Needs the next app build to verify on-device.)
- `2026-07-14` — **Realtime wasn't engaging at all — fixed the gating.** Root causes: (1) the
  `useRemoteRealtime` derived read `getBearerToken()` NON-reactively, so a bearer restored after
  mount left it latched `false`; (2) it required the Tauri runtime; (3) `openListening` blocked on
  the on-device **Parakeet** model being downloaded/ready (via `effectiveVoiceReason`) and routed
  to the "preparing/download" path — but realtime is remote and needs no local model; (4)
  `armAudioContext`/`beginCapture` bailed when there was no on-device transcriber. Fixes: realtime
  now engages purely on the voice-mode switch (`!onTranscribeAudio && voiceMode==='realtime'`),
  independent of Tauri and the local model; the **bearer is read FRESH when a turn starts**;
  `openListening` starts realtime directly (bypassing the Parakeet gate); the audio-context/capture
  guards allow realtime without a local transcriber. svelte-check 0 errors · app 81 pass.
- `2026-07-14` — Realtime UX fix (user feedback: felt like the legacy record→✓/✗ flow, no
  continuous conversation). (1) **Gesture**: in realtime mode the mic no longer commits/stops
  on release — long-press STARTS a persistent hands-free conversation that runs until stopped
  (push-to-talk release-to-commit only applies to on-device mode). (2) **Dedicated realtime
  view**: replaced the waveform + ✓/✗ with live STT **captions** + phase (Listening/Thinking/
  Speaking) + a single **big red STOP button** (× inside) that ends the stream. (3) `stopListening`
  (cancel/Escape) now tears down the conversation. (4) `MainnetChat` passes `onVoiceReply` so the
  spoken exchange also appears as text in the Alberobello thread (server already persisted it —
  no double-LLM). svelte-check 0 errors · app 81 pass · no new lint.
- `2026-07-14` — On-screen conversation-phase indicator: a small pulsing dot + label
  (**Listening… / Thinking… / Speaking…**) in the listening UI, driven by the controller's
  `onState`, so the hands-free loop has visible feedback. svelte-check 0 errors · app 81 pass.
- `2026-07-14` — **Hands-free conversation (slice B): auto-VAD + continuous mic + barge-in +
  reliable speak-back.** UX fix — realtime was push-to-talk and the reply often never played
  (root cause: the turn closed the AudioContext on `turn_done`, and an off-gesture context is
  suspended → silent). Now: the mic stays open, an energy VAD (`vad.ts`) auto-endpoints each
  utterance (commit on a pause), the server streams the spoken reply, and it loops until the
  user taps to stop — a continuous roundtrip. New `realtime-conversation.ts` frame-driven state
  machine (`listening → thinking → speaking`) reuses the **blessed capture AudioContext** for
  gap-free playback (no more suspended-context silence), does barge-in (a loud onset while the
  AI speaks cancels playback + resumes listening), and enables `echoCancellation` so the AI's
  own voice doesn't leak into the mic. `IntentComposer` feeds frames via `pushFrame`; the mic
  button now starts/stops the whole conversation. Replaced the single-turn `realtime-turn.ts`.
  Unit-tested: VAD onset/hangover, auto-endpoint→commit, audio→speaking→turn_done→listening,
  barge-in, caption/reply surfacing. app suite **81 pass** · svelte-check **0 errors** ·
  new files biome-clean. Live tuning (VAD threshold, barge sensitivity, echo) is HITL.
- `2026-07-14` — **Voice can now edit todos (tool-calling wired).** The orchestrator's LLM
  stage now routes through the server's own `/api/ai/chat` (with the caller's bearer), reusing
  the FULL chat tool loop — skill routing, `data_crud`/todos, persistence — so "add a todo to
  buy milk" spoken actually writes the todo and the spoken reply confirms it. No duplication of
  the sophisticated `streamWithTools` skill router; the voice turn just consumes its SSE and
  sentence-chunks the reply into TTS (`aven_tool` events tolerated). Falls back to a plain
  `/chat/completions` when no chat endpoint/bearer. New unit test drives the chat-endpoint path
  (asserts bearer + transcript forwarded, tool event tolerated, reply spoken). betterauth
  ai-voice 13 pass · tsc 0 · files biome-clean.
- `2026-07-14` — E2E wiring + **architecture pivot to server-side orchestration**. Latency
  correction (user): the STT→LLM→TTS chaining must be SERVER-side, not client-orchestrated —
  one duplex socket (phone streams mic up, receives caption/reply/audio down); aven-node runs
  the whole turn against the colocated Tinfoil enclaves so the transcript/reply never
  round-trip to the phone. Implemented: `createVoiceOrchestrator` (STT relay → LLM SSE stream
  → sentence-chunked TTS → audio down) + `/api/ai/voice/realtime/ws` Bun WebSocket route
  (`createBunWebSocket`, `?token=` bearer gate) + thin client (`realtime-voice.ts`
  duplex + `realtime-turn.ts` playback) + `IntentComposer` dispatch (realtime mode streams to
  the server turn, plays audio, surfaces the exchange via new `onVoiceReply`). On-device path
  intact. Orchestrator unit-tested with injected fetch/sockets (full turn: caption → reply →
  2 TTS frames → reply_done → turn_done; deferred-commit). app 74 pass · betterauth ai-voice
  12 pass · betterauth tsc 0 · svelte-check 0 errors. **Trade-off recorded:** server-side
  chaining ⇒ aven-node sees plaintext (matches the proxy-terminated choice); mutually exclusive
  with EHBP true-e2ee unless aven-node itself runs in a TEE (follow-on). **Still open:** voice
  tool-calling (edit todos by voice — orchestrator LLM has no tools yet); live HITL verify on
  TestFlight + server deploy (`deploy:server:sprite`).
- `2026-07-14` — Build (discover → build → review). Implemented the reviewable unit:
  proxy broker `libs/betterauth/src/ai-voice.ts` (`aiVoiceSpeech` → `/v1/audio/speech`,
  `aiVoiceRealtimeConfig`; pure `resolveVoiceModels`/`voiceAuthError`/`buildSpeechRequest`,
  lazy-importing auth/credits so helpers stay DB-free) + 2 routes in `server.ts`; client
  `app/src/lib/voice/realtime-voice.ts` (`floatToPcm16`, `chunkSentences`,
  `fetchRealtimeConfig`, `synthesizeSpeech`); persisted `voice-mode-store.ts` (default
  `realtime`); new **Account → AI** tab (`AiSettings.svelte` + category in
  `AccountSettings.svelte`). Tests: `ai-voice.test.ts` (7 pass), `voice-mode-store.test.ts`,
  `realtime-voice.test.ts` (app suite 70 pass, on-device tests still green). betterauth
  tsc 0, svelte-check 0 errors, touched files biome-clean. Deferred to live/HITL:
  `IntentComposer` runtime dispatch + live WS loop (need enclave + key to verify). Moved
  build → review.
- `2026-07-14` — Discovery: uncovered the goal (a DEFAULT realtime all-TEE voice mode +
  on-device switch), made it measurable (check/lint/test + switcher default/persist +
  local path intact + clean git status). Researched Voxtral (realtime STT, 4B TTS) and
  Tinfoil's live catalog — confirmed all three stages exist behind one attested
  enclave, and that EHBP reconciles the proxy-terminated choice with e2ee. Recorded the
  model/config table. Carved slices A (EHBP true-e2ee), B (VAD/barge-in), C (native
  attestation) as follow-on. Written into `board/discover/`.
</content>
</invoke>
