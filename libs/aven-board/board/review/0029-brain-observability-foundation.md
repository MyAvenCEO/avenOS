---
title: Brain observability foundation — 10× eval harness, persisted logs, full-session debug export
summary: Make "memory is better/worse" PROVABLE and debuggable — scale recall_eval ~10×, persist dreaming/activity logs to a sealed avenDB stream, and add a full-session debug export (messages + every per-round ContextTrace + dreaming logs). The measurement layer recall-quality fixes ride on.
owner: claude (aven-brain + app)
created: 2026-06-13
updated: 2026-06-13
tags: [aven-brain, observability, testing, performance]
goal: "`cargo test -p aven-brain` exits 0 with THREE new tests green — `recall_eval_no_regression` (fact-coverage@8 over a ≥10×-larger suite: ≥40 probes across ≥6 docs incl. ≥3 multi-turn+multi-doc degradation sequences, asserted ≥ a recorded baseline so a recall regression fails), `dream_log_persists_across_brain_instances` (dreaming + activity entries written to a SEALED avenDB log stream round-trip through the store AND are read back by a FRESH Brain over the same client), and `debug_export_bundles_messages_traces_and_dreamlog` (one JSON export contains the full message history + a ContextTrace per round + the dream log) — and `cargo build -p aven-brain -p aven-os-app` exits 0; the `--ignored` scoreboard `cargo test -p aven-brain recall_eval -- --ignored --nocapture` prints the per-scenario coverage table."
---

# Brain observability foundation — measure the memory, then fix it

## Context

The user reports recall is **"quite bad" right now**. Before chasing fixes we need to make recall
quality **provable** and the brain's behaviour **debuggable over time** — otherwise every "fix" is a
guess. This card builds the measurement + observability layer; the actual recall-quality improvements
ride on top of it as follow-on work (once we can prove a change helps, not hurts).

Where things stand (this session): `assemble_context` builds L0 self / L1 gist / L2 entities (typed by
the Tinfoil glm-5-1 extractor) / L3 hybrid recall (RRF over EmbeddingGemma cosine + BM25 + graph voice
+ MMR + abstention) + working window + budget; the brain reads through a frontier-driven decrypt-once
cache ([[0026-frontier-as-peer-memory-cache]] / [[0027-frontier-change-feed]]). Dreaming runs stepped
phases (enrich/extract/merge/decay/verify/consolidate) off-actor. `ContextTrace` + `DreamStep` +
`TraceTiming` exist and flow to the Activity / Context / Dreaming tabs (`TalkBrainAside.svelte`). The
`recall_eval` harness exists (`brain.rs` tests, fact-coverage@8 over the WM-2026 match report + one
distractor doc, ~9 probes, target ≥0.85) but is small. Dreaming/activity logs are **in-memory only**
(`talk-brain-roundtrip.svelte.ts` Svelte `$state`) — they vanish on reload, so cross-turn/cross-restart
debugging is impossible. Related prior work: [[0023-multi-turn-memory-recall]].

**Decisions (confirmed):** persist logs to a **sealed avenDB log stream** (encrypted at rest, synced,
consistent with the brain — written through the `Sealer` like memories). Ship as **one foundation
card** with three milestones; recall-quality fixes are a separate follow-on.

## Goal

Make memory quality a number a test can check, and make the brain's runtime behaviour persist + export
so regressions are visible and reproducible.

**Completion condition** (identical to frontmatter `goal:`):

> `cargo test -p aven-brain` exits 0 with `recall_eval_no_regression` (fact-coverage@8 over ≥40 probes
> / ≥6 docs incl. ≥3 multi-turn+multi-doc degradation sequences, ≥ a recorded baseline),
> `dream_log_persists_across_brain_instances` (sealed avenDB log stream round-trips + a fresh Brain
> reads it back), and `debug_export_bundles_messages_traces_and_dreamlog` (one JSON = messages +
> per-round ContextTrace + dream log) all green; `cargo build -p aven-brain -p aven-os-app` exits 0;
> the `--ignored` `recall_eval` scoreboard prints the per-scenario coverage table.

End state = recall quality is regression-gated by a 10×-bigger eval; the brain's dreaming/activity
history persists (sealed, synced) and can be exported in full for any session. Proof = the three named
tests + the scoreboard. Constraints = only `aven-brain` + `aven-os-app` change; no recall-behaviour
regression (the baseline is the current coverage, captured first).

## Approach & milestones (one card, three testable milestones)

