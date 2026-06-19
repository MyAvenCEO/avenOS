---
title: aven-vibes — standalone vibes lib + mainnet Vibes view (data-API) + LLM CRUD tools
summary: New @avenos/aven-vibes (copied engine + todos vibe), a Chat|Vibes nav in the Alberobello app rendering the todos vibe wired to /api/data, and a Tinfoil tool loop so the chat LLM can CRUD the same data.
owner: claude
created: 2026-06-19
updated: 2026-06-19
tags: [vibes, mainnet, ai, data]
goal: "Standalone @avenos/aven-vibes (engine + todos vibe, no aven-ui/$lib coupling) tsc-clean; the mainnet app has a Chat|Vibes nav whose Vibes view renders the todos vibe via the QuickJS engine with CRUD wired to the betterauth /api/data store; the Tinfoil chat runs a server-side tool loop exposing data_crud so the LLM can list/create/update/delete the same todos (schema-validated, per-user). app svelte-check + both libs tsc + biome clean; chat/data endpoints 401 unauthenticated; gemma4-31b emits a valid data_crud call."
---

# aven-vibes: standalone vibes + mainnet data + LLM CRUD tools

## Context

Builds on the generic data store ([[0053-generic-schema-driven-user-data]]) and the
betterauth AI proxy. Goal: bring the JSON-vibe engine (from `@avenos/aven-ui`) into the
mainnet/Alberobello world, backed by the cloud `/api/data` store instead of avenDB, and
let the Tinfoil chat do CRUD on the same data via tools. Per-user throughout.

## What shipped (slices A–C)

- **A — `libs/aven-vibes` (`ceb1177d`):** standalone copy of the JSON view/style engine +
  QuickJS sandbox bridge + `AvenVibeView.svelte` + the todos vibe, decoupled from
  `aven-ui`/`$lib` (inline runtime checks + `desktopHint` prop). `bun run check` clean.
- **B — mainnet Vibes view (`ddbe3494`):** `MainnetShell` adds a top-left **Chat | Vibes**
  nav; `MainnetVibes` renders the todos vibe and wires ADD/TOGGLE/DELETE/CLEAR_DONE to the
  `/api/data` store (same `todos` schema as the chat's TodosCard — shared data).
- **C — LLM CRUD tools (`5b0c807f`):** `@avenos/aven-vibes/tools` exports the generic
  `data_crud` tool; betterauth `executeDataTool` runs schema-validated CRUD; the chat runs
  a **server-side streaming tool loop** (Tinfoil + data_crud, re-emits content SSE, executes
  tools between rounds). `schemasPromptHint` feeds the model the schema field names.

## Acceptance criteria

- [x] `@avenos/aven-vibes` is standalone (no `@avenos/aven-ui` / `$lib` imports); `bun run check` 0.
- [x] Mainnet has a Chat | Vibes nav; the Vibes view renders the todos vibe (QuickJS engine).
- [x] Vibes CRUD persists via `/api/data` (shared `todos` schema with the chat card).
- [x] Chat advertises `data_crud`; server tool loop executes it; `gemma4-31b` emits a valid call.
- [x] LLM CRUD is schema-validated + per-user (executeDataTool scopes by user, validates writes).
- [x] app svelte-check + both libs tsc + biome clean; `/api/ai/chat` + `/api/data/*` 401 unauthenticated.
- [ ] **HITL:** live in the Tauri app — Vibes todos render + CRUD by click; chat "add a todo: X"
      creates it (verify via Neon `data_value` + the Vibes view after reload).

## Verification

```bash
cd libs/aven-vibes && bun run check
cd libs/betterauth && bun run check
(cd app && bun --bun x svelte-check --tsconfig ./tsconfig.json)
curl -s -o /dev/null -w '%{http_code}' -X POST localhost:8787/api/ai/chat -d '{"messages":[],"stream":true}'  # 401
# live (HITL, Tauri): mainnet -> Vibes -> add/toggle/delete; chat -> "add a todo: buy milk".
# Neon MCP: SELECT data FROM data_value WHERE schema_id IN (SELECT id FROM data_schema WHERE name='todos');
```

## Known gaps / follow-on

- After the **LLM** changes todos via chat, the Vibes view / TodosCard don't auto-refresh
  (no cross-component signal yet) — reload shows the change. A shared data store/event would fix it.
- Vibes render only in the Tauri webview (QuickJS plugin is native) — web preview shows the hint.
- The copied `logic.js` keeps aven-ui's biome `useTemplate` warnings (faithful copy).
- A generic schema-editor UI (define arbitrary vibes/schemas) is still future.

## Progress log

- `2026-06-19` — Built A (standalone lib), B (mainnet Vibes view + nav + /api/data CRUD),
  C (LLM data_crud tool loop). All committed; deterministic checks green; live round-trip HITL.
