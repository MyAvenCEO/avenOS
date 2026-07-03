---
title: "Skillify — the skill that mints complete skills, end to end"
summary: A new "skillify" skill orchestrates the whole minting flow from one human wish — it DELEGATES all data authoring (vocab, bundles, operation specs) to the universal Ontology skill as sub-skill calls, authors the UI/behavior artifacts itself (vibe view/style/logic, actor code), registers the skill + actor rows, and HITL-confirms — a working mini-app as pure DB config, zero deployed code.
owner: claude
created: 2026-07-03
updated: 2026-07-03
tags: [betterauth, skills, glm, north-star]
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
