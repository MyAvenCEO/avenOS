---
title: "Skillify — the skill that mints complete skills, end to end"
summary: A new "skillify" skill orchestrates the whole minting flow from one human wish — it DELEGATES all data authoring (vocab, bundles, operation specs) to the universal Ontology skill as sub-skill calls, authors the UI/behavior artifacts itself (vibe view/style/logic, actor code), registers the skill + actor rows, and HITL-confirms — a working mini-app as pure DB config, zero deployed code.
owner: claude
created: 2026-07-03
updated: 2026-07-03
tags: [betterauth, skills, glm, north-star]
goal: "`bun --env-file=.env.samuel test libs/betterauth/tests/` and `bun test libs/aven-vibes/tests/` exit 0 — including NEW tests proving (a) deriveAppSkeleton() maps the banking mockup source deterministically (top-level arrays → entities with item fields; scalars → computed aggregates); (b) the skillify skill carries the FIVE promotion step actors (plan_app, mint_data, wire_actors, seed_data, promote) each with a vibe, plus an EXPLICIT flow row with plan→…→promote edges served by composeFlows; (c) the pipeline executed against the banking mockup with the GLM-vocabulary seam stubbed lands: bundle + derived ops exist, the promoted skill row + a data_crud actor + an actor.code SANDBOX actor (caps ['ops']) exist, runCodeActor() returns {totalBalance, transactions[]} shaped like the example source (the identity mapper survives promotion), the vibe rows are COPIED mock-banking-overview → banking-overview, and the seeded example rows exist as predications; (d) after crud() adds one more transaction the code actor's next run includes it — plus svelte-check exits 0 and Samuel live-confirms: 'skillify the banking mockup' walks the step cards, then 'add a transaction 12.50 at Rewe' and 'show my banking overview' work against real data."
---

# Skillify — the skill that mints complete skills, end to end

## Context

The end goal behind board 0112 (the universal operations engine — its
prerequisite). Every layer a skill needs is ALREADY DB config: vocab
(`data_schema`, minted from the Lojban gismu lexicon), types (`data_bundles`),
operations (`data_operations`), vibes (`vibe_view`/`vibe_style`/`vibe_logic`,
rendered by the one engine + validated by the style validator), skills/actors
(`skill`/`actor` rows, engine-by-name, advertised via the dispatch tiers).
What's missing is ONE GLM-driven flow that composes them.

**The architecture (Samuel, 2026-07-03) — two skills, strict delegation:**

- **Ontology skill = ALL data authoring.** It already carries exactly the right
  actors — `ontology` (mint predicates from the gismu lexicon), `query`/`mutate`
  (author validated specs), `bundle` (mint composite types + seed their derived
  ops). Skillify NEVER authors data artifacts itself; it calls Ontology as a
  sub-skill (the same delegation model as Todos → configured universal queries:
  domain skills use the universal Ontology engine under the hood).
- **Skillify skill = the end-to-end orchestrator.** From "I want to track my
  wine cellar": ① delegate to Ontology → mint `wine`/`stored_in`/`rated`
  predicates, the `wine` bundle, seed `wine.list/create/update/delete` (+ the
  projection that powers the universal {field,value,op} filter); ② author the
  UI/behavior artifacts ITSELF — `vibe_view` ViewDef JSON, `vibe_style` StyleDef
  composed on the brand layer (`validateStyleDef` = the hard security boundary),
  `vibe_logic` QuickJS, and where needed `actor.code` sandboxed
  `handle(msg, caps)` modules (the 0111 QuickJS-WASM sandbox with fail-closed
  caps = the execution boundary); ③ register the `skill` + `actor` rows so the
  dispatch router routes to it; ④ HITL-confirm before the skill goes live.
  Every authored artifact goes author → VALIDATE (AJV / style validator /
  sandbox smoke-run) → seed → render — never raw-trusted.

