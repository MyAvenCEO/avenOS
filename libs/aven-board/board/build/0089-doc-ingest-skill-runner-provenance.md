---
title: Doc-ingest skill on the generic flow runner — raw-artifact store + provenance (all generic)
summary: Wire ONE skill (doc-ingest) to actually RUN on a minimal-but-generic flow runner, and solve the two reusable layers fully abstractly: a content-addressed raw-artifact store (Postgres bytea behind a swappable interface) and source provenance modeled as x1–x5 predications (krasi). The classified document lands as `document` predications via the 0088 engine; provenance links document → artifact → run. Generic enough for the other basic skills (invoice/extract/match/book) to be add-an-actor follow-ons. mainnet Postgres only; aven-db CRDT untouched.
owner: claude
created: 2026-06-29
updated: 2026-06-29
tags: [postgres, skills, runner, provenance, predication, artifact]
goal: Running the `doc-ingest` skill (config loaded from the `flow` table) through a NEW generic flow runner ingests one real document end-to-end on mainnet Postgres — proven by a live run plus tests: (1) the raw bytes are stored content-addressed in a new `artifact` table (Postgres bytea) behind an abstracted ArtifactStore interface and are retrievable by sha256 (put→get round-trip test exit 0; SELECT shows the row + matching octet_length); (2) the classified document (real gemma4-31b vision) is stored as a `document` composite type via the 0088 engine — data_crud(document,list) returns its title/kind/summary; (3) GENERIC source provenance: `krasi` predications link the document → its artifact (sha256) → the run, queryable via the engine; (4) the runner is generic — a unit test runs a stub 2-node flow through it (exit 0), and it is NOT doc-ingest-specific; (5) the skill is triggerable from the NORMAL CHAT — a `run_skill` LLM tool invokes the runner for the signed-in user, proven by a live chat-driven run; and `bun run check` (aven-skills + betterauth) + the new tests exit 0. aven-db CRDT untouched; only doc-ingest's actors are implemented (other skills are follow-on).
---

# Doc-ingest on the generic runner + generic provenance/artifact layers

## Context

Boards 0087/0088 built the two-layer split + the universal predication engine (register a type →
generic `data_crud`). The skills side (board 0083/0084) is still **descriptive only**: flow configs
live in the admin `flow` table and render in the Skills tab, but **nothing executes** — runs are mock
fixtures, and there is no runner. The `doc-ingest` skill (the first one) stores its raw file to the
**spark filesystem** (`sparkWriteBytes` → `sparks/PRIVATE/<sha256>`), which is the **aven-db CRDT
world** we are keeping untouched, and its `document` output is **ephemeral** (no schema persists it).

This card makes `doc-ingest` actually **run** on a minimal-but-generic flow runner, and — the real
point — solves two **reusable, fully-abstracted** layers that every future ingesting skill needs:

1. **Generic raw-artifact store** — the original bytes, content-addressed, behind a swappable
   `ArtifactStore` interface (Postgres `bytea` impl now; object storage later, no caller change).
2. **Generic source provenance** — modeled as x1–x5 predications (NOT a side-table): every derived
   fact links back to its origin via **krasi** (`x1` source/origin of `x2`). "Where did this come
   from?" is answerable through the same engine, for any skill/source.

The classified document itself lands as a **`document` composite type** on the 0088 engine. So the
pipeline is: **skill runs → raw bytes to ArtifactStore → classify → `document` predications +
`krasi` provenance linking doc ↔ artifact ↔ run** — all generic, with doc-ingest as the first proof.

See [[universal-predication-schema-0084]] (0088 engine), [[two-layer-schema-split]],
[[flow-engine-actor-model]] (0083/0084), [[ontology-gismu-skill]], [[avendb-crdt-vs-mainnet-postgres]].

## Decisions (locked with the user)

- **Runner:** minimal, NOT a full actor engine — but **generic** (executes any `Flow` config's nodes
  via an actor registry), so the other basic skills (invoice/extract/match/book) become add-an-actor
  follow-ons. doc-ingest is wired + proven first.
- **Artifact backend:** Postgres `bytea` (all-in-Neon), behind an abstracted `ArtifactStore` interface.
- **Classify step:** the **real** gemma4-31b vision call (no stub for the skill itself).
- **Provenance:** generic, as predications — `krasi` (source) linking document → artifact (+ run).
- **Trigger surface:** the skill runs from the **normal chat** — a `run_skill` LLM tool (alongside
  `data_crud` in the AI tool-loop) invokes the generic runner server-side for the signed-in user;
  attaching a document and asking to "ingest" it triggers doc-ingest. `POST /api/skills/:id/run` is
  the underlying mechanism the tool calls.

## Approach

- **`libs/aven-skills`** gets the **pure** generic runner: `runFlow(flow, input, actors, ports)` —
  resolve nodes in dependency order from the `Flow` graph, thread `ResourceKind` messages along edges,
  invoke each node's `actor` from an injected **actor registry**, and emit a `FlowRun`/`TraceStep`
  trace (the existing types). Pure + port-injected → unit-testable with stub actors (no DB, no LLM).
