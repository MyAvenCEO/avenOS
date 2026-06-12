---
title: Agentic memory tools — give the LLM an explicit brain tool surface (mnemosyne mechanics)
summary: Today memory is fully implicit (auto-store every message, auto-recall via assemble_context); the LLM has zero memory tools. Borrow mnemosyne's paradigm — expose a small, deliberate memory tool surface (remember w/ importance · recall · link · attest/validate · forget) mapped onto our existing Brain API, add the one missing primitive (importance/salience), and add a graph+fact recall voice. Proven by a deterministic brain test (importance ranks, forget removes, attest strengthens, link traverses) + the tools wired into CLOUD_TOOLS.
owner: claude
created: 2026-06-12
updated: 2026-06-12
tags: [aven-brain, tools, recall, mnemosyne, agentic-memory]
goal: "`cargo test -p aven-brain memory_tools -- --nocapture` exits 0 — a deterministic test proves the four tool-backing primitives: (a) higher `importance` ranks a memory above a lower one for the same query, (b) `forget` removes a memory from recall, (c) `attest` raises a memory's veracity weight, (d) an explicit `link` is traversable; AND the JS memory tools are wired into `CLOUD_TOOLS` (grep hits); `cargo test -p aven-brain` (28+) and `cargo check` / (`cd app && bun run check`) / `bun run lint` all green"
---

# Agentic memory tools — give the LLM an explicit brain tool surface (mnemosyne mechanics)

## Context

Samuel asked: deep-research [AxDSan/mnemosyne](https://github.com/AxDSan/mnemosyne)
and write a card to apply further mechanics from it, **especially its brain/memory
tool definitions**. I read mnemosyne's architecture (BEAM 3-tier SQLite store,
`tools.py` `ALL_TOOL_SCHEMAS`, polyphonic recall, veracity consolidation) and
diffed it against `libs/aven-brain`.

### How close are we? (architecture diff)

We are **architecturally close, and richer in places** — the gaps are specific.

| Mechanic | mnemosyne | aven-brain today | Gap? |
|---|---|---|---|
| Hybrid recall | vector + FTS5, weighted | vector + BM25, **RRF k=60** | parity |
| Abstention ("never hallucinate unknowns") | 100% abstention | **abstention floor** | parity |
| Veracity tiers | STATED>DERIVED… compounding | `stated/inferred/imported/tool/unknown` (identical!) weight | **near-parity** (no *compounding/attest*) |
| Graph | flat weighted edges + triples | `links` w/ **note/claim/bond** classes, Hebbian growth / Ebbinghaus decay | **we're richer** |
| Consolidation / "dreaming" | additive sleep, summary_of | `dream`/`dream_step` decay·merge·dedup (+extractor seam, card 0024) | parity-ish |
| Embeddings | 48-byte MIB binary (speed) | 768-dim Gemma fp32 (quality) | different goals — skip MIB |
| **Memory tools for the LLM** | **~23 explicit tools** (remember/recall/forget/validate/graph_link/triple_add/…) | **ZERO** — memory is fully implicit | **THE gap** |
| Importance / salience (0–1) | set at write, 20% of rank | none (`RememberOptions` has veracity, **no importance**) | **gap** |
| Polyphonic recall | 4 voices (vector·graph·fact·temporal) → RRF → MMR | 2 voices (vector·bm25) → RRF; (MMR proposed in 0023) | **gap — unused graph/fact voices** |
| Canonical identity slots | `(category,name)`→1 value+history | `set_self` (L0 only) | minor gap (backlog) |

**The headline gap** the user flagged: we expose only `navigate_views` + the vibe
todos tools to the cloud model (`app/src/lib/llm/tools.ts` → `CLOUD_TOOLS`). The
model **cannot deliberately remember, recall on demand, link, attest, or forget** —
it only gets whatever `assemble_context` auto-injected. mnemosyne's power comes from
making memory **agentic**: the model decides *what* is worth storing (with an
importance), *when* to search deeper, and curates (validate/forget). That deliberate
control is exactly what a multi-turn conversation needs (ties to card 0023).

We already have nearly all the *primitives* (`remember_with`, `search_traced`,
`relation`/`add_fact`, `entity_card`, `facts`, veracity). Two are missing:
**importance/salience** on a memory, and a **collaborative attest** op. And our two
recall voices ignore the graph/fact data we already store.

