---
title: Memory recall + auto-context that survives a multi-turn conversation
summary: Make Aven reliably answer questions about an ingested document across many turns (incl. an unrelated doc ingested in between) — feed the chat thread into context, tune recall + re-rank, verify the multilingual Gemma embedder, proven by an extended multi-turn recall eval.
owner: claude
created: 2026-06-12
updated: 2026-06-12
tags: [aven-brain, recall, context, eval]
goal: "`cargo test -p aven-brain recall_eval -- --ignored --nocapture` exits 0 with the NEW multi-turn case asserting mean fact-coverage@8 ≥ 0.85 over the post-second-doc probe sequence AND no drop vs the pre-second-doc baseline; `cargo test -p aven-brain` (27+ tests) and `cargo check`/(`cd app && bun run check`)/`bun run lint` all green"
---

# Memory recall + auto-context that survives a multi-turn conversation

## Context

Real failure (verbatim transcript). The user ingested a long German football
match report (WM-2026 opener, Mexico 2:0 South Africa) into Talk. Early Q&A
mostly worked, then it **degraded**:

- "wer hat die tore geschossen und wann?" → wrong goal minute (46'/20' instead
  of 67'/9'), then "no info on the first goal".
- After ingesting a **second, unrelated** document (a coaching-website HTML),
  asking **"who won the 2026 Mexico vs South Africa game?"** → the brain
  **completely failed to recall the report** and answered from general LLM
  knowledge ("South Africa isn't a 2026 co-host, no such match"), even when told
  "check your memory".

So recall **doesn't survive a few message ping-pongs**, especially once new
content is ingested. Two distinct root causes (both must be fixed — "both" card):

1. **The cloud model never sees the chat thread.** In pure-cloud mode
   (`runCloudLoop`, `identity-agent.svelte.ts`) the messages are
   `[system] + [brain assembled context] + [current user message]` — NOT the
   conversation. So a conversational follow-up ("check your memory", "schau
   nochmal") has nothing to work with when recall misses; the model can't even
   see what it just said.
2. **The embedder is the stub** (deterministic hashed bag-of-words, no
   semantics). The headline failure — an **English** question over a **German**
   document ("south africa" shares zero tokens with "Südafrika") — is
   *fundamentally* an embedder problem: only a multilingual semantic embedder
   bridges it. EmbeddingGemma's 1.23 GB download was only just fixed (board
   thread); until it loads, cross-lingual + paraphrase recall is noise.

Recall today = hybrid RRF (vector cosine over embeddings + lexical/stemmed BM25)
+ veracity/age modifiers + abstention floor + budget packing, with **no
re-ranking / query-expansion / multi-hop**. A deterministic eval harness exists
(`libs/aven-brain` `recall_eval`, fact-coverage@k on this exact report) — ~79%
chunked coverage with the stub — and is the measurement seam.

Decisions (Samuel, 2026-06-12): tackle **both** threads in one card
(thread-feed + recall tuning AND Gemma verification); make "done" provable by
**extending the recall eval to a multi-turn sequence**.

## Goal

Aven reliably answers questions about an ingested document across a multi-turn
conversation (≥6 turns), **including an unrelated document ingested in between**
— "who won", "who scored and when", "how many cards" all stay answerable.

**Completion condition** (identical to frontmatter `goal`):

> `cargo test -p aven-brain recall_eval -- --ignored --nocapture` exits 0 with
> the NEW multi-turn case asserting mean fact-coverage@8 ≥ 0.85 over the
> post-second-doc probe sequence AND no drop vs the pre-second-doc baseline;
> `cargo test -p aven-brain` (27+ tests) and `cargo check` /
> (`cd app && bun run check`) / `bun run lint` all green.

The metric proves the deterministic, CI-able core (thread-aware recall survives a
second-doc ingest). The **cross-lingual / semantic** win depends on the real
Gemma model and is a **measured prerequisite** (criterion below), not part of the
deterministic gate — the stub can't do semantics by construction.

## Approach

Four moves, smallest-verifiable-first. Brain changes are deterministic + unit-
tested; the app + model changes get a HITL smoke.

1. **Multi-turn recall eval (the metric, first).** Extend `recall_eval` in
   `libs/aven-brain/src/brain.rs`: ingest doc A (the match report) AND a second
   unrelated doc B (a short fixture), then run a **probe sequence** about A
   (won / scorer+minute / card counts). Assert mean fact-coverage@8 ≥ 0.85 AND
   `coverage_after_B ≥ coverage_before_B` (no degradation from the second doc).
   This reproduces the failure deterministically and is the gate.
2. **Recall robustness (brain).** Raise `assemble_context` recall `k` + budget
   so a single document's chunks aren't crowded out once a second doc lands; add
   a light **re-rank / diversity (MMR)** pass so the top-k isn't dominated by one
   cluster. Tune the abstention floor for multi-word queries. Drive these by the
   eval numbers (no guessing).
