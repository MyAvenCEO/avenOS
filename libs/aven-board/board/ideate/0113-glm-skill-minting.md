---
title: GLM mints complete skills — vocab → ops → vibes → skill/actor rows, zero code
summary: One authoring flow where GLM creates an entire working mini-app/skill as pure DB config — mint gismu predicates, seed its data_operations, author its vibe view/style/logic rows, register the skill + actors — rendered and dispatchable immediately.
owner: claude
created: 2026-07-03
updated: 2026-07-03
tags: [betterauth, skills, glm, north-star]
---

# GLM mints complete skills — vocab → ops → vibes → skill/actor rows, zero code

## Context

The end goal behind board 0112 (the universal operations engine — its
prerequisite). Every layer a skill needs is ALREADY DB config: vocab
(`data_schema`, minted from the Lojban gismu lexicon via the ontology tool),
types (`data_bundles`), operations (`data_operations`, seeded at mint time),
vibes (`vibe_view`/`vibe_style`/`vibe_logic`, rendered by the one engine +
validated by the style validator), skills/actors (`skill`/`actor` rows,
engine-by-name, advertised via the dispatch tiers). What's missing is ONE
GLM-driven flow that composes them: "I want to track my wine cellar" →
GLM mints `wine`/`stored_in`/`rated` predicates → seeds `wine.list/create/…`
(+ the projection for universal filtering) → authors a brand-styled vibe card →
inserts the skill + data actor rows → the dispatch router can route to it and
the vibe renders — a complete mini-app, no deployed code.

Builds directly on: 0112 (one engine, chained joins, DB-stored authoring
prompts), 0106 (dispatch tiers), 0110 (config-as-data skills/actors), 0105/0067
(vibes as DB rows), the ontology gismu skill (1341-entry lexicon), memory
`schema-actor-dynamic-predicates` (this IS that north star's "schema skill").

Open questions for discovery: HITL gates (a new skill should be confirmed
before it's live?); how the vibe-authoring prompt teaches the ViewDef/StyleDef
grammar safely (style validator = the hard boundary); whether the flow is one
`mint_skill` actor or an orchestrated multi-actor workflow; naming collisions +
versioning of minted skills; how the dispatch router's skill menu scales.