- **`ArtifactStore`** interface (put(bytes,mime)→sha256 / get(sha256)→bytes) — Postgres `bytea` impl in
  betterauth. The raw bytes never enter the predication graph; only the **hash** does.
- **`document` composite type** (0088): registered in `predicate_type`, with a provenance part. Place
  structures use the ontology lexicon — `vreji` (record) for the document/artifact identity, value
  places for title/kind/summary, and a **`krasi`** provenance part: `x1` = artifact (source), `x2` =
  the document. The runner persists via `data_crud(document, create, …)` — the engine writes the
  document + provenance predications generically. The run id + timestamp ride the provenance bundle.
- **betterauth** adapters: the Postgres `ArtifactStore`, the doc-ingest actors (`storeDocument` →
  ArtifactStore + the artifact predication; `classify_document` → real gemma4-31b vision), and a
  generic **run endpoint** `POST /api/skills/:id/run` that loads the flow from the table, runs it, and
  persists a `flow_run` trace row.

**Out of scope (explicit follow-on cards):** wiring the OTHER skills' actors (invoice/extract/match/
book); RunsView reading real `flow_run` rows instead of fixtures; the object-storage ArtifactStore
backend; mailboxes/supervision/parallelism/HITL in the runner (synchronous topological run only).

## Steps (small, checkpointed)

1. **ArtifactStore + `artifact` table** — abstracted interface + Postgres `bytea` migration; put→get
   round-trip test (sha256 stable, bytes identical). **Checkpoint.**
2. **Generic flow runner** (pure, aven-skills) — `runFlow` over the `Flow` graph + actor registry →
   `FlowRun` trace; unit test runs a stub 2-node flow (no DB/LLM). **Checkpoint.**
3. **`document` type + provenance** — register the `document` composite type (vreji/value places +
   `krasi` provenance part) in `predicate_type` (ontology-faithful places); `data_crud(document,…)`
   round-trips create→list with provenance. **Checkpoint.**
4. **doc-ingest actors** — `storeDocument` (→ ArtifactStore + artifact predication) and
   `classify_document` (→ real gemma4-31b vision); persistence writes document + `krasi`. **Checkpoint.**
5. **Run endpoint + flow_run** — generic `POST /api/skills/:id/run` loads the flow, runs it via the
   runner, persists a `flow_run` trace; wire doc-ingest end-to-end. **Checkpoint.**
6. **Chat trigger** — a `run_skill` tool in the AI tool-loop invokes the runner; a chat turn
   ("ingest this document" + an attachment) runs doc-ingest from the normal chat. **Checkpoint.**
7. **Verify** — live real-document ingest (via chat + endpoint) + unit tests + repo gates.

## Files to touch

- `libs/aven-skills/src/runner/*` (new) — pure `runFlow` + actor-registry / port types + tests.
- `libs/aven-ontology/src/document-spec.ts` (new) — the `document` composite TypeSpec (vreji + krasi).
- `libs/betterauth/migrations/NNNN_artifact.ts` (new) — `artifact(sha256 PK, bytes bytea, mime, size, created_at)`.
- `libs/betterauth/migrations/NNNN_predicate_type_document.ts` (new) — seed the `document` type spec.
- `libs/betterauth/migrations/NNNN_flow_run.ts` (new) — `flow_run` trace table.
- `libs/betterauth/src/artifact-store.ts` (new) — Postgres `ArtifactStore`.
- `libs/betterauth/src/skills-run.ts` (new) — run endpoint + doc-ingest actor adapters (incl. real LLM) + persistence; `server.ts` wiring.
- `libs/betterauth/package.json` — `@avenos/aven-skills` dep (if not already).
- `libs/aven-board/board/discover/0089-doc-ingest-skill-runner-provenance.md` — this card.

## Acceptance criteria

Each provable from the transcript.

- [ ] ArtifactStore put→get round-trip — bytes identical, sha256 stable — test exit 0; `artifact` SELECT shows the row + matching `octet_length`.
- [ ] Generic runner unit test — a stub 2-node flow runs through `runFlow`, producing the expected `FlowRun` trace — exit 0; runner has NO doc-ingest-specific code (`rg` shows actors resolved from a registry).
- [ ] `document` type registered in `predicate_type`; `data_crud(document, list)` returns the classified doc's title/kind/summary.
- [ ] **Generic provenance:** `krasi` predications link the document → its artifact (sha256) → the run — shown by a SELECT / `data_crud` query.
- [ ] Live end-to-end: `POST /api/skills/doc-ingest/run` with a real file → artifact stored, document predications created, provenance linked, a `flow_run` trace persisted (real gemma4-31b classify).
- [ ] The skill runs from the **normal chat** — a `run_skill` tool call (a live chat turn) triggers doc-ingest end-to-end.
- [ ] aven-db CRDT untouched (no aven-db/spark writes on this path) — `rg` for `sparkWriteBytes` on the new path empty.
- [ ] `bun run check` (aven-skills + betterauth) + the new tests exit 0.

