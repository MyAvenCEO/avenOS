---
title: Universal predication CRUD/query engine (declarative types over x1–x5)
summary: Generalize the hand-coded todos vertical into a generic engine — an admin-owned type registry (bundle specs), a generic mutator, a Datalog-style x1–x5 query/projection matcher, and ONE universal data_crud entry. Register a type → CRUD + projection for free, no bespoke code per domain. Todos becomes a registered type; its hand-code (executeTodos/setDue/setPriority/v_task) is deleted. mainnet Postgres only; aven-db CRDT untouched.
owner: claude
created: 2026-06-29
updated: 2026-06-29
tags: [postgres, predication, engine, admin]
goal: A registered `todo` type drives CRUD + projection through the generic engine with ZERO todos-specific code — proven by a parity test (exit 0) where generic create/update/delete writes the same predication rows and the Datalog matcher projects the same {what,open,due,priority} as board 0087's hand-coded path; the admin-owned `predicate_type` table is seeded with the `todo` spec (SQL shows the row) and its CRUD returns 403 non-admin / 200 admin; the universal `data_crud(type,action,…)` routes any registered type; the hand-coded executeTodos/setDue/setPriority + the `v_task` migration are removed (grep empty); and `bun run check` + the new tests exit 0.
---

# Universal predication CRUD/query engine

## Context

Board 0087 built the todos vertical by HAND: `executeTodos` writes the task/valid/due/prioritized
predications at fixed gismu positions, `setDue`/`setPriority` know each structure, and a per-type
Kysely migration (`v_task`) projects them back. Every new domain (booking, invoice, contact) would
need the same bespoke code. The x1–x5 predication store + the [[ontology-gismu-skill]] gismu
provenance make a **generic, declarative** engine possible — this card builds it and proves it by
re-implementing todos with zero todos-specific code.

**Strictly mainnet Postgres** (`data_schema`/`data_value` for predications + an admin `predicate_type`
table for the registry) — **aven-db (Rust CRDT) untouched**. See [[two-layer-schema-split]] and
[[avendb-crdt-vs-mainnet-postgres]]. Builds on [[universal-predication-schema-0084]] (0085 compiler)
and board 0087 (the prototype to generalize).

**The four parts (the user chose the full engine):**

1. **Type registry** — an admin-owned `predicate_type` PG table (Layer A, like the `flow` table),
   each row a **bundle spec**: a primary predicate + linked predications addressed by gismu position.
   ```jsonc
   // todo
   { "type": "todo", "primary": "task",
     "fields": {                                  // projection: field ← predication position
       "what":     { "pred": "task",        "pos": "x2" },
       "open":     { "pred": "valid", "link": "x1=primary", "expr": "x3 IS NULL" },
       "due":      { "pred": "due",   "link": "x2=primary", "pos": "x1" },   // detri: task in x2
       "priority": { "pred": "prioritized", "link": "x1=primary", "pos": "x3" }
     },
     "mutations": {                                // input field → predication write
       "title":    { "pred": "task",        "write": { "x1": "$user", "x2": "$value" } },
       "done":     { "pred": "valid", "link": "x1=primary", "set": { "x3": "$value?now:null" } },
       "due":      { "pred": "due",          "link": "x2=primary", "write": { "x1": "$value", "x2": "$primary" } },
       "priority": { "pred": "prioritized",  "link": "x1=primary", "write": { "x1": "$primary", "x2": "$user", "x3": "$value" } }
     } }
   ```
2. **Generic mutator** — `mutate(type, action, items)` reads the spec and create/update/deletes the
   predications at the right positions (replacing `setDue`/`setPriority`); a create is a **mutation
   group** applied atomically.
3. **Datalog-style x1–x5 matcher** — `query(type, where?)` projects a type by pattern-matching
   predications (e.g. `task(id=?t, x1=?u)`, `due(x2=?t, x1=?date)`, …) and assembling the fields —
   NO per-type SQL view. This replaces `v_task`.
4. **Universal `data_crud`** — `data_crud(type, action, items|query)` is the ONE entry for any
   registered type (todos route through it).

## Goal

Register a type → full CRUD + projection, no bespoke code. Todos runs entirely through the engine.

**Completion condition** (identical to frontmatter `goal`):

> A registered `todo` type drives CRUD + projection through the generic engine with ZERO
> todos-specific code — proven by a parity test (exit 0) where generic create/update/delete writes
> the same predication rows and the Datalog matcher projects the same {what,open,due,priority} as
> 0087's hand-coded path; the admin-owned `predicate_type` table is seeded with the `todo` spec (SQL
> shows the row) and its CRUD returns 403 non-admin / 200 admin; the universal `data_crud(type,…)`
> routes any registered type; the hand-coded executeTodos/setDue/setPriority + the `v_task` migration
> are removed (grep empty); and `bun run check` + the new tests exit 0.

