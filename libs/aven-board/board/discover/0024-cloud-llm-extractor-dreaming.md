---
title: Cloud-LLM entity + relation extraction in dreaming (the Extractor seam)
summary: Fill the prepared `Extractor` trait with a real attested-cloud (Tinfoil enclave, glm-5-1) implementation, call it from the dream pass to mine typed subject→predicate→object facts off the write path, write them back to the graph, and surface tokens/cost per step in the Dreaming tab — proven by a deterministic mock-extractor test that the facts land queryable in the graph.
owner: claude
created: 2026-06-12
updated: 2026-06-12
tags: [aven-brain, dreaming, extractor, graph, tinfoil]
goal: "`cargo test -p aven-brain extractor -- --nocapture` exits 0 — a deterministic test drives `Brain::dream` with a MOCK `Extractor` and asserts the returned `ExtractedFact`s are written to the graph as queryable `facts` rows (subject entity → predicate → object); `cargo test -p aven-brain` (28+ tests) and `cargo check` / (`cd app && bun run check`) / `bun run lint` all green; the Tinfoil glm-5-1 extractor compiles behind its feature"
---

# Cloud-LLM entity + relation extraction in dreaming (the Extractor seam)

## Context

`libs/aven-brain/src/extractor.rs` already defines the seam — `Extractor` trait
(`async extract(batch) -> Vec<ExtractedFact>`) and `ExtractedFact`
(subject → predicate → object, validity window, confidence, source memory) — and
documents the design exactly: it runs **off the write path, in dreaming**, is
**purely additive** on top of the deterministic `[[wikilink]]` graph, and any
remote adapter **must send plaintext only to an attested TEE / ZDR endpoint, with
no silent non-attested fallback**. Status today: **"TODO — prepared seam only.
No implementation and no fallback."** So `Brain::dream` runs only its
deterministic passes (decay, exact-name entity merge, relation dedup); the
heuristic graph is `[[wikilink]]`-derived only — there's no model-mined typed
relation, so questions like "who got the red card" / "who scored and when" rely
on raw-chunk recall, which is exactly what degrades (see card 0023).

Two enablers now exist that make filling the seam cheap:
- **Tinfoil enclave** is already wired (`libs/aven-ai` tinfoil feature, used by the
  Talk agent) and performs **enclave attestation on connect** — it *is* an
  attested TEE, so it satisfies the scaffold's security invariant without the
  Phala RedPill integration the doc names as the eventual default.
- **The Dreaming tab** (`TalkBrainAside.svelte`) already renders a per-step
  `tokens` column that is reserved/zero for the deterministic phases — an LLM
  enrich step is what lights it up.

Decisions (Samuel, 2026-06-12): transport = **Tinfoil enclave** (already wired +
attested); model = **glm-5-1** (strong structured-JSON output). Companion to
[0023](../discover/0023-multi-turn-memory-recall.md): 0023 makes recall survive
multi-turn; this card makes the *graph itself richer* so typed-relation questions
are answerable at all. They compose; this one is the "proper cloud-based dreaming"
half.

## Goal

Dreaming mines **typed, temporal facts** from new memories with a cloud LLM (in an
attested enclave) and writes them back into the graph, additively — so the brain
holds `Sithole —received→ red_card`, `Quiñones —scored→ goal@9'`, not just raw
chunks — and the Dreaming tab shows the real token cost of each enrich step.

**Completion condition** (identical to frontmatter `goal`):

> `cargo test -p aven-brain extractor -- --nocapture` exits 0 — a deterministic
> test drives `Brain::dream` with a MOCK `Extractor` and asserts the returned
> `ExtractedFact`s are written to the graph as queryable `facts` rows
> (subject entity → predicate → object); `cargo test -p aven-brain` (28+ tests)
> and `cargo check` / (`cd app && bun run check`) / `bun run lint` all green; the
> Tinfoil glm-5-1 extractor compiles behind its feature.

Why a **mock** extractor in the gate: the LLM is non-deterministic and network-
bound, so the *deterministic, CI-able* contract is "given facts, the dream pass
writes them to the graph queryably." The real glm-5-1 extraction **quality** is a
**measured prerequisite / HITL smoke** (criterion below), not the unit gate — the
same split 0023 uses for the Gemma embedder.

## Approach

Smallest-verifiable-first. The trait + write-back + mock test is the deterministic
core; the Tinfoil adapter + app wiring is the real-world half behind a smoke.

1. **Write-back + mock (deterministic core, first).** Implement the dream→graph
   path: `Brain::dream` (or the stepped `dream_step` enrich phase) calls the
   configured `Extractor` on the batch of newly-written, not-yet-extracted
   memories, normalizes each `ExtractedFact`'s subject/object to entities, and
   writes a `facts` row (subject→predicate→object, confidence, source_memory,
   validity window). Add a `MockExtractor` (returns fixed facts) + a test that
   ingests the match report, runs dream, and asserts the facts are present +
   queryable. **This is the gate.**
2. **Tinfoil glm-5-1 extractor (the real adapter).** A `TinfoilExtractor` that
   prompts glm-5-1 for **structured JSON** (an array of {subject, predicate,
   object, valid_from?, valid_to?, confidence}), parses → `Vec<ExtractedFact>`.
   Lives where it can see both brain + Tinfoil (app layer / `libs/aven-ai`, like
   the embedder injection), behind a feature. Attestation is verified on connect
   (Tinfoil default) — honor the no-non-attested-fallback invariant.
