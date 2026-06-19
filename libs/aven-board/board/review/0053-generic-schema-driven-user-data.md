---
title: Generic schema-driven user data store (JSON Schema + JSONB) + todos example
summary: Per-user data layer where users define JSON Schemas (data_schema) and store schema-validated JSONB values (data_value, FK to schema); todos wired as the first consumer card in the mainnet chat.
owner: claude
created: 2026-06-19
updated: 2026-06-19
tags: [data, mainnet, app]
goal: "Generic per-user data store: data_schema (JSONB JSON Schema defs) + data_value (JSONB, FK->schema) with all value writes Ajv-validated against the referenced schema (400 on failure); session-gated CRUD endpoints return 401 unauthenticated; a todos card below the MINDS usage card does list/add/toggle/delete via the generic layer. lib tsc + app svelte-check + biome clean; migration applied; jsonb round-trips; validation accepts valid / rejects invalid."
---

# Generic schema-driven user data store

## Context

Built on the betterauth app backend (boards 0050–0052). Users can define their own
data shapes as JSON Schemas and store values validated against them — fully generic,
open to any future schema. `todos` is the first consumer, rendered in the mainnet
(Alberobello) chat. Everything is per-user (scoped to `session.user.id`).

## What shipped (commit `873038aa`)

**Schema (Neon, JSONB; Kysely migration 0003):**
- `data_schema(id, user_id, name, json_schema jsonb, created_at, updated_at)` — unique
  `(user_id, name)` so a schema can be upserted/seeded by name.
- `data_value(id, user_id, schema_id → data_schema.id ON DELETE CASCADE, data jsonb, …)`.

**Server (`data.ts`, session-gated):**
- `POST/GET /api/data/schemas`, `POST/GET /api/data/schemas/:schemaId/values`,
  `PATCH/DELETE /api/data/values/:id` (CORS extended to PATCH/DELETE).
- Every value write is validated with **Ajv** against the referenced schema's
  `json_schema`; invalid → `400 { error:'validation', details:[…] }`.
- jsonb written via `::jsonb` cast, read back as parsed objects.

**Frontend:**
- `app/src/lib/data/client.ts` — generic `ensureSchema / listValues / createValue /
  updateValue / deleteValue`.
- `TodosCard.svelte` — seeds a `todos` schema, optimistic list/add/toggle/delete,
  shown below the MINDS usage card.

## Acceptance criteria

- [x] `data_schema` + `data_value` migrated to Neon (migration 0003 Success).
- [x] jsonb write→read round-trips as a parsed object (verified via db()).
- [x] Ajv accepts a valid todo and rejects missing/empty title + extra properties.
- [x] All `/api/data/*` endpoints return **401** unauthenticated.
- [x] Per-user isolation: user id from session; all queries filter by `user_id`; values
      reachable only via a schema the user owns.
- [x] Todos card renders below the MINDS card; CRUD goes through the generic layer.
- [x] `bun --cwd libs/betterauth run check` + app `svelte-check` + biome clean.

## Verification

```bash
bun --cwd libs/betterauth run check
(cd app && bun --bun x svelte-check --tsconfig ./tsconfig.json)
curl -s -o /dev/null -w '%{http_code}' http://localhost:8787/api/data/schemas   # 401
# live (HITL): sign in -> add/toggle/delete todos; try an invalid value -> validation error.
# Neon MCP: SELECT name FROM data_schema; SELECT count(*) FROM data_value;
```

## Out of scope (follow-on)

- A generic schema-editor UI (define arbitrary schemas in the frontend) — backend already
  supports it; only the todos consumer is wired.
- Schema versioning / migrating existing values when a schema changes.
- Querying inside JSONB (indexes / filters) beyond per-schema listing.
- Postgres RLS (deferred with the rest — see board 0052).

## Progress log

- `2026-06-19` — Built + verified the generic store (migration 0003, Ajv-validated CRUD,
  jsonb round-trip) and the todos example card. In review/ pending human sign-off.
