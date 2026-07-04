---
title: Granular skill upgrades — one diff-based seam per layer
summary: Upgrade a LIVE promoted skill layer-by-layer (look · behavior · data shape · actor code · ops) — each step independently callable, diff/patch-based, never a full rewrite; user-earned config always survives.
owner: claude-code
created: 2026-07-04
updated: 2026-07-04
tags: [skillify, actors, ontology, vibes, upgrades]
goal: "bun --env-file=.env.samuel test libs/betterauth/tests/ passes twice in a row with new skill-upgrade tests covering all four seams (sync_vibe diff-copy · improve_code minimal-edit+smoke · sync_data additive diff · wording grafts survive every other seam), bunx tsc --noEmit -p libs/betterauth exits 0, and the acceptance criteria below are all checked"
---

# Granular skill upgrades — one diff-based seam per layer

## Context

Board 0113 shipped the mockup→skill promotion pipeline and the first post-live
improvement (`improve_skill` — wording-only graft into the promoted skill's
data_crud mailbox, live-proven with "German 25,33 € / bought ⇒ negative" on
banking-overview). Samuel's follow-up design directives (2026-07-04, interview):

1. **Granular, not monolithic**: upgrades target ONE layer at a time — "nur das
   Aussehen aktualisieren" must never touch data, code, or vocab. No "re-run the
   whole pipeline" as the upgrade UX.
2. **Diff/patch-based, never full rewrites**: same posture as the existing
   precedents — `edit_mockup` PATCH-merges only changed sections
   (mergeMockupPatch), `improve_skill` grafts wording without touching schema
   shape. Every new seam follows suit.
3. **Explicit sync step for look** (interview decision): editing the mockup of a
   LIVE skill changes the mock only (safe design sandbox); the user says
   "übernehmen/sync" to push it live — the same HITL rhythm as the pipeline.
4. **All four layers in ONE card** (interview decision — no slice split).

Current freeze points this card removes: `wire_actors` inserts actor rows with
ON CONFLICT DO NOTHING (overview code + crud params frozen at first wire); the
promoted vibe only updates via a full `promote` re-copy; a mockup-source shape
change never reaches predicates/bundle/crud.

Related: 0113 (pipeline + improve_skill + derived progress), 0115 (mockup PATCH
editing), 0112 (universal ops engine), 0102 (bundles). Constraints that carry
over: mock- namespace wall; style validator is the hard boundary (never widen);
QuickJS caps fail-closed (`['ops']` only); WIRE-STABLE ids (skill ids never
renamed); no fuzzy string routing — exact/canonicalized resolution + honest
errors + LLM context (0113 lesson); hand-rolled actor ids must be globally
unique (0095 lesson); dev/next DB writes authorized.

## Goal

A live promoted skill can be upgraded layer-by-layer from chat — look, behavior
wording, data shape, actor code — each via its own diff-based step, idempotent
(empty diff ⇒ honest "nichts zu tun"), with user-earned config (improve_skill
grafts) surviving every other seam.

**Completion condition** (the hand-off line for `/goal` — identical to
frontmatter `goal`):

> `bun --env-file=.env.samuel test libs/betterauth/tests/ passes twice in a row with new skill-upgrade tests covering all four seams (sync_vibe diff-copy · improve_code minimal-edit+smoke · sync_data additive diff · wording grafts survive every other seam), bunx tsc --noEmit -p libs/betterauth exits 0, and the acceptance criteria below are all checked`

## Approach

One seam per layer, each a tool actor on skillify AND (where it names a live
skill) advertised per-skill like improve_skill (0113 ae43ab14 pattern), so the
router can land either way. All seams resolve names through resolveMockup /
mockName canonicalization and fail honestly with availables.

| Layer | Seam | Diff mechanism |
| --- | --- | --- |
| Look | `sync_vibe` (new) | compare the 4 mock rows vs real rows; copy ONLY differing bodies mock→real; report which of view/style/logic/source moved; empty diff ⇒ "identisch — nichts zu übernehmen" |
| Behavior wording | `improve_skill` (exists) | unchanged; other seams must COMPOSE with its grafts, never clobber |
| Data shape | `sync_data` (new) | diff mockup skeleton vs stored bundle: fields present in skeleton but missing as traits → mint ONLY missing predicates (reuse-or-mint via ontology cap), ADD-ONLY traits via saveType upsert (ops re-derive), GRAFT only the new params into the crud mailbox properties (existing descriptions — incl. improved wording — untouched). Removals are OUT of scope (add-only, like the CRDT lens default) |
| Actor code | `improve_code` (new) | GLM receives the CURRENT code + instruction with EDIT-style instructions (minimal change, like EDIT_INSTRUCTIONS for mockups); result must pass the existing smokeRunOverview contract gate before the row updates; on new fields, sync_data may pass a refreshed contract |