## Approach

A new `libs/aven-predicate` (or `libs/aven-vibes/src/engine-predication`) holds the **pure** engine:
the spec type, `mutate()`, `query()` (Datalog matcher), and `$user/$value/$primary/$now` binding
resolution — unit-tested without a DB by injecting a row store. The betterauth layer wires it to
`data_value` + the `predicate_type` registry table (admin CRUD), and `data_crud` dispatches
`{type}` through it. Todos becomes the seed type spec; its bespoke code is deleted.

The matcher is the de-risking core: prove it reproduces v_task's {what,open,due,priority} from the
spec before deleting v_task. Keep gismu provenance (x-gismu) on the seeded pred schemas.

**Out of scope (follow-on):** migrating booking/invoice/contact onto the engine (this card proves
it on todos + the engine being type-agnostic); a visual type-spec editor; cross-type joins/queries
beyond a single type's bundle.

## Steps (small, checkpointed)

1. **Spec type + pure engine skeleton** — define the bundle-spec TS type; `mutate()`/`query()`
   against an injectable in-memory predication store; unit tests for binding resolution. **Checkpoint.**
2. **Datalog matcher = v_task parity** — `query('todo')` over real predications returns the SAME
   {what,open,due,priority} as `v_task`; parity test. **Checkpoint.**
3. **Generic mutator parity** — `mutate('todo', create|update|delete, …)` writes the SAME predication
   rows as `executeTodos`/`setDue`/`setPriority`; parity test. **Checkpoint.**
4. **Registry table + admin CRUD** — Kysely migration `predicate_type` (admin-owned), seed the `todo`
   spec; admin-only routes (adminGate); 403/200 test. **Checkpoint.**
5. **Universal `data_crud` + delete hand-code** — `data_crud(type,…)` routes through the engine;
   remove `executeTodos`/`setDue`/`setPriority` + the `v_task` migration; todos UI unchanged
   (still `/api/data/todos`, now engine-backed). grep proves the hand-code is gone. **Checkpoint.**
6. **Verify** — parity + admin-gate + round-trip + repo gates.

## Files to touch

- `libs/aven-predicate/*` (new) — pure engine: spec type, `mutate`, `query` (Datalog matcher), tests.
- `libs/betterauth/migrations/NNNN_predicate_type.ts` (new) — `predicate_type` admin table + seed `todo`.
- `libs/betterauth/src/predicate-types.ts` (new) — admin CRUD for the registry; `server.ts` wiring.
- `libs/betterauth/src/data.ts` — `data_crud(type,…)` dispatches to the engine; **delete** executeTodos/setDue/setPriority; `/api/data/todos` delegates.
- `libs/betterauth/migrations/` — drop/replace the `v_task` migration (matcher supersedes it).
- `libs/aven-board/board/discover/0088-universal-predication-engine.md` — this card.

## Acceptance criteria

Each provable from the transcript.

- [ ] Pure-engine unit tests (binding resolution, mutate, query) — `bun test` exit 0.
- [ ] **Matcher parity:** `query('todo')` == old `v_task` output for the same data — parity test exit 0.
- [ ] **Mutator parity:** `mutate('todo', …)` writes the same predication rows as the 0087 hand-code — parity test exit 0.
- [ ] `predicate_type` table seeded with the `todo` spec — `SELECT type FROM predicate_type` returns it.
- [ ] Registry CRUD: non-admin → 403, admin → 200 — server test.
- [ ] `data_crud(type='todo', …)` round-trips through the engine; the hand-coded `executeTodos`/`setDue`/`setPriority` are gone — `rg` empty.
- [ ] Todos UI still works (create/list/done/due/priority) via the engine — round-trip test.
- [ ] `bun run check` + the new tests exit 0.

## Verification

```bash
bun run check
bun test libs/aven-predicate        # pure engine + parity (matcher & mutator)
bun test libs/betterauth            # registry admin gate + data_crud round-trip
rg -n "function executeTodos|setDue|setPriority|v_task" libs/betterauth   # expect: empty
# Local DB (via the running auth server, output in transcript):
#   SELECT type FROM predicate_type;
#   data_crud(type='todo', action='list') == the prior todos list
```

## Hand-off

```
/aven-build 0088
```

## Progress log

Newest entry first.

- `2026-06-29` — Discovery: chose the full engine in one card (generic mutator + Datalog x1–x5
  matcher + admin-owned registry table + universal data_crud), projection via a Datalog matcher
  (replaces per-type v_task), registry in an admin PG table. Carved into 6 checkpointed steps with
  matcher/mutator PARITY against the 0087 hand-code as the core measurable. Out-of-scope: migrating
  other doctypes, a spec editor, cross-type queries. Created in discover/.
