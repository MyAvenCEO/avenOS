---
title: LiveKit realtime voice in /dashboard — prove the voice → tool → UI loop with a CRUD todos vertical
summary: Wire a pure-LiveKit realtime voice agent into the dashboard view — talk to it in a call and it creates, lists, edits and deletes todos in the browser's own store over LiveKit RPC, with the same store driving a hand-editable todos UI. Proves the loop and evaluates LiveKit Inference as the stack.
owner: claude
created: 2026-08-09
updated: 2026-08-09
tags: [voice, livekit, realtime, dashboard, spike]
goal: "`bun run check` and `bun run lint` exit 0, and `bun test` passes — including `libs/aven-voice-agent/test/loop.live.test.ts`, which connects to the real `LIVEKIT_URL`, drives one text turn (\"add buy milk to my todos\") through the LiveKit-Inference session and asserts a `todo.create` RPC reached the browser-side participant with a title matching /milk/i and that the client store then holds exactly one todo; and `git status --short` lists only paths named in 'Files to touch'."
---

# LiveKit realtime voice in /dashboard — the voice → tool → UI loop

## Context

Card [[0121]] stripped avenOS to the avenCITY seed: `libs/` is now just
`aven-board` and `aven-city`, there is no database, no auth server, no aven-db,
and no voice stack. The app is SvelteKit with `adapter-static` + `ssr = false`,
shipped inside Tauri. Immediately before this card, commit `07613bda` split the
world onto `/game` and made `/` a selector, leaving `/dashboard` a stub that
renders a greeting and "coming soon".

This card fills that stub with the first real avenOS capability on the fresh
seed: **a realtime voice call with an agent that manipulates UI state by voice.**

Two goals, both named by the user in discovery:

1. **Prove the loop.** Speak → the agent calls a tool → the browser's UI updates
   live. The todos are deliberately throwaway scaffolding; the loop is the
   deliverable. If it holds, every later avenOS vertical can be voice-driven.
2. **Evaluate LiveKit Cloud as the stack.** Specifically the *pure* LiveKit
   stack — LiveKit Inference serving STT, LLM and TTS with **no third-party
   provider keys at all**. The only secrets in play are `LIVEKIT_API_KEY` and
   `LIVEKIT_API_SECRET`.

### Relation to the sovereign path

Card [[0120]] (`review/`) specs realtime voice inside a Tinfoil TEE — the
sovereign, e2ee, bring-our-own-inference path. This card is the opposite pole on
purpose: **rented, hosted, zero-integration**. Running both is how we learn what
the sovereign path actually costs us in latency and effort. Nothing here
forecloses 0120; layer 3 is one model string.

### Where the LiveKit boundary sits

The user's framing was "LiveKit for the e2e voice realtime, not the agent
itself". Concretely there are four layers, and only the top one is unavoidably
LiveKit's:

| Layer | What it is | This card |
| --- | --- | --- |
| 1. Transport | WebRTC room, mic/speaker, data channel, RPC | LiveKit Cloud SFU |
| 2. Session runtime | worker dispatch, VAD/turn detection, barge-in | `@livekit/agents`, **in our own process, in our repo** |
| 3. Models | STT / LLM / TTS | LiveKit Inference — swappable later by changing one string |
| 4. Brain | system prompt, tool schema, what tools do | **ours**, always |

Layer 4 is ours by construction: the todo tools are code we write. Layer 3 is
rented *for now* — the explicit intent recorded in discovery is "start with all
three, we can swap the LLM later".

### Decisions locked during discovery

- **State owner: the browser.** A Svelte `$state` store in `/dashboard` is the
  single source of truth. Agent tools are LiveKit **RPC calls into the browser
  participant**. A todo typed by hand and a todo spoken aloud hit the identical
  store — which is exactly what makes the loop provable rather than assertable.
  Reload loses everything; that is accepted for a spike.
- **Models: all three from LiveKit Inference** — `deepgram/flux-general` (STT),
  `google/gemma-4-31b-it` (LLM), `fishaudio/s2.1-pro` (TTS). No OpenAI /
  Deepgram / Cartesia / Fish accounts or keys: LiveKit fronts all three.
- **Not a realtime speech-to-speech model.** Verified during discovery: *every*
  S2S option (OpenAI Realtime, Gemini Live, Grok Voice, Phonic, Nova Sonic…) is a
  plugin requiring that vendor's own key, so S2S is the one choice that breaks
  "pure LiveKit". The STT→LLM→TTS pipeline is the pure-stack option.
- **Agent runtime: Node/TypeScript**, as a bun workspace, so the repo stays one
  language and one lockfile.
- **Local worker only.** `lk agent create` / Cloud deploy is carved off (see
  Out of scope).
