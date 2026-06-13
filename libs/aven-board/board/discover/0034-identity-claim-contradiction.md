---
title: Recall quality — resolve contradictory claims GENERICALLY (no hardcoded vocabulary)
summary: The debug export showed recall serving BOTH "name is Sam" and "full name is Samuel". The fix must be FULLY GENERIC — no hardcoded synonym list (that breaks for German, for other relations, for anything unseen). The contradiction is the LLM extractor emitting inconsistent predicates; the generic fix is to let the extractor RECONCILE against the subject's existing claims, in-context, in any language.
owner: claude (aven-brain)
created: 2026-06-13
updated: 2026-06-13
tags: [aven-brain, recall-quality, extractor]
goal: "An extractor-reconciliation pass collapses contradictory claims with NO hardcoded predicate vocabulary: a test using a MockExtractor (fed the subject's existing open claims) supersedes the old assertion when the LLM marks it stale — proving the mechanism is generic (the canonical-key decision lives in the model/extraction, not a Rust match arm), and `recall_eval_no_regression` stays green."
---

# Recall quality — contradictions resolve generically, never by a hardcoded list

## Context

A real [[0029-brain-observability-foundation]] export showed recall serving **both** `"The user's
name is Sam."` and `"The user's full name is Samuel."`. Claim supersession keys on exact
`(subject, predicate)`, but the LLM extractor emits synonymous predicates (`name`/`full_name`/…), so
the correction never closed the old name.

**A first attempt hardcoded a name-synonym table in Rust (`canonical_predicate`) — and it was reverted
(commit on 2026-06-13).** A hardcoded allowlist is the wrong shape: it only knows the English words
someone happened to list, breaks for German ("heißt", "vollständiger Name"), and does nothing for any
other relation (age, job, location). **The system must stay fully generic** — no domain vocabulary
baked into code.

## Goal

Contradictory claims collapse to the latest truth **without any hardcoded vocabulary** — the
"is this the same relation?" judgement lives in the LLM/extraction, so it works in any language and
for any relation. Completion = the frontmatter `goal:`.

## Approach (generic — to build, extractor-gated)

The intelligence belongs in the extractor, not a Rust table:

- **Reconcile-in-context.** When the extractor mines a batch, also hand it the subject's **existing
  open claims**. The prompt asks it to either (a) reuse the existing predicate when the new assertion
  is the same relation (so normal supersession fires), or (b) explicitly mark which existing claims a
  new assertion **supersedes**. The model — which understands "full name" ≈ "name" ≈ "heißt" — makes
  the call; Rust just applies the supersession it returns.
- **Schema:** extend `Extraction`/`Fact` with an optional `supersedes` (or a "use this existing
  predicate" hint); `extract_batch` passes current open claims in and applies the returned closures.
- **No allowlists, no thresholds, no per-language code.** If a deterministic assist is ever wanted,
  it must be representation-based (e.g. embedding similarity), never a literal word list.
- **Existing polluted graphs** re-extract clean via the dream pass / `brainRebuildGraph`.

## Acceptance criteria

- [ ] A `MockExtractor` fed the subject's open claims returns a supersession; `extract_batch` applies
      it so the old claim closes and only the corrected one stays open. No hardcoded predicate strings
      anywhere in the path.
- [ ] `recall_eval_no_regression` + full suite stay green.

## Verification

```
cargo test -p aven-brain   # the new reconcile test + no-regression
grep -rn "canonical_predicate\|full_name\|goes_by" libs/aven-brain/src   # expect: nothing hardcoded
```

## Follow-ups

- **L0 self updating on correction** — extractor's `summarize_self`; verify against the fresh export
  (embedder 0031 + Tinfoil both working), don't hard-code.
- Validate the whole thing against a real post-rebuild export before calling it done.

## Progress log

- `2026-06-13` — Reverted the hardcoded `canonical_predicate` synonym table (violated the
  fully-generic principle). Re-specced as extractor reconciliation (the model decides same-relation,
  in any language). Back to discover until built + validated against a real export.
