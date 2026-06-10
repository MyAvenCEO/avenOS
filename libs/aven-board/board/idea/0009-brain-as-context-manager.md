---
title: Brain as the context manager — per-identity, transparent recall
summary: Wire a per-identity aven-brain to each identity's aven-db, ingest everything (intent text/file/audio, every message, every document, every AI response) as memories, and make the brain the SINGLE SOURCE OF TRUTH that assembles context before every LLM roundtrip. Surface a transparent recall snippet on each AI response so the recall flow + references are visible.
owner: unassigned
created: 2026-06-07
updated: 2026-06-10
tags: [aven-brain, ux, context, memory, talk]
goal: "In talk/chat, every AI response carries a RecallTrace the user can expand to see the query, the context layers loaded, and the ranked references (vector/bm25/both badges + scores + citations); and the LLM prompt is built by brain.assemble_context(), not a raw transcript."
---

# Brain as the context manager — per-identity, transparent recall

> Forward design for aven-brain. Supersedes the integration/UX parts of the archived
> execution plan (`board/done/0010-aven-brain-execution-plan.md`), whose library layer
> (remember/search/wake/recall/entity_card/dream + the EmbeddingGemma encoder) already shipped.

## Context

aven-brain is built and tested as a **library**, but it's an island: it's imported by nothing,
its only constructor is `open_in_memory` (test-only), and there's no UI. The big idea here is to
stop treating the brain as "a thing you can query" and make it **the context manager** — the
single source of truth that assembles every prompt before it reaches an LLM. The LLM never sees a
raw, ever-growing transcript; it sees the brain's assembled, budgeted, deduped, semantically
relevant context. "Session history" becomes just memories tagged `session:S`, and cross-session
long-term recall comes for free.

## Approach

### 1. Per-identity brain ⇄ identity's aven-db
Each identity *has* a brain that is a logic layer over **that identity's** encrypted aven-db store
(owner-bound, DEK-sealed, capability-gated). No shared brain. `open_in_memory` becomes
`open(identity)` on the identity's real store + DEK.

### 2. Everything ingests
The intent input (text / file / audio→STT), **every user message**, **every attached document**
(chunked), and **every AI response** → `remember()`, tagged by `session`, `role`, `source`.
Idempotent via `content_hash`.

### 3. Brain auto-manages session context — the SSOT
One call before every LLM roundtrip: `assemble_context(session, turn, budget)`.

```
user intent (text / file / audio)
  1. normalize        audio→STT ; file→chunks
  2. INGEST user turn remember(content, tags=[session:S, role:user])         ← before retrieval
                      attachments → remember each chunk (tags=[session:S, doc:D])
  3. ASSEMBLE  ←──── single source of truth
        L0 identity (always)  +  L1 running summary (always)
        + working memory:  recall(tags=[session:S], recent N turns)
        + L3 search:       hybrid(query=turn) across ALL memories (cross-session)
        + L2 graph:        entity cards + facts for entities in the turn
        → trim to token budget B → ContextBundle + RecallTrace
  4. LLM roundtrip    prompt = ContextBundle → LFM2.5 (local) / remote → response (+ RecallTrace)
  5. INGEST response  remember(response, tags=[session:S, role:assistant])
  6. UI renders       response + recall snippet
```
The brain becomes a **memory-managed context window**: relevance + recency + budget, not blind append.

### 4. Transparent recall UI
Each response carries a `RecallTrace` so the UI can show *why* it answered that way:

```ts
type RecallTrace = {
  query: string;
  layers: { identity: string; summary: string };           // L0 + L1
  recalled: Array<{                                         // L3 hits used
    id: string; snippet: string; source: string;
    lines?: [number, number]; date?: string; tags: string[];
    rank: number; via: 'vector' | 'bm25' | 'both'; score: number;   // WHY it matched
  }>;
  entities: Array<{ name: string; kind: string; facts: string[] }>; // L2 graph used
  budget: { usedTokens: number; maxTokens: number; dropped: number };
};
```

Mini UI snippet (design sketch — Svelte, lands on the AI bubble in `IdentityTalkPanel` / `ContextView`):