- **Token minting: a dev-only SvelteKit `+server.ts`.** It exists under
  `vite dev` and is simply absent from the static build, so the API secret never
  enters the browser bundle. Production minting is a separate card.
- **Human testing is wanted in addition to the automated metric** — see the
  HITL script in Verification.

### Verified API facts (docs, August 2026)

Gathered during discovery so the build does not have to re-research:

- LiveKit Inference is configured with plain model strings and needs no plugins —
  or the object forms `new inference.STT({ model, language })`,
  `new inference.LLM({ model })`, `new inference.TTS({ model, voice })`. Zero data
  retention by default.
- **The three models this card uses** (user-chosen):

  | Stage | Model id |
  | --- | --- |
  | STT | `deepgram/flux-general` — conversational STT with built-in end-of-turn detection, so no separate VAD plugin is needed |
  | LLM | `google/gemma-4-31b-it` — swap target; this is the one string later replaced by our own or Tinfoil inference |
  | TTS | `fishaudio/s2.1-pro` |

  If `deepgram/flux-general` turns out not to carry turn detection in the
  installed version, fall back to `deepgram/nova-3` plus a VAD/turn-detector
  plugin rather than changing the other two.
- Other available Inference ids, for the goal-2 comparison: STT
  `assemblyai/universal-3.5-pro`, `cartesia/ink-whisper`,
  `elevenlabs/scribe-v2-realtime`; LLM `openai/gpt-5`, `google/gemini-2.0-flash`,
  `xai/grok-4.1-fast`; TTS `cartesia/sonic-3`, `elevenlabs/eleven-flash-v2-5`,
  `inworld/inworld-tts-2`, `rime/arcana`.
- Agent shape (`agent-starter-node`): `Agent.create({ instructions, llm })`
  imported from `@livekit/agents`, driven by an `AgentSession`.
- Function tools: `llm.tool({ name, description, parameters: z.object({…}),
  execute: async (args, { ctx }) => … })`, registered via `tools: [...]`. Zod
  `parameters` **must** be a `z.object`.
- RPC: `room.registerRpcMethod(name, async (data: RpcInvocationData) => string)`
  on the receiving side; `localParticipant.performRpc({ destinationIdentity,
  method, payload })` on the calling side. Payloads are **strings, ≤15 KiB**,
  method names ≤64 bytes, default timeout 10 s, errors via `RpcError`.
- Env for the worker is exactly `LIVEKIT_URL`, `LIVEKIT_API_KEY`,
  `LIVEKIT_API_SECRET`.

Two surfaces to confirm against the installed versions rather than trusting the
docs blind (they moved recently): whether RPC registration is
`room.registerRpcMethod` or `room.localParticipant.registerRpcMethod`, and the
exact text-input topic (`lk.chat`) used by step 4's headless driver.

## Goal

Talking to the dashboard changes what the dashboard shows: say "add buy milk",
and a todo appears in the list the same instant it would if you had typed it —
and this is proven by a command, not by a claim.

**Completion condition** (identical to frontmatter `goal`):

> `` `bun run check` and `bun run lint` exit 0, and `bun test` passes — including `libs/aven-voice-agent/test/loop.live.test.ts`, which connects to the real `LIVEKIT_URL`, drives one text turn ("add buy milk to my todos") through the LiveKit-Inference session and asserts a `todo.create` RPC reached the browser-side participant with a title matching /milk/i and that the client store then holds exactly one todo; and `git status --short` lists only paths named in 'Files to touch'. ``

The live test is the load-bearing part: it exercises transport → Inference STT/LLM
→ tool call → RPC → store mutation, i.e. everything except the microphone and the
speaker. Those two are covered by the human HITL script instead, because no
command can prove them.

## Approach

```
  browser (/dashboard)                    LiveKit Cloud            our worker process
  ┌──────────────────────┐                ┌───────────┐            ┌──────────────────┐
  │ todos $state  ◀──SSOT│                │           │            │ AgentSession     │
  │   ▲            ▲     │   mic audio    │           │  audio     │  stt  deepgram/… │
  │   │            └─────┼───────────────▶│    SFU    │───────────▶│  llm  google/…   │
  │   │  UI buttons      │                │           │            │  tts  fishaudio/…│
  │   │                  │◀───────────────┤           │◀───────────┤                  │
  │   │  RPC handlers    │   agent audio  │           │            │ tools:           │
  │   └──todo.create ◀───┼────────────────┼── RPC ────┼────────────┤  todo.create     │
  │      todo.list       │                │           │            │  todo.list       │
  │      todo.update     │                └───────────┘            │  todo.update     │
  │      todo.delete     │                                         │  todo.delete     │
  └──────────────────────┘                                         └──────────────────┘
```

