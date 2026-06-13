---
title: Context-composition harness + reliable per-message extraction
summary: A real export proved recall feels broken in the assembled CONTEXT, not the embedder (which is fixed). Build a harness that MEASURES context-composition — does the assembled prompt contain the answer, do co-mentioned entities bond, does extraction keep up with the conversation — and bundle the worst fix: reliable per-message extraction (today only 3 of 13 turns extracted).
owner: claude (aven-brain + app)
created: 2026-06-13
updated: 2026-06-13
tags: [aven-brain, recall-quality, testing, dreaming]
goal: "`cargo test -p aven-brain context_composition -- --nocapture` runs a NEW context-composition harness that prints three metrics over a seeded corpus (a rare identity fact among high-volume distractor docs, ingested multi-turn): answer-coverage (assembled prompt contains the probe's answer fact), bond-connectivity (fraction of co-mentioned entity pairs that persist a bond), extraction-liveness (facts mined ÷ messages). A gated test `extraction_runs_for_every_message` exits 0 — after ingesting N memories and running the per-message dream-to-done loop, EVERY memory carries an `extracted` marker and all expected MockExtractor facts persisted (no dropped batches), proving the reliability fix. answer-coverage + bond-connectivity baselines are recorded (printed) for follow-on cards. `recall_eval_no_regression` + full aven-brain suite stay green; `cargo build -p aven-os-app --features desktop-ai` exits 0; app `bun run check` clean."
---

# Context-composition harness + reliable per-message extraction

## Context

Board [[0031-onnxruntime-rotaryembedding-error]] fixed the embedder (a real export now shows
`embedder: gemma` on every round, entities typed). But recall still feels broken, and a real export
(`brain-debug-cc7a9258…`) proved **three composition/quality culprits** — confirmed in the data:

1. **Identity loss.** *"I am Samuel, 37, founder of MaiaCity"* is stored (3 memories incl. an agent
   note) but identity probes (`wie heiße ich?`, `wie heißt mein projekt?`) recall only football
   volume — the rare relevant memory is drowned, and the L0 self dropped name/age/project for a
   generic topic description.
2. **Bonds don't connect.** ZERO entities carry bonds in any trace. Bonds only form from `[[wikilink]]`
   co-mentions in `write_graph`; LLM-extracted entities (Mexiko, players, …) never bond, so the graph
   has nodes but no edges.
3. **Extraction doesn't keep up.** Over 13 turns: `enrich` ran 96×, but `extract` only **3×** (12
   `extract_ready`, 3 completed) → ~11 facts total, self refreshed 3×. Root cause: the app dream loop
   **skips a turn's dream if one is already running** (`if (dreaming) return`) and fires extraction
   **fire-and-forget** (un-awaited, lost on a Tinfoil timeout, never retried). Messages arriving faster
   than dreams complete are never extracted.

The architecture mirrors mnemosyne (remember / recall=RRF hybrid / sleep=dream / triples / decay /
importance); the gap is **quality + reliability**, and we can't improve what we can't measure. The
existing `recall_eval` only scores RAW recall (fact-coverage@8 over `search_traced`) — it never checks
the **assembled context** (self + gist + working + recalled + entities), which is what the LLM sees.

**Decisions (confirmed with the user):**
- **Slice:** bundle the harness + the single worst fix (per-message extraction reliability). Identity
  recall, self-preservation, and bond-formation become follow-on cards gated by this harness.
- **Gate three metrics:** answer-coverage, bond-connectivity, extraction-liveness.
- **Fully generic** — no hardcoded vocabulary/fields (board [[0034-identity-claim-contradiction]] lesson).

## Goal

Make context-composition quality a set of numbers a test reports, and make extraction reliable enough
that the graph + self keep up with the conversation. Completion = the frontmatter `goal:`.

## Approach