```svelte
<script lang="ts">
  export let trace: RecallTrace;
  let open = false;
</script>

<button class="recall-chip" on:click={() => (open = !open)}>
  🧠 {trace.recalled.length} memories · {trace.entities.length} entities
  · {trace.budget.usedTokens}/{trace.budget.maxTokens} tok
</button>

{#if open}
  <div class="recall-panel">
    <div class="row"><b>query</b> {trace.query}</div>
    <div class="row"><b>context</b> L0 identity · L1 summary
      {#if trace.budget.dropped}· {trace.budget.dropped} dropped (budget){/if}</div>
    <ol>
      {#each trace.recalled as m}
        <li>
          <span class="via via-{m.via}">{m.via}</span>     <!-- vector / bm25 / both -->
          <span class="score">{m.score.toFixed(2)}</span>
          <span class="snippet">{m.snippet}</span>
          <span class="cite">{m.source}{m.lines ? `:${m.lines[0]}-${m.lines[1]}` : ''}</span>
        </li>
      {/each}
    </ol>
    {#each trace.entities as e}<span class="entity">{e.name}</span>{/each}
  </div>
{/if}
```
Collapsed = an ambient chip on the AI bubble; expanded = the recall flow (query, layers loaded,
each reference with a why-it-matched badge + score + clickable citation, plus entities/facts used).

### Decisions to lock before building
1. **AI-response ingestion — pollution risk.** Storing model output as memory lets hallucinations
   become "facts." Recommend: ingest `role:assistant` turns but **down-weight them in semantic
   recall** (working-memory only), and let *dreaming* promote/verify any that matter.
2. **L1 running summary** — incremental each turn (fresh, coherent) vs in *dreaming* (batch, cheaper).
   Recommend incremental for coherence + dreaming for the deep rewrite.
3. **Working-memory window** — always include the last *N* raw turns regardless of search; pick N +
   budget split (e.g. 30% working / 50% recall / 20% graph).
4. **Budget strategy** — pin L0+L1, fill by RRF rank to the token budget, surface `dropped`.

### Build phases
- **A. Per-identity persistent brain** — `open(identity)` on the identity's store (replaces in-memory).
- **B. Ingestion hooks** — intent + each message/doc/response → `remember()` with session/role/source tags.
- **C. `assemble_context()` + `RecallTrace`** — the SSOT, exposed as Tauri commands
  (`brain_ingest`, `brain_assemble`, `brain_search`).
- **D. Recall UI** — the snippet above on the AI bubble in talk/chat.
- **E. L1 summary maintenance + budget tuning.**

## Acceptance criteria

- [ ] A brain opens on a real identity's aven-db store (`open(identity)`), not in-memory
- [ ] Intent (text/file/audio), every message, every document chunk, and every AI response are ingested as memories with `session`/`role`/`source` tags (idempotent via `content_hash`)
- [ ] `assemble_context(session, turn, budget)` returns a `ContextBundle` + `RecallTrace`, pinned L0+L1, budget-trimmed, with working memory + L3 search + L2 graph
- [ ] The LLM prompt is built from the `ContextBundle` — not a raw transcript
- [ ] Each AI response in talk/chat shows the recall chip; expanding it reveals query, layers, ranked references (via/score/citation), entities/facts, and budget
- [ ] The 4 decisions above are resolved and reflected in code

## Progress log

- `2026-06-07` — Captured from the design discussion (per-identity brain, ingest-everything,
  brain-as-context-manager, transparent recall UI). The library layer it builds on
  (remember/search/wake/recall/entity_card/dream + EmbeddingGemma encoder) already shipped — see
  the archived execution plan (`board/done/0010-aven-brain-execution-plan.md`).
- `2026-06-10` — Design sections superseded by the **v4 execution plan**
  (`docs/aven-brain-architecture.md`), which folds this card into phases E2–E6 with the locked
  decisions: brain tables = normal CRDT-synced **sealed** tables (engine unseal-on-scan seam,
  plaintext only transiently in RAM on-device); forever-talk (no sessions); per-human-message
  ContextTrace stored in a new sealed `context_traces` table; **wide right aside** (third grid
  column at xl, 22–30rem) showing the exact context sent per message; file drag-drop on an
  identity screen stays in place and ingests into that identity's brain (no `goto('/')`);
  DB viewer goes fully dynamic (runtime table list) with type-aware Vector/Bytea/Timestamp cells
  + brain search tab. The four "decisions to lock" above are resolved there. TEE extractor parked.