The agent holds **no** todo state. Every tool is a thin `performRpc` to the
browser participant, and `todo.list` is how the LLM reads the list before
answering "what's on my list?". One store, two input methods.

The wire contract (method names, payload shapes, error codes) lives in a single
dependency-free module, `libs/aven-voice-agent/src/protocol.ts`, imported by both
sides so agent and browser cannot drift. It exports zod schemas which double as
the tools' `parameters`.

### Why the metric is shaped this way

`bun run check` proves it compiles; unit tests prove the reducer and the codecs;
only the live test proves the *loop closes*. Splitting them gives a free, fast
inner gate (steps 1–2 need no credentials at all) and one honest end gate.

## Steps

1. **Protocol + store, no network.** `protocol.ts` (zod schemas, method-name
   constants, encode/decode helpers) and `app/src/lib/todos/store.svelte.ts`
   (a `$state` list plus pure `create/update/remove/toggle` reducers). Unit-test
   both. *Free, deterministic, no credentials.*
2. **Connect + talk, no tools yet.** Dev-only token endpoint; `app/src/lib/voice/room.svelte.ts`
   wrapping connect/disconnect/mic; the dashboard grows a Connect control and a
   hand-editable todos UI bound to the step-1 store. The agent worker comes up with
   instructions and the Inference pipeline but **no tools** — enough to hear it
   answer. **← checkpoint: stop and look here.**
3. **Close the loop.** Register the four RPC methods on the browser room; define
   the four `llm.tool`s in the worker, each closing over `ctx.room` and the
   client identity and doing `performRpc`. Speak a todo into existence.
4. **Prove it.** `loop.live.test.ts`: join a real room with `@livekit/rtc-node`,
   register the same RPC handlers against a headless copy of the store, send one
   text turn, await the `todo.create` RPC, assert on title and store length.

Steps 1–2 are credential-free. Steps 3–4 require the `.env` values.

## Files to touch

**New workspace — the agent worker**

- `libs/aven-voice-agent/package.json` — bun workspace `@avenos/aven-voice-agent`;
  deps `@livekit/agents`, `@livekit/rtc-node`, `zod`; a `dev` script running the worker.
- `libs/aven-voice-agent/src/protocol.ts` — **the shared wire contract.** Method
  name constants, zod schemas for each tool's parameters, `Todo` type, encode/decode
  helpers. Dependency-free apart from zod so the browser can import it.
- `libs/aven-voice-agent/src/agent.ts` — `Agent.create({ instructions, … })`; voice
  instructions (plain text, short replies, never recite ids — crib the starter's
  output rules).
- `libs/aven-voice-agent/src/todo-tools.ts` — a factory taking `(room, getClientIdentity)`
  and returning the four `llm.tool`s, each `performRpc`-ing to the browser.
- `libs/aven-voice-agent/src/index.ts` — worker entry: `AgentSession` with
  `stt: "deepgram/flux-general"`, `llm: "google/gemma-4-31b-it"`,
  `tts: "fishaudio/s2.1-pro"`; resolve the client participant, attach tools, start.
- `libs/aven-voice-agent/test/protocol.test.ts` — codec round-trips, rejection of
  malformed payloads, the ≤15 KiB payload bound.
- `libs/aven-voice-agent/test/loop.live.test.ts` — the live end-to-end proof.

**App**

- `app/src/routes/api/livekit-token/+server.ts` — dev-only; `AccessToken` from
  `livekit-server-sdk`, grants `roomJoin/canPublish/canSubscribe/canPublishData`.
  Must fail loudly (500 + explanatory body) when the env vars are unset.
- `app/src/lib/todos/store.svelte.ts` — the `$state` SSOT + pure reducers.
- `app/src/lib/voice/room.svelte.ts` — connect/disconnect/mic-toggle, connection
  and agent-presence state, remote-audio attach + `startAudio()` for autoplay.
- `app/src/lib/voice/rpc.ts` — binds the four protocol methods to store reducers.
- `app/src/routes/dashboard/+page.svelte` — replaces the "coming soon" stub:
  Connect/Disconnect, mic + agent status, and the todos list with add / toggle /
  inline-edit / delete.
- `app/package.json` — add `livekit-client`, `livekit-server-sdk` (dev), and
  `@avenos/aven-voice-agent` (`workspace:*`, for `protocol.ts` only).
