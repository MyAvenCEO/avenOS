---
title: Tinfoil cloud LLM + one generic todos CRUD tool in Talk
summary: Route Talk's agent through the Tinfoil Rust SDK (kimi-k2-6) when TINFOIL_API_KEY is set, with a real multi-round tool loop and ONE generic batch `todos` tool replacing the four single-purpose todo tools.
owner: claude
created: 2026-06-11
updated: 2026-06-11
tags: [aven-ai, talk, llm, tools]
goal: "`cargo check -p aven-ai --features tinfoil` exits 0, `cargo check` in `app/src-tauri` exits 0, `bun run check` and `bun run lint` exit 0, and every Acceptance criterion in board/discover→build/0021 is checked with evidence"
---

# Tinfoil cloud LLM + one generic todos CRUD tool in Talk

## Context

Talk (per SAFE / identity) already has an agent runtime:
`app/src/lib/identities/identity-agent.svelte.ts` streams the on-device LFM2.5
(llama.cpp via `libs/aven-ai`, Tauri command `llm_generate` in
`app/src-tauri/src/llm.rs`) and resolves **one tool call per turn** against the
registry in `app/src/lib/llm/tools.ts`. The todo tools there are four
single-purpose tools (`create_todo`, `rename_todo`, `toggle_todo`,
`delete_todo`) shaped around the 1.2B model's limits, with comma-splitting of
ids (`resolveTargets`) as a poor-man's batch. The todo list is pre-injected
into the prompt because the model cannot query.

