---
title: Actor code in the sandbox — one behavior model (QuickJS/WASM), vibes reference actors
summary: Server actor behavior becomes sandboxed QuickJS code-as-data with capability injection; vibe_logic retires — a vibe is view+style plus 1+ attached actors; chat and UI drive the SAME actor rows (DRY SSOT)
owner: Claude Code (build agent)
created: 2026-07-03
updated: 2026-07-03
tags: [actors, sandbox, config-as-data, security]
goal: "`bun test libs/betterauth/tests/actor-sandbox.test.ts` exits 0 — proving: (1) SANDBOX — a QuickJS-in-WASM server runtime executes actor `code` rows with ONLY injected capabilities: a code row calling a non-granted capability, fetch, filesystem, or import THROWS (fail-closed), and a runaway loop is killed by fuel/timeout; (2) SSOT — the todos vertical's read/create/edit/delete behavior is served from actor.code rows (the TS todos engine paths retired), and the SAME actor row handles both senders: a chat-path call and a vibe-event-path call produce identical writes (parity asserted against the pre-port fixtures); (3) VIBE=VIEW+STYLE+ACTORS — vibe_logic is retired by migration: the todos vibe's interactivity resolves through its attached actors (event→actor map), with its zero-cap presenter actor executing in the client sandbox path; AND `bunx tsc` (betterauth + skills) exits 0, `cd app && bunx svelte-check` exits 0, and all existing betterauth suites stay green."
---

# Actor code in the sandbox — one behavior model (QuickJS/WASM), vibes reference actors

## Context

Follow-on to [[0110]] (which lands skills/actors as config-as-data with behavior bound by
`engine` name, and ships the actor table schema-ready: nullable `code` + `caps` columns).

Today there are TWO behavior models: vibe logic = QuickJS code-as-data in `vibe_logic`
(client sandbox, zero ambient authority) vs server actor behavior = TS engines with full
DB/network access, bound by name. Decision (Samuel, 2026-07-03): unify them — **actor code
also runs in a QuickJS sandbox**, so behavior-as-data is safe on the server too, and the
"vibe function" concept dissolves into the one actor taxonomy:

- **ONE behavior model**: an actor's `code` is a QuickJS module `handle(msg, caps, ctx)`,
  executed in **QuickJS compiled to WASM** (`quickjs-emscripten` or equivalent) with ONLY the
  capabilities named in its `caps` column injected by the host (e.g. `ops:todos.*`,
  `llm:glm`, `hitl`). No fetch, no fs, no import, fuel/timeout limits — fail-closed.
- **Location transparency by caps**: zero-cap actors (pure presentation/state shaping — the
  old vibe logic) run in the CLIENT sandbox; cap-bearing actors run in the SERVER sandbox.
  Same row format, placement derived, UI stays instant for local events.
- **A vibe = view + style + attached actors**: `vibe_logic` retires. The vibe carries an
  event→actor map (`ADD_ITEM → todos.create`, …) + a `source` actor (read) + a zero-cap
  presenter actor. Interactivity IS message-passing to actors.
- **DRY SSOT**: the chat LLM path and the vibe UI path currently duplicate behavior
  (data_crud tool vs handleEvent/host mutation). After this card both are senders posting to
  the SAME actor row's mailbox.

Scope guard: HITL confirmation, capability implementations (`ops`, `llm`), and the sandbox
runtime itself remain host code — the sandbox can *request* them, never bypass them. Port the
**todos vertical only** in this card (read/create/edit/delete + presenter); the ontology/
website actors keep `engine` binding and port as follow-ons once the pattern is proven.

## Goal

One behavior model: actor code as sandboxed data. The todos vertical runs from `actor.code`
rows driven identically by chat and UI; vibes are view+style+actors; `vibe_logic` is gone.

**Completion condition** (identical to frontmatter `goal`):

> `bun test libs/betterauth/tests/actor-sandbox.test.ts` exits 0 — proving (1) the WASM/QuickJS runtime executes actor code with only injected caps (forbidden cap/fetch/fs/import throws; fuel/timeout kills runaways), (2) the todos vertical is served from actor.code rows with chat-path/UI-path parity against pre-port fixtures, (3) vibe_logic is retired and the todos vibe's interactivity resolves via its attached actors (zero-cap presenter in the client path); plus tsc + svelte-check green and existing suites green.

## Approach

1. **Sandbox runtime** (`libs/betterauth/src/actor-sandbox.ts`): quickjs-emscripten VM per
   invocation; inject a `caps` object built ONLY from the row's `caps` list (each cap = a
   host function, e.g. `ops(name, params)` → `runOperation`); fuel + wall-clock limits;
   result = `{ data?, vibe?, hitl? }` — the same ToolResult shape engines return today, so
   the chat loop is untouched.