- `app/tests/todos.test.ts` — reducer + RPC-handler unit tests.
- `.env` — **already populated** during discovery (gitignored): `LIVEKIT_URL`,
  `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `PUBLIC_LIVEKIT_URL` all set against
  the `avenceo-s44ngbad` LiveKit Cloud project. No credential work remains.
- `.env.example` — document the four LiveKit vars for other machines.

Do **not** touch `libs/aven-city/**`, `app/src/routes/game/**`, or the selector.

## Acceptance criteria

Each is checkable from the transcript.

- [ ] Types and lint clean — proven by `bun run check` and `bun run lint` both exiting 0.
- [ ] Todo reducers behave (create/toggle/edit/delete, unknown-id is a no-op) —
      proven by `bun test app/tests/todos.test.ts` passing.
- [ ] The wire contract round-trips and rejects malformed payloads —
      proven by `bun test libs/aven-voice-agent/test/protocol.test.ts` passing.
- [ ] Agent and browser share **one** definition of the contract — proven by
      `grep -rn "todo\.create" app/src libs/aven-voice-agent/src` showing the literal
      only in `protocol.ts`.
- [ ] **The loop closes** — proven by `bun test libs/aven-voice-agent/test/loop.live.test.ts`
      passing: a text turn produces a `todo.create` RPC at the browser-side
      participant with title matching /milk/i, and the store then holds exactly 1 todo.
- [ ] No third-party model keys exist — proven by `grep -rniE "OPENAI|DEEPGRAM|CARTESIA|ELEVENLABS|ANTHROPIC" .env .env.example libs/aven-voice-agent app/src` returning no key assignments.
- [ ] The API secret never reaches the browser bundle — proven by
      `bun run --cwd app build` succeeding and
      `grep -rn "LIVEKIT_API_SECRET" app/build` returning nothing.
- [ ] Blast radius contained — proven by `git status --short` listing only paths
      above.
- [ ] **HITL:** a human joined the call, spoke, and saw todos change (script below),
      and signed off. Recorded by `/aven-review`.

## Verification

```bash
bun run check                                     # svelte-kit sync + svelte-check
bun run lint                                      # biome
bun test app/tests libs/aven-voice-agent/test     # unit + the live loop test
bun run --cwd app build && grep -rn "LIVEKIT_API_SECRET" app/build || echo "secret not bundled"
git status --short
```

The live test reads `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` from
the worktree `.env` — already populated — and costs a few cents of Inference per
run. It must **skip with a clear message**, not fail, when those are unset, so a
credential-less checkout still gets a green `bun test`.

### Human test script (HITL — the mic and speaker half)

Run the worker (`bun run --cwd libs/aven-voice-agent dev`) and the app
(`bun run dev:app`), open `/dashboard`, then:

1. Click **Connect**, allow the microphone. → agent status goes to connected and
   it greets you out loud.
2. Say *"add buy milk to my todos"*. → a todo appears in the list **while it is
   still speaking**, and it confirms.
3. Say *"what's on my list?"*. → it reads back "buy milk" (proves `todo.list`
   reads the browser's store, not the agent's memory).
4. Type a second todo by hand in the UI, then ask *"what's on my list now?"* →
   it reads back both (proves one shared store, two inputs).
5. Say *"mark buy milk as done"*, then *"delete it"*. → the row toggles, then
   disappears.
6. Interrupt it mid-sentence. → note whether it stops cleanly (barge-in quality
   is a headline input to the goal-2 verdict).

Record for the goal-2 verdict: time-to-first-word, the lag between finishing a
sentence and the UI changing, and whether interruption felt natural.

## Out of scope — follow-on cards

Filed back in `ideate/`:

- **0123** — deploy the worker to LiveKit Cloud (`lk agent create`, Dockerfile,
  `livekit.toml`). This is the other half of goal 2.
- **0124** — production token minting (Tauri `#[tauri::command]` signing in Rust)
  so voice works in the shipped app, not just `vite dev`.
- **0125** — persistence for todos; reload currently empties the list.

Also deliberately not here: telephony/SIP, multi-participant rooms, swapping
layer 3 for our own or Tinfoil inference, and any UI beyond the todo list.

## Hand-off

```
/aven-build 0122
```

…or hand the condition straight to the goal loop:

```
/goal `bun run check` and `bun run lint` exit 0, and `bun test` passes — including `libs/aven-voice-agent/test/loop.live.test.ts`, which connects to the real `LIVEKIT_URL`, drives one text turn ("add buy milk to my todos") through the LiveKit-Inference session and asserts a `todo.create` RPC reached the browser-side participant with a title matching /milk/i and that the client store then holds exactly one todo; and `git status --short` lists only paths named in 'Files to touch'.
```

## Progress log

- `2026-08-09` — Discovery: interviewed to the real goal (prove the loop **and**
  evaluate the pure-LiveKit stack), locked the six load-bearing decisions,
  verified the Inference / tools / RPC APIs against the docs, established that
  speech-to-speech breaks the pure-LiveKit constraint, seeded the worktree `.env`
  with the LiveKit block, and made the metric provable via a live headless loop
  test plus a human HITL script. Moved ideate → discover.
- `2026-08-09` — Created in ideate.
