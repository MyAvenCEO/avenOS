---
title: Skillify part 1 — GLM vibe mockups (design a skill screen in chat)
summary: A new `skillify` skill with two actors — `mockup` (GLM-5.2 mints/refines a vibe view+style+example source from natural language, behind the mock- namespace wall + validator gates) and `mockups` (no-LLM show/list) — so a new skill feature's LOOK is designed and iterated in chat before any data exists
owner: unassigned
created: 2026-07-04
updated: 2026-07-04
tags: [skillify, vibes, glm, config-as-data]
goal: "`bun --env-file=.env.samuel test libs/betterauth/tests/` and `bun test libs/aven-vibes/tests/` exit 0 — including NEW tests proving (a) a `skillify` skill row + `mockup`/`mockups` actor rows exist, the router menu lists it, `advertisedTools('skillify')` = ['mockup','mockups'], and composeFlows() shows it with 2 derived nodes; (b) saveMockup() FORCES the mock- prefix (input name `todos` saves as `mock-todos` — the system rows are untouched, asserted), rejects a forbidden style (validateStyleDef) and a forbidden view tag (validateViewDef) and an empty source, and a valid payload lands as vibe_view+vibe_style+vibe_source rows that loadVibe() returns with source; (c) the mockups actor (stubbed ctx) returns content listing minted mockups and vibe {schema:'mock-…'} for show-by-name; (d) the mockup actor's GLM authoring prompt is DB config (actor.prompt non-empty, TS fallback exists) — plus svelte-check exits 0, the vibe-source completeness gate still passes, and Samuel live-confirms in the Tauri app: minting a 'banking accounts' mockup in chat renders the card with example data, one refinement re-renders it, and 'show me my mockups' lists it without a GLM round."
---

# Skillify part 1 — GLM vibe mockups (design a skill screen in chat)

## Context

Board [[0113]] (GLM mints COMPLETE skills) split: this card is **part 1 — the look only**.
Samuel: "discover just the vibe-view and vibe-style and example vibe state data without
much other logic for now. We just want to learn how a new skill feature should look like
with its vibe. After this step we should be able to use the mocked skill — like 'show me
the new skill screen abc'." Part 2 (operations/bundles/ontology wiring, DELEGATED to the
Ontology skill as a sub-skill flow) stays on [[0113]].

Everything this needs already exists (0112/0114 groundwork):
- `vibe_source` registry = the example-state mechanism; previews render it everywhere.
- Generic VibeCard renders ANY schema from DB rows (allow-lists deleted).
- `validateViewDef` + `validateStyleDef` = the pre-save security gates (SAFE_TAGS,
  CSS injection patterns, strict @media/@container). The style validator is the HARD
  security boundary — the mockup path must never widen it.
- The GLM authoring pattern is proven (type-caps bundle mint, glm-5-2, AJV meta-schema,
  prompt-as-DB-config per 0112).
- A skill minted as config rows is born routable + visible + traced (0114).

**Interviewed decisions (2026-07-04):**
1. Host = a NEW `skillify` skill row (pure config; Ontology stays data-focused; part 2
   lands on the same skill).
2. Actor shape = **A: 2 actors + the mock- wall**: `mockup` (GLM mint/refine) +
   `mockups` (no-LLM list/show). Every minted name is FORCED into the `mock-` prefix —
   GLM can never overwrite system vibes (todos/goals/inventory…); the card's TITLE
   stays pretty (it lives in the view). Promotion to a real name = part 2.

## Goal

A user designs a new skill screen conversationally: "design me a banking screen — my
accounts with balances" mints validated vibe config that renders immediately with
example data; "make the total bigger" refines it; "show me my mockups" lists them
instantly — all pure DB config, system vibes untouchable.

**Completion condition** (identical to frontmatter `goal`): see frontmatter.

## Approach

**S1 — the deterministic core (no GLM yet).**
`mockup-caps.ts` (betterauth): `saveMockup(name, {view, style, source})` — normalizes
the name into the `mock-` prefix (whatever GLM emits), runs `validateViewDef` +
`validateStyleDef` + non-empty-source, composes the style `withBrand` if raw, upserts
the three vibe rows; `listMockups()` = vibe_view names with the prefix. Tests (b).

