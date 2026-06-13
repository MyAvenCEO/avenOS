---
title: Recall quality — collapse contradictory identity claims (name/full_name)
summary: The debug export showed recall serving BOTH "the user's name is Sam" and "full name is Samuel" — a contradiction the LLM then trips over. Claim supersession keys on exact (subject, predicate), but the extractor emits synonymous predicates (name / full_name / called / goes_by) so they never collapse. Canonicalize identity predicates so a correction supersedes the old name.
owner: claude (aven-brain)
created: 2026-06-13
updated: 2026-06-13
tags: [aven-brain, recall-quality]
goal: "`cargo test -p aven-brain identity_name_predicates_canonicalize_and_supersede` passes — asserting `add_fact(name=Sam)` then `add_fact(full_name=Samuel)` leaves exactly ONE open claim (`name = Samuel`, the correction); the full suite + `recall_eval_no_regression` stay green."
---

# Recall quality — one canonical name, not a contradiction

## Context

Reading a real [[0029-brain-observability-foundation]] debug export, the turn *"actually I am called
Samuel, please update"* recalled **both** `"The user's name is Sam."` **and** `"The user's full name
is Samuel."` — and the LLM was handed the contradiction. Root cause: `add_fact_with_confidence`
supersedes an open claim only on an **exact `(subject, predicate)`** match, but the LLM extractor
freely emits *different* predicates for the same relation (`name`, `full_name`, `called`, `goes_by`,
…), so the corrected name was stored under a new predicate and the old one never closed.

This is the deterministic half of the recall-quality work; the rest (L0 `self` updating on
correction, and contradictions that live as recalled *memory chunks* rather than claims) is
extractor-behaviour-dependent and is being verified against a fresh export now that the embedder
([[0031-onnxruntime-rotaryembedding-error]]) and Tinfoil extractor both work.

## Goal

A name correction supersedes the old name instead of coexisting with it. Completion = the frontmatter
`goal:`.

## Approach (done)

- `canonical_predicate()` folds name-like predicates (`name`/`full_name`/`called`/`goes_by`/
  `is_named`/`first_name`/`preferred_name`/…) to a single `name` key, and normalizes case/separators
  for everything else. Applied at the top of `add_fact_with_confidence`, so supersession (close the
  old open claim, write the new one) now fires across synonyms.
- Test `identity_name_predicates_canonicalize_and_supersede`.

## Acceptance criteria

- [x] `identity_name_predicates_canonicalize_and_supersede` passes (one open claim, `name = Samuel`).
- [x] Full aven-brain suite (40 lib + 3 integration) + `recall_eval_no_regression` green.

## Verification

```
cargo test -p aven-brain identity_name_predicates_canonicalize_and_supersede
cargo test -p aven-brain
```

## Follow-ups (NOT in this card)

- **Existing polluted graphs**: canonicalization applies to NEW assertions; a store that already holds
  `full_name` claims collapses them on re-assertion, or via `brainRebuildGraph` (wipe + re-derive).
  Optional: canonicalize inside the claim healer (`verify_claims`) so a dream pass heals old data.
- **L0 self updating on correction** — depends on the extractor's `summarize_self`; verify it now
  re-derives "Samuel" with the working embedder + extractor (new export), don't hard-code a fallback.
- **Recalled memory-chunk contradictions** — if derived statements persist as recallable memories,
  decide whether to supersede them too.

## Progress log

- `2026-06-13` — Built predicate canonicalization + supersession (deterministic, harness-proved) while
  the embedder fix (0031) is verified in parallel. Self-refresh + memory-chunk contradictions deferred
  to the post-rebuild export.
