---
title: Clean e2e realtime reactivity for the mainnet frontend (TanStack Query + SSE)
summary: Replace manual fetch/refresh of betterauth REST data with @tanstack/svelte-query, and push instant per-user change events over a fetch-based SSE stream that invalidates queries — so todos/schemas/usage/billing update live with no manual refresh.
owner: claude
created: 2026-06-20
updated: 2026-06-20
tags: [frontend, reactivity, betterauth]
goal: "All app reads of the betterauth REST API (/api/data/*, /api/ai/usage, /api/billing/state) go through @tanstack/svelte-query, and a session-gated fetch-based SSE stream (GET /api/events) pushes per-user change events that invalidate the matching query keys — with NO manual reload calls left in components. Proven by: `bun run --cwd libs/betterauth check` exit 0; `cd app && bun --bun x svelte-check --tsconfig ./tsconfig.json` → 0 errors; biome clean on changed files; `curl -sS -o /dev/null -w '%{http_code}' http://localhost:8787/api/events` → 401; `grep -rnE 'refreshUsage|loadBilling' app/src/lib/shell` → no matches; and a betterauth test `events_publish_on_mutation` exits 0. Out of scope (must stay unchanged): aven-db / FrontierDag (testnet) reactivity."
---

# Clean e2e realtime reactivity for the mainnet frontend (TanStack Query + SSE)

## Context

On **mainnet / alberobello**, the app's data (vibe todos, schema-driven values,
AI usage/credits, billing/subscription state) is **server state** held in the
betterauth Hono/Neon server and read over REST: `app/src/lib/data/client.ts`
(`listValues`/`createValue`/…), `app/src/lib/data/usage-store.ts` (`refreshUsage`),
and `app/src/lib/billing/checkout.ts` (`fetchBillingState`). Every read is an
**imperative fetch** with **no cache, no auto-invalidation, and no realtime push**.
Components reload by hand — `refreshUsage()`, `loadBilling()`, ad-hoc `listValues()`
in a `$effect`, a manual reload after each mutation. Result: data that changed
elsewhere (another device, the AI chat tool-loop writing `/api/data`, the Polar
webhook updating `tier`) **does not appear until the user manually refreshes**. Bad
UX, and the manual-refresh plumbing is scattered and error-prone.

This is **server-state ergonomics + realtime push** — squarely the job of a
query-cache library plus a push transport. The decision (confirmed in discovery):
**`@tanstack/svelte-query`** for the cache/invalidation layer, and a **fetch-based
SSE** stream for instant server→client invalidation. The client keeps WRITING over
REST; SSE only carries "your data changed" signals.

NOT in scope: the **testnet / abagana** path, whose data comes from local **aven-db
/ FrontierDag** sync and is already reactive. This card touches only the betterauth
REST/mainnet data path. Related: [[0053]] (generic /api/data store), [[0054]]
(todos vibe + AI tool-loop), [[0052]] (billing).

## Goal

Mainnet REST data updates **live, e2e, with zero manual refresh**: any change —
local mutation, another device, the AI tool-loop, the billing webhook — is reflected
in every open client within ~1s, because the server pushes a per-user invalidation
event and TanStack Query refetches.

**Completion condition** (identical to frontmatter `goal:`):

> All app reads of the betterauth REST API (`/api/data/*`, `/api/ai/usage`,
> `/api/billing/state`) go through `@tanstack/svelte-query`, and a session-gated
> fetch-based SSE stream (`GET /api/events`) pushes per-user change events that
> invalidate the matching query keys — with NO manual reload calls left in
> components. Proven by: `bun run --cwd libs/betterauth check` exit 0;
> `cd app && bun --bun x svelte-check --tsconfig ./tsconfig.json` → 0 errors; biome
> clean on changed files; `curl -sS -o /dev/null -w '%{http_code}'
> http://localhost:8787/api/events` → 401; `grep -rnE 'refreshUsage|loadBilling'
> app/src/lib/shell` → no matches; and a betterauth test `events_publish_on_mutation`
> exits 0. Out of scope (unchanged): aven-db / FrontierDag (testnet) reactivity.

## Approach