**S2 — the two actors + the skill (config).**
`skills/tools/mockup.ts`: the GLM actor — tool args {description, name?, response};
handler calls a server cap that (1) loads existing rows when refining (name exists),
(2) prompts GLM-5.2 with the MOCKUP_INSTRUCTIONS (the ViewDef grammar + brand class
primitives + the goals view/style as the worked example + the vibe_source shape),
(3) parses/validates/saves via saveMockup, (4) returns vibe {schema: mockName} so the
card renders in the same turn. Prompt lives on the actor row (0112 pattern; TS
fallback). `skills/tools/mockups.ts`: no-LLM — list (grid of minted mockups via a tiny
`mockups` system vibe, seeded like goals) or show {name} → vibe {schema}. Migration
0089: skill row + 2 actor rows (mailboxes + prompt) + the `mockups` list-vibe rows +
example source. Registry: TOOL_ACTORS + the TS fail-safe SKILL_REGISTRY (+ SkillId).
ai.ts: inject the mockup cap like ctx.ontology. Tests (a)(c)(d).

**S3 — chat render + live loop.**
The show path emits vibe {schema} with NO data → MainnetChat currently coerces
`vibeData ?? {}`; pass `undefined` through instead so VibeCard's bundle.source fallback
renders the example state (no generic card emits data-less vibes today — safe). Then
the live loop: mint banking → refine → show (Samuel's confirmation).

**Out of scope:** promotion to real names, any data wiring (ops/bundles/vocab —
part 2 on [[0113]]), mockup deletion UI (data_crud on vibe rows later), multi-card
mockups (one vibe per mockup for now).

## Steps

1. S1 saveMockup + gates + tests (b) — checkpoint: deterministic core green.
2. S2 actors + skill migration + prompt-as-config + tests (a)(c)(d).
3. S3 chat undefined-data passthrough + svelte-check; Samuel's live mint→refine→show.

## Files to touch

- `libs/betterauth/src/mockup-caps.ts` (new), `ai.ts` (cap injection), migration 0089
- `skills/tools/mockup.ts`, `mockups.ts` (new), `registry.ts`, `types.ts` (ctx cap)
- `app/src/lib/shell/MainnetChat.svelte` (one-line data passthrough)
- `libs/betterauth/tests/skillify-mockups.test.ts` (new); vibe-source completeness
  gate must keep passing (minted mockups carry source by construction)

## Acceptance criteria

- [x] `skillify` skill + `mockup`/`mockups` actors: router menu, advertisedTools, composeFlows (2 derived nodes) — skillify-mockups.test (a).
- [x] saveMockup forces `mock-` (input `todos` → `mock-todos`, system vibe_view byte-identical before/after — asserted), rejects position:fixed style / script tag / empty source, valid payload → 4 rows (incl. the identity mapper) + loadVibe serves source + brand-composed style — tests (b).
- [x] mockups actor lists + shows (fuzzy name) without LLM; show emits a DATA-LESS vibe (example-source render) — test (c).
- [x] The GLM prompt is DB config (actor.prompt, >200 chars, carries the VIEW grammar) with the TS fallback — test (d).
- [x] vibe-source completeness gate green (saveMockup writes source by construction; the `mockups` list vibe seeded with sample).
- [x] svelte-check 0 errors; betterauth 98/0 · aven-vibes 19/0.
- [ ] LIVE (Samuel): mint "banking accounts" → card renders with example data; one refinement re-renders; "show me my mockups" lists instantly.

## Verification

```bash
bun --env-file=.env.samuel test libs/betterauth/tests/
bun test libs/aven-vibes/tests/
(cd app && bunx svelte-check --tsconfig ./tsconfig.json)   # expect 0 errors
```

Plus Samuel's live mint → refine → show loop in the Tauri app.

## Progress log

- `2026-07-04` — BUILT green. mockup-caps.ts (saveMockup: mock- wall + validateViewDef +
  withBrand∘validateStyleDef + non-empty source + the IDENTITY mapper — state = source;
  mintMockup: GLM-5.2 with prompt-from-actor-row, refine feeds existing rows back);
  actors mockup (GLM design/refine → data-less vibe render) + mockups (no-LLM fuzzy
  show / list grid); migration 0089 (skill + actors + the `mockups` list vibe with
  sample); ai.ts ctx.mockup cap; MainnetChat passes vibeData UNCOERCED so data-less
  vibes render their example source; withBrand exported at the package root + a ?raw
  module declaration for betterauth tsc. skillify-mockups.test 6/6; suites 98/0 + 19/0;
  svelte-check clean. Remaining: Samuel's live mint → refine → show banking loop.

- `2026-07-04` — Discovered with Samuel (by-example interview: the banking-screen
  walkthrough): host = NEW `skillify` skill; shape = 2 actors + the mock- namespace
  wall (GLM can never overwrite system vibes; titles stay pretty; promotion = part 2).
  Foundation inventoried: vibe_source registry, generic VibeCard, validateViewDef +
  validateStyleDef gates, proven GLM authoring pattern. Part 2 (data wiring via
  Ontology sub-skill delegation) remains on [[0113]].