- **Harness (`context_composition`, `--ignored` scoreboard + a gated test).** Stub embedder for
  determinism; `MockExtractor` for deterministic facts/entities. Seed a corpus = a few high-volume
  distractor docs (match reports) + a rare identity memory + co-mentioned entities, ingested across
  several turns. Then over probes, measure on the **assembled `ContextBundle`** (not raw recall):
  - **answer-coverage** — the probe's answer substring appears anywhere in `bundle.prompt`.
  - **bond-connectivity** — fraction of entity pairs co-mentioned in a memory that have a persisted
    `assoc` bond (read the graph after dreaming).
  - **extraction-liveness** — `facts_mined / messages_ingested` after the per-message dream loop.
  - Print all three (`--nocapture`); record answer-coverage + bond baselines (red is OK — they're the
    follow-on cards' targets).
- **The worst fix — reliable per-message extraction (the gated metric).**
  - Lib: ensure the stepped extract path extracts EVERY not-yet-extracted memory across repeated
    per-message passes (no batch dropped); a memory is only marked `extracted` after its facts land.
  - App (`identity-agent.svelte.ts` `runDreamLogged`): replace the `if (dreaming) return` **skip** with
    a **pending re-run** (if a message lands mid-dream, dream again when the current one finishes), and
    **await + retry** the off-actor extract (a transient Tinfoil timeout must re-batch, not vanish).
  - Gated by `extraction_runs_for_every_message`: ingest N memories, run the per-message dream-to-done
    loop (incl. `extract_one_batch`), assert all N are `extracted` + every MockExtractor fact persisted.

## Steps

1. Build the `context_composition` harness (seed corpus + the 3 measurements) + the `--ignored` scoreboard.
2. Add `extraction_runs_for_every_message` (red against today's lib stepped path if it drops batches).
3. Fix the lib extract path so per-message dreaming leaves nothing unextracted → test green.
4. Fix the app dream loop (pending re-run + awaited/retried extract); `bun run check` + app build.
5. Record answer-coverage + bond baselines in the scoreboard output; confirm no recall regression.

## Files to touch

- `libs/aven-brain/src/brain.rs` (+ maybe `eval_fixtures/`) — harness, metrics, extraction-liveness test, lib reliability.
- `app/src/lib/identities/identity-agent.svelte.ts` — `runDreamLogged` skip→re-run + awaited/retried extract.

## Acceptance criteria

- [ ] `context_composition -- --nocapture` prints answer-coverage, bond-connectivity, extraction-liveness.
- [ ] `extraction_runs_for_every_message` exits 0 — every ingested memory extracted, all expected facts persisted.
- [ ] answer-coverage + bond-connectivity baselines recorded (printed) for the follow-on cards.
- [ ] `recall_eval_no_regression` + full aven-brain suite green; `cargo build -p aven-os-app --features desktop-ai` exits 0; `bun run check` clean.
- [ ] No hardcoded vocabulary/fields anywhere (generic).

## Verification

```
cargo test -p aven-brain context_composition -- --nocapture          # the 3 metrics + the gated test
cargo test -p aven-brain extraction_runs_for_every_message
cargo test -p aven-brain recall_eval_no_regression
cargo build -p aven-os-app --features desktop-ai
cd app && bun run check
```

## Follow-on cards (separate, gated by this harness)

- **Identity recall + self-preservation** — rare-memory rescue vs high-volume topic; L0 self retains
  durable first-person facts (generic). Target: answer-coverage on identity probes → high.
- **Bond formation** — co-extracted entities (not just wikilinks) potentiate `assoc` bonds; entity
  cards surface them. Target: bond-connectivity → high.

## Progress log

- `2026-06-13` — Discovery: grounded in a real export (3 confirmed culprits — identity loss, zero
  bonds, extraction 3/13). Sliced to harness + the worst fix (per-message extraction reliability);
  identity-recall, self-preservation, and bond-formation are follow-on cards gated by the harness.
  Three metrics chosen: answer-coverage, bond-connectivity, extraction-liveness. Fully generic.