**Cache layer — `@tanstack/svelte-query`.** Mount a `QueryClient` +
`QueryClientProvider` at the app root. Every REST **read** becomes a `createQuery`
with a stable key (`['data', schemaId]`, `['usage']`, `['billing','state']`); every
**write** a `createMutation` that calls `queryClient.invalidateQueries({ queryKey })`
on success. This alone removes the manual reload-after-my-own-action code.

**Push transport — fetch-based SSE (bearer).** `EventSource` can't send the
`Authorization` header (WKWebView drops the cross-site cookie), so reuse the
**fetch-based SSE pattern already proven in `MainnetChat.streamTinfoil`**: a single
`GET /api/events` opened with `fetch` + a `ReadableStream` reader and the bearer
token, auto-reconnecting. The server streams small JSON events
(`{ entity: 'todos' | 'usage' | 'billing' | … }`); the client maps each to
`queryClient.invalidateQueries`. Fits the Hono server, the bearer-auth model, and
the CSP `connect-src` (localhost:* / api.next.aven.ceo already allowed).

**Change detection — in-process per-user pub/sub.** The betterauth server is a
single fly machine, so an in-process `EventEmitter` keyed by `userId` is enough
(no Redis / PG LISTEN-NOTIFY). Every server-side mutation `publish(userId, {entity})`:
`data.ts` (value/schema CRUD), `billing.ts` (cancel/switch/uncancel + the Polar
**webhook** → so tier/credits stream in), and `ai.ts` (the data tool-loop write →
so a vibe the AI edits appears live). The SSE handler subscribes the connected
user and forwards their events.

**Trade-offs / out of scope:** single-instance pub/sub only (note multi-instance as
a follow-on if betterauth ever scales out); no optimistic updates / offline cache
polish in this slice (TanStack defaults are fine); FrontierDag path untouched.

## Steps

1. **Foundation** — add `@tanstack/svelte-query`; `app/src/lib/query/client.ts`
   (QueryClient) + `<QueryClientProvider>` in `app/src/routes/+layout.svelte`.
   *Verify:* svelte-check 0; app boots.
2. **SSE server** — `libs/betterauth/src/events.ts`: in-process pub/sub
   (`publish(userId, ev)`, `subscribe(userId) → AsyncIterable`) + a session-gated
   `GET /api/events` Hono handler (fetch-SSE, keep-alives). Route + CORS in
   `server.ts`. *Verify:* `/api/events` → 401 unauth; lib tsc.
3. **SSE client** — `app/src/lib/query/events.ts`: fetch-based reader (bearer +
   reconnect) mapping `{entity}` → `invalidateQueries`; subscribe once at the app
   root after sign-in. *Verify:* svelte-check.
4. **Publish on mutation** — call `publish()` from `data.ts`, `billing.ts` (incl.
   the webhook), `ai.ts` (tool-loop). *Verify:* lib tsc + test
   `events_publish_on_mutation`.
5. **Migrate reads → queries** — `/api/data` (TodosVibe, MainnetSchemas,
   MainnetDb), `/api/ai/usage` (replace `usage-store`/`refreshUsage`; MainnetShell
   reads the query), `/api/billing/state` (replace `loadBilling`; PricingPanel
   cancel/switch/uncancel/invoice become mutations invalidating it). *Verify:*
   svelte-check 0.
6. **Cleanup + gates** — delete dead manual-refresh code; run all gates; grep for
   leftover reload calls. **Checkpoint: stop and verify live behavior (HITL).**

## Files to touch

- `app/package.json` — add `@tanstack/svelte-query`.
- `app/src/lib/query/{client.ts,events.ts,keys.ts}` — new query client, SSE consumer, key registry.
- `app/src/routes/+layout.svelte` — QueryClientProvider + start SSE subscription.
- `app/src/lib/shell/TodosVibe.svelte`, `MainnetSchemas.svelte`, `MainnetDb.svelte` — reads/writes via query/mutation.
- `app/src/lib/data/usage-store.ts` → replaced by a usage query; `app/src/lib/shell/MainnetShell.svelte` consumes it.
- `app/src/lib/shell/PricingPanel.svelte`, `app/src/lib/billing/checkout.ts` — billing state as a query; actions as mutations.
- `libs/betterauth/src/events.ts` (new), `server.ts` (route+cors), `data.ts`, `billing.ts`, `ai.ts` — `publish()` calls.
- `libs/betterauth/<test>` — `events_publish_on_mutation`.