Decisions (Samuel, 2026-06-12): focus this card on the **tool surface** ("especially
its tool definitions"); fold in the one primitive the tools need (importance) and a
graph+fact recall voice; make "done" provable by a deterministic brain test.

### Alignment — the three refactoring upgrades

This is 3 of 3 majors sharing one invariant — **the brain is the single context
manager, and the aside is its complete receipt**:
- **[0023](0023-multi-turn-memory-recall.md)** — context assembly + recall:
  continuous brain-managed context (no session/thread concept), 100%-faithful
  Context tab. The graph+fact recall voice added HERE plugs into 0023's RRF+MMR
  pipeline; importance becomes another bounded rank modifier next to
  veracity/age.
- **[0024](0024-cloud-llm-extractor-dreaming.md)** — dreaming: the cloud-mined
  typed facts are exactly what `memory_recall` + the fact voice surface; `attest`
  composes with 0024's confidence/provenance fields.
- **0025 (this)** — agency: deliberate remember/recall/link/attest/forget. Tool
  calls remain visible end-to-end: live-state badges show the calls, and any
  `memory_recall` the model runs lands in the Context-tab receipt like auto
  recall does (same `search_traced` trace path — no invisible memory reads).

## Goal

The cloud model gets a small, deliberate **memory tool surface** — it can store a
fact *with an importance/veracity it chooses*, recall on demand, link two memories,
attest/correct a memory, and forget one — all mapped onto the existing `Brain` API,
plus recall that also draws on the graph + facts we already store.

**Completion condition** (identical to frontmatter `goal`):

> `cargo test -p aven-brain memory_tools -- --nocapture` exits 0 — a deterministic
> test proves the four tool-backing primitives: (a) higher `importance` ranks a
> memory above a lower one for the same query, (b) `forget` removes a memory from
> recall, (c) `attest` raises a memory's veracity weight, (d) an explicit `link` is
> traversable; AND the JS memory tools are wired into `CLOUD_TOOLS` (grep hits);
> `cargo test -p aven-brain` (28+) and `cargo check` / (`cd app && bun run check`) /
> `bun run lint` all green.

The deterministic gate proves the brain primitives + the wiring exist and behave.
The model's *judgment* (does it choose good importances / recall at the right time)
is a HITL smoke, not the unit gate — same split as 0023/0024.

## Approach

Map mnemosyne's tool surface onto our Brain — adopt the *shape*, not a 23-tool
sprawl. Start with the 5 that matter; the rest is backlog.

1. **Importance primitive (brain, first).** Add `importance: f32` (0–1, default 0.5)
   to `RememberOptions` + the `memories` schema + the rank modifiers (a bounded
   weight alongside veracity/age — mnemosyne uses ~20%). Deterministic test:
   same-query, importance 0.9 ranks above 0.1.
2. **Curation primitives (brain).** `forget(id)` (soft-delete / drop from recall) and
   `attest(id)` (raise veracity toward `stated`, mnemosyne's compounding idea, minimal
   form). Tests: forget removes from recall; attest raises the veracity weight.
3. **Graph+fact recall voice (brain).** Fold the entities/links/facts we already store
   into recall as a third voice (entity-match → linked memories; fact-match), fused via
   the existing RRF (composes with the MMR pass from 0023). Test: a query naming an
   entity surfaces a linked memory the lexical/vector voices miss.
4. **Tool surface (app).** A `MEMORY_TOOL_DEFS` + executors (`memory-tools.ts`, mirroring
   `vibe-tools.ts`) calling brain IPCs: `memory_remember{content,importance,veracity}`,
   `memory_recall{query,k}`, `memory_link{from,to,kind}`, `memory_attest{id}`,
   `memory_forget{id}` (HITL-gated like todo-delete). Add to `CLOUD_TOOLS` +
   `CLOUD_SYSTEM_PROMPT` (when to remember vs not — mnemosyne's "would I want this next
   session?"). Verified by check/lint + smoke.

Out of scope (explicit backlog, mnemosyne has these but later cards): canonical
identity slots (`(category,name)`→1 value); temporal-voice + query-time `temporal_weight`
param; scratchpad tool; additive summary_of consolidation; MIB 48-byte binary embeddings
(we chose Gemma fp32 for quality); import/export from other providers; full 23-tool set.

## Steps

1. Brain: add `importance` to `RememberOptions`/schema/rank; deterministic ranking test.
   Checkpoint: show the test ordering by importance.
2. Brain: `forget` + `attest`; tests (removed-from-recall, veracity-raised). Keep 28 green.
3. Brain: graph+fact recall voice into RRF; test an entity-named query surfaces a linked hit.
4. App: `memory-tools.ts` (defs + executors → brain IPCs), into `CLOUD_TOOLS` +
   system-prompt guidance; `bun run check` + `bun run lint` green.
5. HITL smoke: in Talk the model calls `memory_remember`/`memory_recall`; live-state
   badges show the calls; forget is HITL-gated.

## Files to touch

- `libs/aven-brain/src/brain.rs` — `importance` in `RememberOptions` + rank modifier;
  `forget`/`attest`; graph+fact recall voice in `search_traced`; the `memory_tools` test.
- `libs/aven-brain/src/schema.rs` — `importance` column on `memories`.
- `app/src-tauri/src/avendb/brain_ipc.rs` — IPCs for remember(importance)/recall/link/attest/forget.
- `app/src/lib/llm/memory-tools.ts` (new) — `MEMORY_TOOL_DEFS` + executors (mirror `vibe-tools.ts`).
- `app/src/lib/llm/tools.ts` — add to `CLOUD_TOOLS`; extend `CLOUD_SYSTEM_PROMPT`.
- `app/src/lib/identities/identity-agent.svelte.ts` — HITL gate on `memory_forget` (reuse the todo-delete gate).

## Acceptance criteria

Each box checkable from the transcript (a command + its output proves it).

- [x] `importance` exists — `grep -n "importance" libs/aven-brain/src/brain.rs libs/aven-brain/src/schema.rs` hits (24 + 2 lines: `RememberOptions.importance`, the `Memory` field, `importance_weight` ±20% rank modifier, the sealed `importance` column appended LAST in `brain_schema` AND `libs/aven-schema/schema.manifest.json`, with a `migrations/snapshots/before-memory-importance.manifest.json` snapshot per the lens process).
- [x] `cargo test -p aven-brain memory_tools -- --nocapture` exits 0 and prints: (a) importance 0.9 outranks 0.1 for the same query, (b) forget removes from search AND recall (tombstone via `superseded_by`, nothing deleted), (c) attest ladder tool → imported → inferred → stated, weight 0.5 → 1.0 strictly rising, stated is the ceiling, (d) explicit `refers_to` link traversed both directions, idempotent.
- [x] `cargo test -p aven-brain` exits 0 — **34 passed** (32 from 0023/0024 + 2 new; no regression; both recall evals re-run green at 100%/100% and 88%).
- [x] Graph/fact recall voice present — `grep -n "Graph+fact voice\|graph_votes\|Via::Graph" libs/aven-brain/src/brain.rs` shows the third RRF list in `search_traced` (entities named in the query vote via mention links + open-claim `source_memory` provenance; graph hits are exempt from the lexical abstention floor); proven by `memory_tools_graph_voice_surfaces_linked_memory` (the typo'd "Sarha" memory only the graph can connect to "Sarah").
- [x] Memory tools wired — `grep -n "memory_remember\|memory_recall\|MEMORY_TOOL_DEFS" app/src/lib/llm/tools.ts app/src/lib/llm/memory-tools.ts` hits; all five tools are in `CLOUD_TOOLS` and `CLOUD_SYSTEM_PROMPT` carries the "would I want this next session?" guidance. Executors call the brain IPCs (`brainIngest` w/ importance · `brainSearch` · new `brainLink`/`brainAttest`/`brainForget`), the same traced path as auto recall.
- [x] `memory_forget` is HITL-gated — `grep -n "memory_forget\|requestConfirm" app/src/lib/identities/identity-agent.svelte.ts` shows the gate (shares the todos-delete accept/cancel card; cancel feeds a "cancelled" tool result back to the model).
- [x] `cd app && bun run check` clean (only the pre-existing `brand-style.ts`) and `bun run lint` green; `cargo check --no-default-features [--features tinfoil]` green (4 pre-existing warnings only).
- [ ] HITL smoke (human): in Talk the model calls `memory_remember` (with an importance) and `memory_recall`; live-state badges show the calls; forget asks for confirmation.

## Verification

```bash
cargo test -p aven-brain memory_tools -- --nocapture   # importance ranks · forget · attest · link
cargo test -p aven-brain                               # 28+ green
(cd app && bun run check)
bun run lint
grep -n "importance" libs/aven-brain/src/brain.rs
grep -n "memory_remember\|MEMORY_TOOL_DEFS" app/src/lib/llm/tools.ts app/src/lib/llm/memory-tools.ts
# Live smoke: bun dev:app:mac → ask Aven to "remember that X" → watch the memory_remember badge
```

## Hand-off

```
/aven-build 0025
```

…or hand the condition straight to the built-in goal loop:

```
/goal `cargo test -p aven-brain memory_tools -- --nocapture` exits 0 (importance ranks, forget removes, attest strengthens, link traverses), the JS memory tools are wired into CLOUD_TOOLS, and every Acceptance criterion in board card 0025 is checked
```

## Progress log

- `2026-06-12` — Build (claude): moved discover → build → review. (1) Importance
  primitive: `RememberOptions.importance` (0–1, default 0.5) → sealed `importance`
  column appended LAST on `memories` (open_memory reads by index) in `brain_schema`
  AND the app manifest (`schema.manifest.json`, + snapshot
  `before-memory-importance.manifest.json` per the lens-migration process; add-only,
  nulls score 0.5); `importance_weight = 0.8 + 0.4·imp` joins veracity×age as a
  bounded ±20% rank modifier. (2) Curation: `forget(id)` (tombstone — stamps
  `superseded_by` with the row's own id; every read path filters IS NULL; law 3
  honored), `attest(id)` (one tier toward stated: tool→imported→inferred→stated,
  unknown→stated — strictly weight-raising), `link(a,b)`/`linked(id)` (`refers_to`
  note links, idempotent, traversable both directions). (3) Graph+fact recall
  voice: third RRF list in `search_traced` — entities named in the query vote for
  memories via mention links and open-claim `source_memory` provenance (0024's
  mined facts feed straight in); graph hits are EXEMPT from the lexical abstention
  floor (structural evidence); `Via::Graph` added end-to-end (trace types + sky
  badge in the aside). Gate `memory_tools_*` tests print all four proofs; the
  Sarha/Sarah fuzzy-merge case proves the voice surfaces what lexical+vector miss.
  (4) Tool surface: `memory-tools.ts` (5 defs + executors → brain IPCs; remember
  uses stream `note` so deliberate memories don't clog the talk window; recall
  returns ids for link/attest/forget), wired into `CLOUD_TOOLS` +
  `CLOUD_SYSTEM_PROMPT`; new IPCs `brainLink`/`brainAttest`/`brainForget` +
  `importance` on ingest; `ToolContext.identityId` added; `memory_forget` shares
  the todos-delete HITL gate. `cargo test` 34 green · evals unregressed (100%/100%,
  88%) · `cargo check` green both feature combos · `bun run check` clean
  (pre-existing only) · `bun run lint` green. OPEN (HITL): live Talk smoke —
  model calls `memory_remember`/`memory_recall` (badges show), forget asks to
  confirm. NOTE: `memory_link`'s `kind` is fixed to `refers_to` for now (the one
  user-meaning note kind); the tool schema omits a kind param until more kinds earn
  their place.
- `2026-06-12` — Discovery: deep-researched AxDSan/mnemosyne and diffed it against
  aven-brain. Finding: we're architecturally close (identical veracity tiers, RRF k=60,
  abstention floor; richer note/claim/bond link model) — the real gaps are (1) we expose
  ZERO memory tools to the LLM (memory is fully implicit) vs mnemosyne's ~23 explicit
  tools; (2) no importance/salience primitive; (3) graph/fact data we store isn't used as
  a recall voice. Scoped to the tool surface (the user's emphasis) + importance + a
  graph/fact voice; deterministic gate = a brain test proving the 4 tool-backing
  primitives. Canonical slots / temporal-weight / scratchpad / MIB embeddings = backlog.
  Companion to [0023](0023-multi-turn-memory-recall.md) (recall) + [0024](0024-cloud-llm-extractor-dreaming.md) (extractor).
- `2026-06-12` — Alignment pass (Samuel): bound into the 3-upgrade set under the
  shared invariant (brain = single context manager, aside = complete receipt):
  tool-driven `memory_recall` must flow through the same traced path so it shows
  in the Context tab — no invisible memory reads.