We want the smart version: a confidential **cloud** model via the
[Tinfoil Rust SDK](https://docs.tinfoil.sh/sdk/rust-sdk) that can run a real
OpenAI-style agentic tool loop — query the todos to learn ids, then batch
create/update/delete — with **zero hardcoded regex/keyword parsing** on the
todos path. Input stays exactly what Talk already produces: the voice
transcript (Parakeet STT) or the typed text prompt.

SDK facts (verified 2026-06-11):
- Crate `tinfoil` v0.1.0 is **git-only** (not on crates.io):
  `tinfoil = { git = "https://github.com/tinfoilsh/tinfoil-rs" }`. License
  **AGPL-3.0** — flagged; acceptable for local dev slice, revisit before ship.
- `Client::new_default().await` reads `TINFOIL_API_KEY` from the env and does
  enclave attestation automatically. Wraps `async-openai` 0.37.
- Tool calling is OpenAI-style via `client.chat_relaxed()`: `tools` array
  (JSON-Schema functions), response `typed_tool_calls()` (id, function_name,
  arguments_raw), results appended as `role:"tool"` messages with
  `tool_call_id`, then re-call.
- Model: **`kimi-k2-6`** (Tinfoil's recommended agentic/tool model, 256K ctx).

Decisions confirmed by Samuel (2026-06-11):
1. **Routing**: auto — Tinfoil when `TINFOIL_API_KEY` is set, else fall back to
   the existing local llama path. No UI toggle.
2. **Tool shape**: ONE generic `todos` tool with batch operations; the four
   legacy todo tools are **removed** from the registry (both paths advertise
   the generic tool; local 1.2B degradation is accepted).
3. **Loop**: real multi-round tool loop on the Tinfoil path, capped at 5
   rounds (execute tool → append `role:"tool"` result → re-call).
4. Local dev only: env var, no AI proxy, no key storage in avenDB.

## Goal

When `TINFOIL_API_KEY` is set, a Talk prompt (voice or text) like "delete all
done todos and add 'buy milk'" is fulfilled end-to-end by pure LLM tool calls
(list → batch delete → create) against the SAFE-scoped todos table, with a
spoken-style final reply; without the key, Talk behaves exactly as today
(modulo the consolidated todos tool).

**Completion condition** (the hand-off line for `/goal` — identical to the
frontmatter `goal`):

> `cargo check -p aven-ai --features tinfoil` exits 0, `cargo check` in
> `app/src-tauri` exits 0, `bun run check` and `bun run lint` exit 0, and every
> Acceptance criterion in this card is checked with evidence.

## Approach

Keep the layering the repo already uses: **aven-ai = Tauri-free primitive,
src-tauri = thin adapter, frontend = tool executors + loop driver**. The tool
loop must be driven from TypeScript because the executors (avenDB store
mutations) live there — so the Rust surface is a stateless
"one chat completion round" call, and `identity-agent.svelte.ts` owns the
execute-and-re-call loop.

1. **`libs/aven-ai/src/tinfoil.rs`** (new, behind a new `tinfoil` cargo
   feature pulling the git crate + tokio): an async
   `chat(messages: serde_json::Value, tools: serde_json::Value, model: &str)
   -> Result<ChatTurn, String>` where `ChatTurn { content: Option<String>,
   tool_calls: Vec<ToolCallOut { id, name, arguments_json }>, assistant_raw:
   serde_json::Value }`. `assistant_raw` is the raw
   `/choices/0/message` value so the caller can re-append the assistant turn
   verbatim. Client built via `Client::new_default()` (env key), cached in a
   `OnceCell`/static so attestation runs once per app run.
2. **`app/src-tauri/src/llm.rs`** (extend): two async commands —
   `tinfoil_available() -> bool` (env var non-empty + feature compiled) and
   `tinfoil_chat(messages, tools, model?) -> ChatTurn` delegating to aven-ai.
   Register both in `lib.rs`. Enable the `tinfoil` feature on the app's
   aven-ai dependency.
3. **`app/src/lib/llm/tools.ts`** (consolidate): delete `create_todo`,
   `rename_todo`, `toggle_todo`, `delete_todo` (schemas, executors, and the
   comma-splitting `resolveTargets`). Add ONE `todos` tool:

   ```jsonc
   {
     "name": "todos",
     "description": "Query and modify the current identity's todo list. Use action 'list' first whenever you need ids of existing todos.",
     "parameters": {
       "type": "object",
       "properties": {
         "action": { "enum": ["list", "create", "update", "delete"] },
         "items": {            // ignored for "list"
           "type": "array",
           "items": { "type": "object", "properties": {
             "id":    { "type": "string"  },  // required for update/delete (exact id from list)
             "title": { "type": "string"  },  // create: required; update: optional new text
             "done":  { "type": "boolean" }   // update: optional new state
           } }
         },
         "response": { "type": "string" }    // the standard spoken reply prop
       },
       "required": ["action", "response"]
     }
   }
   ```

   The executor maps onto the existing `ToolContext` (`createTodo`,
   `resolveTodo`, `updateTodoById`, `deleteTodoById` — add a `listTodos()`
   member returning `{id,title,done}[]`). Its `ToolDispatchResult` gains a
   `toolResult?: string` field: the machine-facing content sent back as the
   `role:"tool"` message (for `list`, the JSON array of todos; for mutations,
   a JSON summary `{ok, created: n, updated: n, deleted: n, errors: []}`).
   **No regex/keyword parsing anywhere in this path** — ids and batching come
   from the model's structured arguments only. (The existing `findViewInText`
   navigation fallback is untouched and out of scope.)
4. **`app/src/lib/identities/identity-agent.svelte.ts`** (route + loop): on
   submit, if `tinfoil_available`, run the cloud loop instead of
   `streamReply`: build OpenAI messages (system prompt + the user message —
   the pre-injected todo-list context block is **omitted** on the cloud path,
   the model queries via the tool), call `tinfoil_chat`, execute each returned
   tool call via `executeToolCall`, append `assistant_raw` + `role:"tool"`
   results, re-call; **max 5 rounds**, then force a final no-tools round.
   Persist the turn as today's single `ToolCallRecord`: name = last executed
   tool (or `respond`), `response` = the model's final content (fallback: the
   tool's `response` arg), so the existing chip UI and TTS speak path work
   unchanged. No key present → existing local path, unchanged except the
   consolidated tool registry.
5. **`app/src/lib/llm/generate.ts`**: add a small typed wrapper
   `tinfoilChat(messages, tools)` + `tinfoilAvailable()` around the invokes
   (keeps identity-agent free of raw `invoke` plumbing).

Out of scope (follow-on cards): streaming the cloud reply token-by-token, AI
proxy / key management UI, persisting intermediate tool-round chips, iOS env
plumbing, prompt-injection hardening of tool results, AGPL license decision
for ship.

## Steps

1. aven-ai: add `tinfoil` feature + `src/tinfoil.rs` with `ChatTurn` and
   `chat()`; `cargo check -p aven-ai --features tinfoil` green. Checkpoint:
   show the API surface.
2. src-tauri: `tinfoil_available` + `tinfoil_chat` commands, registered;
   `cargo check` green.
3. tools.ts: consolidate to the generic `todos` tool (+ `listTodos` in
   `ToolContext`, `toolResult` in `ToolDispatchResult`); fix all references;
   `bun run check` green.
4. identity-agent: routing + capped tool loop + record persistence;
   `bun run check` + `bun run lint` green.
5. Manual smoke (review/verify): `export TINFOIL_API_KEY=…`, run the desktop
   app, in Talk say/type "add buy milk and call mom, then mark milk done,
   then delete every done todo" — observe list/create/update/delete tool
   rounds and a sane spoken reply.

## Files to touch

- `libs/aven-ai/Cargo.toml` — new `tinfoil` feature; git dep `tinfoil`, `tokio`.
- `libs/aven-ai/src/lib.rs` / `src/tinfoil.rs` — new module behind the feature.
- `app/src-tauri/Cargo.toml` — enable aven-ai `tinfoil` feature (desktop).
- `app/src-tauri/src/llm.rs` + `lib.rs` — `tinfoil_available`, `tinfoil_chat`.
- `app/src/lib/llm/tools.ts` — generic `todos` tool replaces the four legacy
  todo tools; `ToolContext.listTodos`; `ToolDispatchResult.toolResult`.
- `app/src/lib/llm/generate.ts` — `tinfoilAvailable()` / `tinfoilChat()` wrappers.
- `app/src/lib/identities/identity-agent.svelte.ts` — backend routing + 5-round
  tool loop + turn persistence.

## Acceptance criteria

Each box must be checkable from the transcript (a command + its output proves it).

- [ ] `cargo check -p aven-ai --features tinfoil` exits 0 (new module compiles;
      default feature set still builds: `cargo check -p aven-ai` exits 0).
- [ ] `cargo check` in `app/src-tauri` exits 0 with the feature enabled.
- [ ] Commands registered — proven by `grep -n "tinfoil_chat\|tinfoil_available"
      app/src-tauri/src/llm.rs app/src-tauri/src/lib.rs` showing both in the
      handler list.
- [ ] One generic tool — proven by `grep -c "create_todo\|rename_todo\|toggle_todo\|delete_todo" app/src/lib/llm/tools.ts`
      returning 0 and `grep -n "name: 'todos'" app/src/lib/llm/tools.ts` hitting.
- [ ] No regex prompt-parsing on the todos path — proven by grep: no
      `resolveTargets`/comma-split logic remains in `tools.ts` (nav fallback
      `findViewInText` may remain).
- [ ] Cloud loop capped — proven by `grep -n "MAX_TOOL_ROUNDS\|maxRounds" app/src/lib/identities/identity-agent.svelte.ts`
      showing the 5-round cap and the `tinfoil_available` routing branch.
- [ ] `bun run check` and `bun run lint` exit 0.
- [ ] No files changed outside the "Files to touch" list (plus lockfiles) —
      proven by `git status --short`.

## Verification

```bash
cargo check -p aven-ai --features tinfoil
cargo check -p aven-ai
(cd app/src-tauri && cargo check)
bun run check
bun run lint
grep -n "tinfoil_chat\|tinfoil_available" app/src-tauri/src/llm.rs app/src-tauri/src/lib.rs
grep -c "create_todo\|rename_todo\|toggle_todo\|delete_todo" app/src/lib/llm/tools.ts   # expect 0
grep -n "name: 'todos'" app/src/lib/llm/tools.ts
git status --short
# Live smoke (needs a key; manual, review-stage): export TINFOIL_API_KEY=… && bun run tauri dev
```

## Hand-off

```
/board-goal discover/0021-tinfoil-todos-crud-tool
```

…or hand the condition straight to the built-in goal loop:

```
/goal `cargo check -p aven-ai --features tinfoil` exits 0, `cargo check` in app/src-tauri exits 0, `bun run check` and `bun run lint` exit 0, and every Acceptance criterion in board card 0021 is checked with evidence
```

## Progress log

- `2026-06-11` — Discovery: interviewed Samuel (routing = auto-on-key, one
  batch `todos` tool replacing the four legacy tools, 5-round agentic loop,
  model = kimi-k2-6); verified Tinfoil SDK facts (git-only crate, AGPL-3.0,
  OpenAI-style tools via chat_relaxed); mapped the existing Talk tool layer.
  Created directly in discover/ with a measurable goal.