## Acceptance criteria

- [x] `@tanstack/svelte-query` installed + QueryClientProvider at root — `grep -q svelte-query app/package.json` and app `svelte-check` 0.
- [x] `GET /api/events` exists + session-gated — `curl … /api/events` → `401 {"error":"unauthorized"}` (verified on a fresh instance; the live :8787 was a stale pre-edit boot).
- [x] In-process pub/sub publishes on every betterauth mutation — test `events_publish_on_mutation` exits 0 (1 pass).
- [x] All `/api/data*`, `/api/ai/usage`, `/api/billing/state` reads go through `createQuery`; writes through `createMutation` that invalidate keys — `svelte-check` 0.
- [x] No manual reload calls left in components — `grep -rnE 'refreshUsage|loadBilling' app/src/lib/shell` → empty.
- [x] Gates green — `bun run --cwd libs/betterauth check` 0; app `svelte-check` 0; biome clean.
- [ ] **(HITL)** Live behavior — a data change on client A appears on client B within ~1s with no manual refresh; verified via [[verify]] by a human. **Requires restarting the dev app** (the running :8787 predates the `/api/events` route).

## Verification

```bash
bun run --cwd libs/betterauth check                       # server tsc (events + pub/sub)
cd app && bun --bun x svelte-check --tsconfig ./tsconfig.json   # 0 errors
bunx biome check libs/betterauth/src app/src                # clean
curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:8787/api/events   # → 401
grep -rnE 'refreshUsage|loadBilling' app/src/lib/shell || echo 'no manual reloads ✓'
bun test --cwd libs/betterauth                              # incl. events_publish_on_mutation
```

## Hand-off

```
/aven-build 0055
```

…or hand the condition straight to the goal loop:

```
/goal <paste the Completion condition above>
```

## Progress log

Newest entry first.

- `2026-06-20` — Build: implemented end-to-end. **Server:** new
  `libs/betterauth/src/events.ts` — in-process per-user pub/sub (`publish`/`subscribe`,
  no auth import so it stays unit-testable) + session-gated fetch-SSE `GET /api/events`
  (lazy `auth` import, 25s keep-alive, ReadableStream cleanup); wired route + CORS in
  `server.ts`; `publish()` on every mutation in `data.ts` (value/schema CRUD + the AI
  tool-loop), `ai.ts` (`usage` after each completion, stream + non-stream), `billing.ts`
  (cancel/switch/uncancel/sync + all 3 webhook cases — `billing`). Loop-safe: read paths
  (`billingState`) never publish. **Client:** `app/src/lib/query/{client,events,usage}.ts`
  — QueryClient + `qk` keys, fetch-based SSE consumer mapping `{entity}`→`invalidateQueries`
  (billing also invalidates usage, since tier→credits), usage queryFn. `QueryClientProvider`
  + `startRealtime()` mounted in `+layout.svelte`. **Migrated all reads→`createQuery` /
  writes→`createMutation`:** MainnetShell (usage), PricingPanel (billing state + cancel/
  resume/switch mutations; tier now from live billing state; badge centered), TodosVibe +
  MainnetSchemas + MainnetDb (data). Deleted `usage-store.ts`; removed every `refreshUsage`
  (MainnetChat ×3, MainnetShell) and `loadBilling`. Added `events.test.ts`
  (`events_publish_on_mutation`, excluded test glob from lib tsc). **Gates green:** betterauth
  tsc 0; app svelte-check 0 errors; biome clean (16 files); `/api/events`→401; shell grep
  empty; test 1 pass. Remaining: HITL live 2-client check (needs a dev-app restart to load
  the new route + client). Moved discover → build → review.
- `2026-06-20` — Discovery: interviewed → real goal = **instant e2e streaming
  reactivity for all mainnet REST data, no manual refresh**. Confirmed the data is
  server state (REST), distinct from the already-reactive FrontierDag testnet path.
  Decisions: **@tanstack/svelte-query** (cache/invalidation) + **fetch-based SSE,
  bearer** (`GET /api/events`) + **in-process per-user pub/sub**; scope = all REST
  data in one card; transport = SSE (not WS/polling). Made the goal measurable
  (compile gates + 401 SSE probe + grep-no-reloads + publish-on-mutation test +
  HITL live check). Moved ideate → discover.