3. **Wire into the stepped dream + tokens.** The app's `runDreamLogged` /
   `brain_ipc_dream_step` injects the extractor; the enrich step returns real
   `tokens` so the Dreaming tab's token column comes alive (it's already
   rendered). Cap batch size per step (quality-over-latency, but bounded so a
   dream step still yields).
4. **Idempotence / provenance.** Don't re-extract a memory twice (track an
   extracted cursor/flag); facts carry `source_memory` for provenance + later
   decay/verify. Dedupe identical (subject,predicate,object).

Out of scope (follow-on): Phala RedPill adapter (Tinfoil covers attested-cloud
now); fact decay/contradiction-resolution policy; using extracted facts in the
recall ranker (0023 territory); multi-pass re-prompting.

## Steps

1. Implement `Brain` write-back of `ExtractedFact` → `facts`/entity rows + a
   `with_extractor` injection point; add `MockExtractor` + the deterministic test.
   Checkpoint: `cargo test -p aven-brain extractor` green; show the facts the test
   reads back.
2. Implement `TinfoilExtractor` (glm-5-1, structured JSON) behind a feature;
   `cargo check` green. No real call in CI.
3. Wire injection through `brain_ipc` / `runDreamLogged`; enrich step returns real
   tokens. `bun run check` + `bun run lint` green.
4. HITL smoke: ingest the match report → dream → Dreaming tab shows an `enrich`
   step with non-zero `tokens`; the graph holds the red-card + goal relations.

## Files to touch

- `libs/aven-brain/src/extractor.rs` — `MockExtractor`; (keep the trait/types).
- `libs/aven-brain/src/brain.rs` — `with_extractor` injection; dream→graph
  write-back of `ExtractedFact`; extracted-cursor idempotence; the `extractor`
  test.
- `libs/aven-ai/src/` (or app) — `TinfoilExtractor` (glm-5-1, structured JSON),
  behind a feature.
- `app/src-tauri/src/avendb/brain_ipc.rs` — inject the extractor into the dream
  step; return real `tokens`.
- `app/src/lib/identities/identity-agent.svelte.ts` — `runDreamLogged` surfaces the
  enrich step's tokens (the column already exists in `TalkBrainAside.svelte`).

## Acceptance criteria

Each box checkable from the transcript (a command + its output proves it).

- [ ] `MockExtractor` + write-back exist — `grep -n "MockExtractor\|with_extractor\|ExtractedFact" libs/aven-brain/src/brain.rs libs/aven-brain/src/extractor.rs` hits.
- [ ] `cargo test -p aven-brain extractor -- --nocapture` exits 0 — prints the facts read back from the graph (subject→predicate→object) after a mock-extractor dream.
- [ ] `cargo test -p aven-brain` exits 0 (28+ tests; no regression).
- [ ] `TinfoilExtractor` compiles — `grep -rn "TinfoilExtractor" libs/ app/` hits and `cargo check` (with the feature) is green.
- [ ] Dream step returns real tokens — `grep -n "tokens" app/src-tauri/src/avendb/brain_ipc.rs` shows the enrich step populating it (not hard-zero).
- [ ] `cd app && bun run check` clean (only the pre-existing `brand-style.ts`) and `bun run lint` green.
- [ ] HITL smoke (human): ingest the report → dream → Dreaming tab shows an
      `enrich` step with non-zero `tokens`; querying the graph surfaces the
      red-card + goal-scorer relations.
- [ ] Security invariant honored: the Tinfoil adapter verifies attestation before
      sending memory content; no non-attested fallback path exists.

## Verification

```bash
cargo test -p aven-brain extractor -- --nocapture     # mock-extractor facts land in graph
cargo test -p aven-brain                              # 28+ green
cargo check                                           # + the extractor feature
(cd app && bun run check)
bun run lint
grep -n "MockExtractor\|with_extractor" libs/aven-brain/src/brain.rs
grep -rn "TinfoilExtractor" libs/ app/
# Live smoke: bun dev:app:mac → ingest report → watch Dreaming tab enrich step w/ tokens
```

## Hand-off

```
/aven-build 0024
```

…or hand the condition straight to the built-in goal loop:

```
/goal `cargo test -p aven-brain extractor -- --nocapture` exits 0 (mock-extractor facts written queryably to the graph), the Tinfoil glm-5-1 extractor compiles behind its feature, the dream step returns real tokens, and every Acceptance criterion in board card 0024 is checked
```

## Progress log

- `2026-06-12` — Discovery: Samuel asked to also wire cloud-LLM entity/relation
  extraction into dreaming ("proper cloud-based dreaming"). Found the `Extractor`
  seam already scaffolded (trait + `ExtractedFact`, off-write-path, attested-TEE
  invariant) with no impl. Decisions: transport = Tinfoil enclave (already wired +
  attested, satisfies the invariant without Phala); model = glm-5-1. Sliced as a
  companion to 0023: deterministic gate = mock-extractor facts land queryable in
  the graph; real glm-5-1 quality = HITL smoke (token column already rendered).