Builds directly on: 0112 (one engine, chained graph joins, DB-stored authoring
prompts on the query/mutate actor rows — the pattern skillify's own authoring
prompts follow), 0106 (dispatch tiers), 0110 (config-as-data skills/actors),
0105/0067 (vibes as DB rows), 0111 (actor-code sandbox), the ontology gismu
skill (1341-entry lexicon), memory `schema-actor-dynamic-predicates` (this IS
that north star's "schema skill", generalized to whole skills).

Open questions for discovery: the sub-skill call mechanism (how skillify
invokes Ontology's actors server-side — the first real skill→skill
composition); HITL gates (confirm the whole minted skill once, or per
artifact?); how the authoring prompts teach the ViewDef/StyleDef/logic +
caps-code grammars safely; one `skillify` orchestrator actor vs a multi-actor
workflow; naming collisions + versioning of minted skills; how the dispatch
router's skill menu scales as skills multiply.

- `2026-07-04` — DESIGN NOTE (Samuel's question, twice): should a vibe's mapper ("function") reference
  the ACTOR (actor.code) instead of being its own vibe_logic row? Settled for now: NO — the mapper is
  the RENDER contract (actor-output → view state), reused across emitters (tool loop + confirm path emit
  the same cards), so it stays part of the vibe bundle; actors reference vibes (actor.vibe), and the DB
  viewer now shows the backlink ("emitted by" chips) + labels the tab "Mapper" honestly. FOR SKILLIFY:
  decide whether GLM authors the mapper as part of the vibe mint (recommended) or actor mint, and
  whether actor.code (behavior sandbox, still 0 users) becomes the default binding for minted actors.

- `2026-07-04` — **Part 1 split out → [[0115]]** (skillify-vibe-mockups, in discover/): the LOOK-only
  slice — a new `skillify` skill with `mockup` (GLM mints/refines vibe view+style+example source behind
  the mock- namespace wall) + `mockups` (no-LLM show/list). This card keeps PART 2: wiring the real data
  layer (reuse/create operations + bundles + vocab) by DELEGATING data authoring to the Ontology skill
  as a sub-skill flow, plus mockup→real-skill promotion.


## Goal (discovered 2026-07-04)

Say **"skillify the banking mockup"** and walk a STEPWISE actor flow — each step ONE
actor with ITS OWN vibe card you can react to (the Planner-mode pattern) — until the
mockup is a real, routable, interactive skill over live predication data.

**Completion condition:** the frontmatter `goal` (command-provable + Samuel's live loop).

## Interviewed decisions (2026-07-04)

1. **Stepwise, actor-per-step** (Samuel): `plan_app → mint_data → wire_actors →
   seed_data → promote`, each an actor row on skillify with its own vibe card (plan
   card · the existing ontology/bundle-created cards · a wiring card · a seeded-rows
   card · the finished app). The skillify skill gets an EXPLICIT flow row with those
   edges — the second orchestration-as-config example after the Planner (0088); the
   graph in the Skills explorer IS the pipeline. Steps are STATELESS across turns —
   keyed by the mockup name, idempotent, re-runnable.
2. **Deterministic skeleton + GLM vocabulary**: `deriveAppSkeleton(source)` maps the
   example-source shape mechanically (top-level arrays → entities + item fields;
   top-level scalars → COMPUTED aggregates — no SUM in the query grammar, so
   aggregation is exactly the sandbox actor's job). GLM's ONLY authoring: field →
   Lojban predicate mapping via the Ontology skill's proven caps (reuse owned_by/
   named/due…, mint missing from the gismu lexicon) — the sub-skill delegation.
3. **Seeding: yes, visible + skippable**: seed_data writes the example rows as real
   predications through the derived create op, shown as a created-rows card.

## Key design consequence

**The identity mapper SURVIVES promotion.** The sandbox code actor (actor.code — the
0111 seat's FIRST real user, caps = ['ops'] only) fetches via the derived + aggregate
ops and shapes its output to EXACTLY the example-source shape — so the mockup's
view/style/mapper promote UNCHANGED (rows copied mock-name → real name). The example
source is the CONTRACT between data and view. Sandbox code is gated by a SMOKE RUN
(runCodeActor with stubbed ops must return the contract shape) before the actor row
is saved — author → validate → seed → render, never raw-trusted.

## Slices

- **S1** deriveAppSkeleton (pure, tested) + the plan_app actor + the `skill-plan` card.
- **S2** mint_data: Ontology delegation (GLM vocabulary seam injectable for tests) →
  predicates + bundle + derived ops, traced as sub-skill runs.
- **S3** wire_actors: the new skill row + a data_crud actor row + the GLM-authored
  sandbox actor.code (smoke-run gate) + the TS registry fail-safe entry.
- **S4** seed_data (skippable) + promote (copy vibe rows, point actor.vibe, done card)
  + the banking e2e (crud add → the code actor reflects it).

**Out of scope:** card-button interactivity on promoted apps ($on → sandbox dispatch),
cross-entity refs between promoted entities (refType reification, e.g. tx→account),
deleting/archiving promoted skills, multi-mockup apps.

## Verification

```bash
bun --env-file=.env.samuel test libs/betterauth/tests/   # incl. the skillify-promotion tests
bun test libs/aven-vibes/tests/
(cd app && bunx svelte-check --tsconfig ./tsconfig.json)
```
Plus Samuel's live loop: skillify the banking mockup → the step cards → add a
transaction → show the overview.

- `2026-07-04` — DISCOVERED (part 2): stepwise actor-per-step with own vibes (Samuel's
  Planner-mode analogy), explicit skillify flow edges, deterministic skeleton +
  GLM-vocabulary-only, visible skippable seeding, the identity-mapper-survives
  contract, the sandbox smoke-run gate. Card promoted ideate → discover.