## Verification

```bash
(cd libs/aven-skills && bun run check && bun test)     # generic runner + ArtifactStore interface
(cd libs/aven-ontology && bun run check && bun test)   # document type spec
(cd libs/betterauth && bun run check)                  # tsc exit 0
# Live (running auth server, output in transcript):
#   POST /api/skills/doc-ingest/run  (multipart file)  → { runId, documentId }
#   SELECT sha256, octet_length(bytes) FROM artifact;
#   data_crud(document, list)                          → title / kind / summary
#   krasi provenance rows linking document → artifact → run
rg -n "sparkWriteBytes" libs/betterauth/src/skills-run.ts   # expect: empty (mainnet store, not spark fs)
```

## Hand-off

```
/aven-build 0089
```

## Progress log

Newest entry first.

- `2026-06-29` — **Steps 3–6 DONE + verified; step 7 endpoint-proven, chat wired.** Step 3: `document`
  composite type (vreji/klesi/skicu/krasi/finti) on the 0088 engine (migration 0018) — provenance
  proven. Steps 4+5: `skills-run.ts` doc-ingest actors (storeDocument→ArtifactStore; classify_document→
  REAL gemma4-31b vision) + `runSkillForUser` + `POST /api/skills/:id/run` + `flow_run` (0019).
  **Endpoint e2e PROVEN:** POST a PNG → status done; REAL LLM classified it; artifact stored,
  document predications projected, PROVENANCE loop closed (doc.artifact==artifact.sha256,
  produced.run==flow_run.id), run trace persisted. Step 6: `run_skill` chat tool added to CHAT_TOOLS
  + dispatch in ai.ts → runSkillForUser with the attached image; added a gated text-form tool-call
  recovery (gemma emits tool calls as TEXT in vision mode). Live chat: the model DID emit a run_skill
  call (`run_skill{skill:"doc-ingest", image:…}`), but a CLEAN live run is flaky because the test
  fixture is a 1×1 BLANK png — the model sometimes asks for a real image instead of running. **Step 7
  remaining:** final chat-trigger verification with a REAL document image (best done in the Mac app).
- `2026-06-29` — **Build step 2 DONE.** Generic flow runner (`aven-skills/src/runner/runner.ts`):
  `runFlow` executes ANY Flow by resolving each node's actor from an injected registry (NO
  skill-specific code), longest-path order, threads typed resources along a bus, returns a FlowRun
  trace + final outputs. 3 runner tests + the artifact test pass (4/4), tsc clean. Unblocked the
  server by copying `0016_chain.ts` into the worktree UNTRACKED (won't be committed) — server boots,
  `0017_artifact` applied. **Remaining:** step 3 (document type + `krasi` provenance via the 0088
  engine), step 4 (storeDocument + real gemma4-31b classify actors), step 5 (run endpoint + flow_run),
  step 6 (`run_skill` chat tool), step 7 (live e2e verify).
- `2026-06-29` — **Build step 1 DONE + verified.** `ArtifactStore` port in aven-skills (content-addressed;
  `memoryArtifactStore` + a Postgres-`bytea` `pgArtifactStore`) + the `artifact` table migration
  (renumbered **0017** to avoid colliding with the main checkout's uncommitted `0016_chain` WIP).
  Verified: interface test passes; live `pgArtifactStore` round-trip on the samuel Neon DB
  (put→sha256→get identical, idempotent, bytea via base64 decode/encode). tsc clean (both libs).
  **BLOCKER (server-dependent steps 4–6):** the shared `samuel` Neon dev DB already has `0016_chain`
  applied (main-checkout WIP) but this worktree lacks the file → Kysely refuses to boot the auth
  server ("corrupted migrations: 0016_chain missing"). Steps 2–3 (pure runner + document type) are
  verifiable without the server via direct DB scripts; 4–6 (real LLM classify, run endpoint, chat
  tool) need the server, so the `0016_chain` divergence must be resolved first.
- `2026-06-29` — Discovery. Mapped current state: doc-ingest config already in the `flow` table, but
  NOTHING executes (descriptive only); raw file currently goes to the spark fs (aven-db). User locked:
  minimal-but-GENERIC runner (works for all basic skills; doc-ingest first), Postgres-bytea artifact
  store behind a swappable interface, REAL gemma4-31b classify, and provenance solved generically as
  `krasi` predications. Document = a 0088 composite type (vreji + value places + krasi provenance);
  artifact bytes in a `bytea` table, only the sha256 enters the graph. 6 checkpointed steps. Out of
  scope: other skills' actors, RunsView real runs, object-storage backend, supervision/HITL. Created
  in discover/.