2. **Dispatch by binding**: the actor runner checks the row — `code` present → sandbox;
   else `engine` → `TOOL_ACTORS[engine].handle` (0110 path). Both paths return ToolResult.
3. **Port todos**: write the 4 todos actors' behavior as QuickJS modules (id-resolution,
   before-diffs, HITL request for delete — the pure parts; all writes via `caps.ops`), seed
   into `actor.code` by migration; delete the TS-side todos special-casing that duplicates it.
4. **Vibe = view+style+actors**: migration adds the event→actor map + source/presenter refs
   to the vibe registry, converts the todos `vibe_logic` row into a zero-cap presenter actor,
   drops `vibe_logic`; `AvenVibeView`/host wiring resolves events through the map (client
   sandbox for zero-cap, server call for cap-bearing).
5. **Parity + security tests** (`actor-sandbox.test.ts`) as the goal describes.

## Files to touch

- `libs/betterauth/src/actor-sandbox.ts` (new) — the WASM/QuickJS runner + cap injection.
- `libs/betterauth/migrations/00NN_actor_code_todos.ts` (new) — seed todos actor code; vibe
  event→actor map; convert todos vibe_logic → presenter actor; drop vibe_logic.
- `libs/betterauth/src/ai.ts` — actor runner dispatches code-vs-engine (ToolResult unchanged).
- `skills/tools/data-crud.ts` — retire the todos-specific behavior that moves into code rows.
- `app/src/lib/shell/TodosVibe.svelte` / vibe host + `aven-vibes` — events resolve via the
  vibe's actor map; presenter runs client-side.
- `libs/betterauth/tests/actor-sandbox.test.ts` (new) — the proof.

## Acceptance criteria

- [ ] Sandbox fail-closed: non-granted cap / fetch / fs / import throws; fuel/timeout kills a `while(true)` row. Proven by `actor-sandbox.test.ts`.
- [ ] Todos vertical from code rows: create/edit/delete/read behavior executes from `actor.code`; the old TS path for todos is gone (grep). Parity with pre-port fixtures asserted.
- [ ] SSOT: one actor row serves both senders — chat-path call and vibe-event-path call produce identical writes. Proven by the test.
- [ ] `vibe_logic` dropped by migration; todos vibe interactive via its attached actors; presenter = zero-cap actor.
- [ ] tsc (betterauth+skills) + svelte-check exit 0; existing suites green.
- [ ] **(HITL / review)** Live: todos card fully interactive (add/toggle/delete incl. HITL confirm) and chat todos ops still work — both visibly hitting the same actors in Runs.

## Verification

```bash
bunx tsc --noEmit -p libs/betterauth/tsconfig.json && bunx tsc --noEmit -p skills/tsconfig.json
bun test libs/betterauth/tests/actor-sandbox.test.ts
bun test libs/betterauth
cd app && bunx svelte-check --tsconfig ./tsconfig.json
```

## Hand-off

Build [[0110]] first (it ships the schema + config plumbing this card fills), then:

```
/aven-build 0111
```

## Progress log

Newest entry first.

- `2026-07-03` — **Build slice 1 (sandbox security core) done + green**: `quickjs-emscripten` added; `actor-sandbox.ts` runs actor `code` (`handle(msg, caps, ctx)`) in a QuickJS-in-WASM VM with ONLY JSON-marshalled injected caps, an interrupt deadline (fuel), and a memory cap. `actor-sandbox.test.ts` (**7 pass**) proves fail-closed: ungranted cap throws · no fetch/require/process/dynamic-import · the `Function` constructor can't reach host globals · runaway loop killed · granted caps marshal · errors surface. tsc + full betterauth suite green (42/0). **Remaining (slice 2):** async caps (real DB `ops` suspends the VM → asyncify variant, which deadlocked on first attempt — to solve), code-vs-engine runner dispatch, todos-vertical port to `actor.code`, `vibe_logic` retirement, chat/UI parity test. Card stays in `build/`.
- `2026-07-03` — Discovery: decided with Samuel — actor code joins the QuickJS sandbox (WASM via quickjs-emscripten), ONE behavior model DRYing vibe functions + actor code into actor rows; vibe = view+style+attached actors (event→actor map, zero-cap presenter client-side); vibe_logic retires; todos vertical is the proving slice (ontology/website port as follow-ons). Measurable via actor-sandbox.test.ts: fail-closed caps, chat/UI parity on the same actor row, vibe_logic retirement. Written into `discover/`.