UX: stateless steps, callable in any order; each replies with a card/summary of
exactly what its diff touched. No orchestrating "upgrade everything" step.

## Steps

1. **S1 `sync_vibe`**: diff-copy cap in promote-caps (per-table body compare,
   copy only changed), tool actor + registry + skillify advertisement
   (migration), honest empty-diff reply. Test: edit mock style only → exactly
   `style` reported moved; second sync → empty diff.
2. **S2 `improve_code`**: GLM minimal-edit seam (current code + instruction →
   edited code), smokeRunOverview gate, actor row UPDATE (code only), per-skill
   advertisement alongside improve_skill. Test with seam stubbed: code updates
   & runs; failing smoke ⇒ row untouched + honest error.
3. **S3 `sync_data`**: skeleton-vs-bundle differ, additive mint (ontology
   reuse-or-mint), saveType add-only trait upsert (ops re-derive), crud-mailbox
   param graft preserving existing descriptions. Test: add `notes` field to
   mock source → 1 predicate minted/reused, trait added, `notes` param grafted,
   improved description still contains the German-numbers rule.
4. **S4 wiring + card**: skillify flow nodes/edges for the three new seams
   (migration), derived-progress/status hint mentions upgradability, board card
   → review.

## Files to touch

- `libs/betterauth/src/promote-caps.ts` (sync_vibe · improve_code · sync_data caps + diffs)
- `libs/betterauth/src/mockup-caps.ts` (raw-parts compare helper if needed)
- `skills/tools/promote.ts` + `registry.ts` + `types.ts` (3 new tool actors)
- `libs/betterauth/migrations/01xx_*.ts` (skillify + per-skill actor rows, flow nodes)
- `libs/betterauth/tests/skillify-promotion.test.ts` or new `skill-upgrades.test.ts`

## Acceptance criteria

- [ ] `sync_vibe` copies ONLY changed vibe rows (test proves an untouched table's body is byte-identical after sync) and reports an empty diff honestly.
- [ ] `improve_code` never persists code that fails the smoke gate; the GLM seam receives the CURRENT code (minimal-edit contract), not a from-scratch brief.
- [ ] `sync_data` is add-only: new field ⇒ predicate (reuse-or-mint) + trait + derived ops + crud param graft; no existing trait/param/description is rewritten.
- [ ] The improve_skill wording graft (e.g. the German-numbers rule) survives sync_vibe, sync_data, and improve_code (asserted in tests).
- [ ] Each seam is independently callable and idempotent (second run ⇒ empty diff / no-op).
- [ ] All new actors resolve names via the shared canonicalizer and fail honestly with available names; no fuzzy matching anywhere (grep-provable).
- [ ] Suites: betterauth tests green twice in a row; tsc clean; svelte-check clean if app files move.

## Verification

```bash
bun --env-file=.env.samuel test libs/betterauth/tests/   # ×2
bunx tsc --noEmit -p libs/betterauth
grep -rn "includes(" skills/tools/promote.ts | grep -v fields  # no fuzzy resolution crept in
```

## Progress log

- `2026-07-04` — DISCOVERED: layer map + diff-per-seam design from Samuel's
  directives (granular steps, diff/patch not rewrites); interview decisions:
  explicit look-sync step (mock stays the sandbox), ALL FOUR layers in this one
  card. Filed straight into discover/ with measurable goal + acceptance
  criteria seeded.

- `2026-07-04` — SLICE PULLED FORWARD live (Samuel: banking lacks the Planner
  granularity — separate add/edit steps + one vibe per step): promoted skills now
  get Planner-grade PRESENCE from birth — wireSkill mints a per-skill FLOW row
  (dispatch/overview/read/create/edit/delete/improve nodes, per-step vibes — the
  todos pattern: granularity lives in flow nodes over ONE data_crud actor) plus
  deterministic per-verb cards `<type>-created/-edited` (no GLM); generic crud
  results now emit those cards (vibeExists guards legacy skills). NEW `sync_actors`
  upgrade seam (ADD-ONLY diff: missing nodes/cards appended, nothing rewritten,
  idempotent → honest empty diff) on skillify + every promoted skill (migration
  0100). Tests: presence-from-birth + add-only/idempotent/honest-miss.
  111/0 ×2 · tsc · svelte-check clean. Remaining for this card: sync_vibe
  (look diff-copy) · improve_code (minimal GLM edit + smoke) · sync_data
  (additive shape diff). Live demo pending: Samuel runs "sync banking actors"
  in chat → transaction-created/-edited cards + granular graph.
