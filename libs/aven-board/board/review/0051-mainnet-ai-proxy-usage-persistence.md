---
title: Mainnet AI — authenticated Tinfoil proxy, streaming, usage tracking & chat persistence
summary: The Alberobello chat runs real private AI (Tinfoil) through the session-gated Hono proxy, with streaming, per-user token+cost tracking, and persisted sessions/messages + a left switcher.
owner: claude
created: 2026-06-16
updated: 2026-06-16
tags: [auth, mainnet, ai]
goal: "Signed-in users run real streaming Tinfoil inference via the auth server's session-gated proxy; per-user token usage + cost are recorded (pricing synced from Tinfoil) and shown in a card; chat sessions/messages persist in Neon and restore via a left switcher. All AI endpoints return 401 unauthenticated and only expose the caller's own data. lib tsc + svelte-check + biome clean; migrations applied. Built on board 0050."
---

# Mainnet AI — proxy, streaming, usage, persistence

## Context

Follow-on to [[0050-betterauth-mainnet-google-gate]] (Google sign-in gates the
Alberobello chat). This card records the AI feature track built directly on top of the
auth gate, on branch `claude/busy-neumann-996bf2`. All of it is **per-user isolated**:
the user id is derived from the validated Better Auth session, never from client input;
every query filters by it; no endpoint takes a `user_id` param.

## Goal

The mocked chat became a real, authenticated, private-AI chat with usage accounting and
persistence — only signed-in users can spend inference, and each sees only their own.

**Completion condition** (mirrors frontmatter `goal`):

> Signed-in users run real streaming Tinfoil inference via the auth server's
> session-gated proxy; per-user token usage + cost are recorded (pricing synced from
> Tinfoil) and shown in a card; chat sessions/messages persist in Neon and restore via a
> left switcher. All AI endpoints 401 unauthenticated and only expose the caller's own
> data. lib tsc + svelte-check + biome clean; migrations applied.

## What shipped (commits)

- `d8eb6238` — `POST /api/ai/chat`: session-gated Tinfoil proxy (key stays server-side) + SSE streaming (pipe-through).
- `4f1db64c` — per-user token usage + per-model pricing (synced from Tinfoil `/v1/models`); cost snapshotted; `GET /api/ai/usage`; "This week / Total" card.
- `0456e29b` — persisted `ai_chat_session` + `ai_message` (migration 0002); proxy records each turn (streaming via SSE tee); `GET /api/ai/sessions` + `/sessions/:id/messages`; restore-on-load.
- `dc1a2aeb` — left session switcher (browse/select conversations) + "New chat".

## Schema (Neon, public; Kysely migrations 0001 + 0002)

- `model_pricing(model PK, input/output_usd_per_mtok, request_usd, updated_at)`
- `ai_usage(id, user_id, model, prompt/completion/total_tokens, cost_usd, created_at)`
- `ai_chat_session(id, user_id, title, created_at, updated_at)`
- `ai_message(id, session_id, role, content, created_at)`

## Acceptance criteria

- [x] Streaming AI reply in the chat from the session-gated proxy — verified live in the Tauri app (user-confirmed).
- [x] `TINFOIL_API_KEY` never leaves the server (read from env in the handler only).
- [x] `model_pricing` synced from Tinfoil — Neon MCP shows rows (`gemma4-31b` 0.4/1.0, …).
- [x] Usage recorded per completion (stream + non-stream); `GET /api/ai/usage` returns `{ total, week }`.
- [x] Sessions/messages persist + restore; left switcher loads any session.
- [x] All AI endpoints return **401** unauthenticated (verified: chat, usage, sessions, messages).
- [x] Per-user isolation: user id from session, never client input; no `user_id` param anywhere.
- [x] `bun --cwd libs/betterauth run check` = 0; `bun run check` (app) = 0; touched files biome-clean; migrations applied.

## Verification

```bash
bun --cwd libs/betterauth run check     # tsc --noEmit
(cd app && bun --bun x svelte-check --tsconfig ./tsconfig.json)
curl -s -o /dev/null -w '%{http_code}' http://localhost:8787/api/ai/usage      # 401
curl -s -o /dev/null -w '%{http_code}' http://localhost:8787/api/ai/sessions   # 401
# live (HITL): sign in → send a message → streams; usage card + session switcher populate; reload restores.
# Neon MCP: SELECT count(*) FROM ai_usage; SELECT count(*) FROM ai_message;
```

## Out of scope (→ board 0052)

Roles / product tiers (Polar-driven, e.g. avenCITY) / AI credit budgets / admin "see all
users" / Postgres RLS — all deferred to [[0052-roles-tiers-admin-credits]].

## Progress log

- `2026-06-16` — Recorded the AI track (proxy → streaming → usage+pricing → persistence →
  switcher), all built + verified live + committed on `claude/busy-neumann-996bf2`. In
  review/ pending human ship sign-off alongside 0050.
