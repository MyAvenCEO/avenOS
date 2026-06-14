---
title: Context assembler — kill the redundant L1 gist + truthful debug-export rounds
summary: A real debug export exposed why recall feels broken — it's the assembled CONTEXT, not the search. The L1 "gist" was just the N most-recent memories verbatim, i.e. a duplicate of the working window (and even the current query). Fix the gist to add context the window doesn't (prefer the summary stream), and fix the debug export's round-pairing so it's trustworthy.
owner: claude (aven-brain)
created: 2026-06-13
updated: 2026-06-13
tags: [aven-brain, recall-quality, observability]
goal: "`cargo test -p aven-brain` passes with a new `l1_gist_never_echoes_the_working_window` (the L1 gist shares NO line with the working window and never echoes the current query) AND `recall_eval_no_regression` still ≥ baseline (no recall regression) AND `debug_export_bundles_messages_traces_and_dreamlog` green under the new shape (rounds = one per PERSISTED trace, matched to its message — no `None` flood); `cargo build -p aven-os-app --features desktop-ai` exits 0."
---

# Context assembler — the gist was noise, and the export lied about it

## Context

The board 0029 debug export (now actually usable) gave us a real session to read, and it's damning —
for the turn *"actually I am called Samuel, please update"* the assembled context was:

```
L0 self:  "Sam is a person who goes by Sam."        ← stale, never updated
L1 gist:  - "acutalyl i am called Samuel, please update"   ← the CURRENT message, echoed
          - "Hi Sam! It's great to meet you."              ← assistant chitchat
          - "The user's name is Sam."
          - "hey i am sam"
working:  (the same 3 messages again)
recalled: "The user's name is Sam." + "The user's full name is Samuel."   ← contradiction, both kept
```

The user was right: **it's the context it pulls together**, not the search. Concretely the **L1 gist
was `recall(gist_n most-recent memories)` verbatim** — computed BEFORE the working window, so it
couldn't even dedupe against it. Result: every prompt carried the recent turns *twice* (gist +
working) plus the user's just-typed message and assistant chitchat — pure noise. And the **debug
export's round-pairing was wrong**: it yoked all-history user messages to the few recent persisted
traces by index, so 225 of 244 rounds showed `embedder: None` — making the export itself misleading.

Two deeper problems are real but **extractor-gated**, so they're separate follow-ups (need the LLM
extractor + a reliable embedder): L0 self not updating on correction, and contradictory facts
(`name=Sam` vs `full_name=Samuel`) not resolving. Those ride on [[0031-onnxruntime-rotaryembedding-error]]
(EmbeddingGemma's ONNX `RotaryEmbedding` crash → flaky/stub embeddings) + a future extractor/self
card. This card is the deterministic, harness-provable slice.

## Goal

The assembled context stops duplicating the working window, and the debug export tells the truth
about which turns assembled context. Completion = the frontmatter `goal:`.

## Approach (done)

- **L1 gist rewrite.** Compute the working window FIRST; then build the gist from the consolidated
  `summary` stream (what dreaming distilled), newest-first; fall back to older memories OUTSIDE the
  window (and never `self`/`summary`/instrumentation/current-turn) only to top up. An empty gist beats
  a redundant one.
- **Truthful export rounds.** `debug_export` now emits one round per PERSISTED `ContextTrace` (the
  turns that actually assembled context), each matched to its human message by the query's first line
  (the inner recall query is the message body, possibly enriched). `DebugRound.message` is now
  `Option<Memory>`. No more `None` flood.
- **Harness proof.** New `l1_gist_never_echoes_the_working_window`; `recall_eval_no_regression`
  re-run to confirm no recall regression.

## Acceptance criteria

- [x] `l1_gist_never_echoes_the_working_window` passes (gist ∩ working window = ∅; no current-query echo).
- [x] `recall_eval_no_regression` still ≥ baseline (no recall regression).
- [x] `debug_export_bundles_messages_traces_and_dreamlog` green under the new rounds shape.
- [x] `cargo build -p aven-os-app --features desktop-ai` exits 0 (39 lib + 3 integration tests green).

## Verification

```
cargo test -p aven-brain l1_gist_never_echoes_the_working_window
cargo test -p aven-brain recall_eval_no_regression
cargo test -p aven-brain debug_export_bundles_messages_traces_and_dreamlog
cargo build -p aven-os-app --features desktop-ai
```

## Follow-ups (NOT in this card)

- [[0031-onnxruntime-rotaryembedding-error]] — EmbeddingGemma ONNX `RotaryEmbedding` crash → flaky
  embeddings / stub fallback. The biggest remaining lever; recall is unreliable until this is fixed.
- **Extractor + self-summary card** — L0 self must update on correction; contradictory claims
  (`name`/`full_name`) must resolve via a consistent predicate + supersession/entity-rename. Needs the
  Tinfoil extractor reliably available (the run that produced the export showed "Cloud AI unavailable").

## Progress log

- `2026-06-13` — Diagnosed from a real debug export (gist = duplicate of the working window; export
  round-pairing wrong). Fixed both deterministically + harness-proved. Flagged self/contradiction +
  0031 as the extractor/embedder follow-ups.