3. **Thread-aware context (app).** `runCloudLoop` includes the **recent
   conversation turns** in the cloud messages (bounded, e.g. last 6), so
   conversational follow-ups work even when recall is imperfect — and
   `assemble_context`'s inner query can be enriched with the recent turn(s)
   instead of only the bare message. (`identity-agent.svelte.ts`.) Verified by
   smoke, not the deterministic gate.
4. **Gemma prerequisite (verify).** Confirm EmbeddingGemma loads (download fix is
   in) → multilingual semantic recall. Document in the eval that the cross-
   lingual EN-query/DE-doc case is the embedder's job; optionally add a
   `#[ignore]` gemma-mode probe. Surfaced as `embedder: gemma` in the brain
   aside during the smoke.

Out of scope (follow-on cards): LLM-based entity/relation extraction in dreaming
(separate thread), query-expansion/multi-hop retrieval, a persistent re-embed
migration, full conversation-summary memory.

## Steps

1. Add doc-B fixture + extend `recall_eval` to the multi-turn sequence; run it to
   capture the BASELINE (expected: post-B coverage drops — reproduces the bug).
   Checkpoint: show the baseline numbers.
2. Brain: raise recall k/budget + add the re-rank/MMR pass; re-run the eval until
   coverage ≥ 0.85 and no post-B drop. Keep all 27 existing tests green.
3. App: feed the recent thread into `runCloudLoop` + enrich the assemble query.
   `bun run check` + `bun run lint` green.
4. Verify Gemma loads (manual smoke) — embedder flips to `gemma`; re-ask the
   English question about the German doc and confirm it recalls.

## Files to touch

- `libs/aven-brain/src/brain.rs` — `recall_eval` multi-turn case; recall k/budget;
  re-rank/MMR in `search_traced` / `assemble_context`.
- `libs/aven-brain/src/eval_fixtures/` — a second, unrelated doc-B fixture.
- `app/src/lib/identities/identity-agent.svelte.ts` — thread-aware cloud context.
- (verify only) `app/src-tauri/src/embed_model.rs` / `avendb/brain_ipc.rs` — Gemma
  load path (already fixed; confirm).

## Acceptance criteria

Each box checkable from the transcript (a command + its output proves it).

- [ ] New multi-turn `recall_eval` case exists — `grep -n "multi.turn\|after_b\|doc_b" libs/aven-brain/src/brain.rs` hits.
- [ ] `cargo test -p aven-brain recall_eval -- --ignored --nocapture` exits 0 with
      printed mean fact-coverage@8 ≥ 0.85 over the post-second-doc probes AND
      post-B ≥ pre-B (no degradation).
- [ ] `cargo test -p aven-brain` exits 0 (27+ tests; no regression).
- [ ] Re-rank/recall change present — `grep -n "mmr\|re.rank\|rerank\|recall_k\|budget" libs/aven-brain/src/brain.rs` shows the new logic.
- [ ] Thread-aware context — `grep -n "thread\|recent turns\|messages.push" app/src/lib/identities/identity-agent.svelte.ts` shows the conversation feeding into `runCloudLoop`.
- [ ] `cd app && bun run check` clean (only the pre-existing `brand-style.ts`) and `bun run lint` green.
- [ ] HITL smoke (human): the exact transcript — ingest report, ask across 6+
      turns incl. the second doc + the English question — Aven answers correctly;
      brain aside shows `embedder: gemma`.

## Verification

```bash
cargo test -p aven-brain recall_eval -- --ignored --nocapture   # ≥0.85, no post-B drop
cargo test -p aven-brain                                        # 27+ green
(cd app && bun run check)
bun run lint
grep -n "mmr\|re.rank\|rerank\|recall_k\|budget" libs/aven-brain/src/brain.rs
grep -n "thread\|recent turns" app/src/lib/identities/identity-agent.svelte.ts
# Live smoke: bun dev:app:mac → ingest report, 6+ turn ping-pong incl. 2nd doc + EN question
```

## Hand-off

```
/aven-build 0023
```

…or hand the condition straight to the built-in goal loop:

```
/goal `cargo test -p aven-brain recall_eval -- --ignored --nocapture` exits 0 with the multi-turn case at mean fact-coverage@8 ≥ 0.85 and no post-second-doc drop, and every Acceptance criterion in board card 0023 is checked
```

## Progress log

- `2026-06-12` — Discovery: interviewed Samuel — tackle BOTH the thread-feed +
  recall tuning AND the Gemma verification in one card; measure via an extended
  multi-turn recall eval (ingest A + unrelated B, probe A, assert coverage ≥0.85
  + no post-B drop). Diagnosed the two root causes (cloud model sees no chat
  thread; stub embedder can't bridge EN-query/DE-doc). Created directly in
  discover/ with a measurable goal.