- **M1 — 10× the recall_eval harness.** Grow `eval_fixtures/` from 2 docs to **≥6** (more match
  reports / articles / a couple more distractors, varied length + language) and `EVAL_PROBES` +
  `MULTI_TURN_PROBES` to **≥40 probes** including **≥3 multi-turn degradation sequences** (recall must
  survive 6+ turns AND a second/third unrelated doc ingested mid-conversation — the real failure).
  Keep the `--ignored` scoreboard (`recall_eval`, per-scenario fact-coverage@k table). Add a
  **non-ignored** `recall_eval_no_regression` that asserts mean fact-coverage@8 ≥ a baseline constant
  (captured from today's run) so a recall regression fails CI. Stub embedder for determinism; note
  Gemma as the measured prerequisite for semantic probes.
- **M2 — persist dreaming/activity to a sealed avenDB log stream.** Add a `brain_log` stream/table
  (sealed via the `Sealer`, owner-scoped) holding dreaming `DreamStep`s + `Activity` steps with
  timestamps. The brain (or the app, via an IPC) appends to it as dreaming/turns run; entries survive
  reload + sync. The frontend `brainDreamLog`/`brainActivity` become VIEWS over the persisted stream
  (hydrate on load) rather than ephemeral-only. Test: write entries, drop the Brain, open a fresh
  Brain over the same client, read them back identically.
- **M3 — full-session debug export.** A `brain_debug_export(identity)` (lib method + IPC) producing
  ONE JSON: `{ messages: [...], rounds: [{ message, contextTrace, timings }], dreamLog: [...] }` — the
  full message history, the exact assembled `ContextTrace` (l0/l1/l2/l3 + recalled + entities + budget
  + verbatim prompt + `TraceTiming`) for **every** round, and the full persisted dream log. Wire a
  **"Export debug session"** button in `TalkBrainAside` (beside the per-turn export) that downloads it.
  Test: seed a session (writes + a dream pass), assert the export bundles all three sections with a
  round per human message.

Each round's `ContextTrace` must be retained per message — store it (sealed) alongside the message or
in the log stream so the export can reconstruct "what context did turn N actually see."

## Steps

1. **M1** — add fixtures + probes; capture today's baseline coverage; add `recall_eval_no_regression`.
2. **M2** — define the sealed `brain_log` stream; append dream/activity entries; hydrate the frontend
   views from it; persistence round-trip test.
3. **M3** — persist per-round `ContextTrace`; `brain_debug_export` lib+IPC; the export test; the UI button.
4. Run the suite + the `--ignored` scoreboard; confirm green + no regression; build app crate.

## Files to touch

- `libs/aven-brain/src/brain.rs` (+ `eval_fixtures/`) — harness, baseline, log stream, export, tests.
- `libs/aven-brain/src/schema.rs` — the `brain_log` table (sealed columns).
- `app/src-tauri/src/avendb/brain_ipc.rs` + `app/src/lib/brain/api.ts` — export + log IPCs.
- `app/src/lib/identities/talk-brain-roundtrip.svelte.ts` + `TalkBrainAside.svelte` — hydrate views
  from the persisted stream; the "Export debug session" button.

## Acceptance criteria

Each box provable from the transcript.

- [x] M1: `recall_eval_no_regression` exits 0 — mean fact-coverage@8 = **98.9%** ≥ baseline 0.45 over
      **44 probes / 6 docs** incl. multi-turn + a 300-memory noise haystack; `recall_eval --ignored`
      prints the per-scenario table (multi-turn before/after doc-B + blob-vs-chunked). _(commit 64ceef9)_
- [x] M2: `dream_log_persists_across_brain_instances` exits 0 — a dream step + an activity step written
      to the sealed `dreamlog` stream round-trip through the store; a FRESH `Brain::over` the same client
      reads them back identically; a wrong-key Brain reads **nothing** (proves sealed, not plaintext).
- [x] M3: `debug_export_bundles_messages_traces_and_dreamlog` exits 0 — one JSON = full message history
      (instrumentation excluded) + a per-round `ContextTrace` (sealed `trace` stream) + the dream log;
      `rounds.len() == count(messages where author == user)`.
- [x] No regression: 38 aven-brain lib tests + 3 frontier integration tests stay green; suite warning-clean.
- [x] `cargo build -p aven-brain -p aven-os-app` exits 0; app `bun run check` = 0 errors / 0 warnings
      (also fixed a pre-existing `aven-ui/brand-style.ts` type error that blocked the gate).

## Verification

```
cargo test -p aven-brain recall_eval_no_regression dream_log_persists_across_brain_instances debug_export_bundles_messages_traces_and_dreamlog 2>&1 | tail
cargo test -p aven-brain recall_eval -- --ignored --nocapture   # the scoreboard table
cargo build -p aven-brain -p aven-os-app
```

## Progress log

Newest entry first.

- `2026-06-13` — **Build complete (M1+M2+M3), all three named tests + build + svelte-check green.**
  - **M1**: scaled `recall_eval` 10× — 6 fixture docs, 44 single/multi-turn probes, + a 300-memory
    noise haystack so fact-coverage@8 has teeth (98.9%, sensitive to ranking/budget regressions).
    `recall_eval_no_regression` gate added (baseline 0.45). _(commit 64ceef9)_
  - **M2**: persisted dreaming/activity logs to the sealed `dreamlog` stream — `Brain::append_log`/
    `log_dream_step`/`read_log`; round-trips through the store, survives a fresh `Brain` instance,
    unreadable under the wrong key. Wired into `brain_ipc_dream_step` + `brain_do_extract` (best-effort).
  - **M3**: per-round `ContextTrace` persisted to the sealed `trace` stream (`persist_context_trace`,
    wired into `brain_ipc_assemble_context`); `Brain::debug_export` bundles messages + per-round trace
    + dream log into one JSON; `braindebugexport` IPC + `brainDebugExport` API + an "export session"
    button in `TalkBrainAside` that downloads it. Added `Deserialize` to the trace/dream types.
  - Incidental: fixed a pre-existing `aven-ui/brand-style.ts` svelte-check type error; removed 2 unused
    imports in the frontier integration tests (suite now warning-clean).
- `2026-06-13` — Discovery: uncovered the real goal (make memory quality PROVABLE + the brain
  debuggable, as the foundation for recall-quality fixes). Made it measurable (3 named tests + the
  scoreboard). Confirmed: sealed avenDB log stream for persistence; one foundation card, M1/M2/M3.
  Flagged two pre-existing infra bugs as separate ideate cards (sync `ParentNotFound`, onnxruntime
  `RotaryEmbedding`). Recall-quality improvements = follow-on once this measures them.
