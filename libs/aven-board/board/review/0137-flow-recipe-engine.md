---
title: Der Rezept-Flow-Engine — Steps sind Actors, Rezepte sind geprüfte Ketten
summary: Ein generischer, JSON-konfigurierbarer Flow-Engine als Wiederkehr des 0083-Rezepts, diesmal AUS den Primitiven gebaut — jeder Step ein voller Actor (Manifest+Logic+View, Prolog-Contracts als IO), das Rezept code-owned und vom Prover statisch validiert, die Kette läuft über die Continuation-Pump, Holds (Mensch/Button) sind first-class; die generische Flow-UI rendert Stepper + die EIGENE View des aktiven Steps live (inkl. Modell-Stream) und macht erledigte Steps antippbar; Slice 1 = der Composer als erstes Rezept aus 6 Step-Actors, die handgebaute State-Machine wird gelöscht
owner: Claude Code (build agent)
created: 2026-08-12
updated: 2026-08-12
tags: [actors, flow, recipe, composer, engine]
goal: "`cd app && bun test tests/flow.test.ts && bun test tests/composer.test.ts` exits 0 — proving with a FAKED llm lane: (1) RECIPE AS DATA: a recipe is a plain JSON value (id, steps: [{actor, hold?, label}]) declared in code; the generic FlowActor runs ANY recipe over registered step actors via the continuation pump — no recipe-specific host code; (2) PROVER-VALIDATED: validateRecipe(bus, recipe) statically rejects a recipe whose step requires nothing in the mesh (prior step produces + declared flow inputs) can prove, with the failing step and predicate named — an invalid recipe never runs; (3) STEPS ARE FULL ACTORS: each composer phase (clarify, scout, plan, draft, probe, stage) is its OWN registered actor with manifest, sandboxed logic, Prolog contracts and its OWN view; each step's OUTPUT record feeds the next step's input (keyed by functor), and a step actor is independently dispatchable in isolation (test drives 'plan' alone); (4) HOLDS ARE FIRST-CLASS: a step declared hold:'human' stops the pump and resumes on flow_answer; a step declared hold:'button' (stage) stops for PROMOTE/DISCARD which remain view-events only (no tools); (5) THE COMPOSER IS RECIPE #1: compose runs the composer recipe end-to-end (vague wish → clarify hold → answer → scout reuse/negotiate/compose ladder → plan proofs → draft⇄probe scrum with 3-round cap and the membrane error re-entering the brief → staged live instance), the hand-rolled phase state-machine in composer.actor.ts is DELETED, and every 0136 behaviour test still passes against the recipe; (6) FLOW-UI STATE: the flow state carries stepRows (mark ✓/◐/○/✕ + label + round counter) AND the active step's actor uuid so the generic flow window renders the ACTIVE STEP'S OWN VIEW inline (live model stream included via the step's state) and a tapped done step renders ITS committed view — asserted on state shape; AND `cd app && bun test` plus `bun run check` (0 errors) stay green"
---

# Der Rezept-Flow-Engine — Steps sind Actors, Rezepte sind geprüfte Ketten

## Context

**Die Geschichte:** Board 0083 hat den alten universellen Flow/Recipe-Engine
bewusst ins Actor-Modell aufgelöst — „compression, not abstraction: ein
gespeichertes Flow-Template friert ein Urteil ein". Seitdem werden
Ziel-Flows ABGELEITET (requires/produces + SLD-Prover). Samuels Vorschlag
(2026-08-12) holt das Rezept zurück — aber diesmal gebaut AUS den
Primitiven, die es damals nicht gab, und deshalb ohne den alten Sündenfall:

- **Ein Step IST ein Actor** — uuid, Manifest, Sandbox-Logic, eigene View.
- **Step-IO SIND Prolog-Contracts** — requires/produces; „multiple inputs →
  Transformation → multiple outputs" ist, was ein Actor heute deklariert.
- **Die Kette IST die Continuation-Pump** (0136).
- **Das Rezept ist code-owned JSON** und der **Prover validiert es
  statisch** — es friert kein Urteil ein, weil es bei jeder
  Registry-Änderung neu beweisbar sein muss.
- **Holds sind first-class**: Mensch (CLARIFY) und Button (STAGE) — die
  zwei Hold-Arten, die der Composer schon lebt.

**Der UX-Beweis aus dem Live-Test:** 8,5k Tokens PLAN hinter einem nackten
Zähler — „super bad UX". Der Quick-Fix (Live-Stream-Tail im Fenster) ist
drin; STRUKTURELL gelöst wird es hier: jeder Step ist ein Actor mit
eigenem Gesicht, also zeigt die Flow-UI immer die echte Arbeit des aktiven
Steps — und erledigte Steps behalten ihren committeten State und ihre View.

**Entschieden (Samuel, 2026-08-12):**

1. **Slice 1 = der Composer als erstes Rezept** — CLARIFY/SCOUT/PLAN/
   DRAFT/PROBE/STAGE werden 6 echte Step-Actors, der Composer wird
   generischer Flow-Orchestrator, die handgebaute State-Machine wird
   gelöscht (net-subtraktiv im Composer).
2. **Volle Step-Actors** — jeder Step: Manifest + Sandbox-Logic + eigene
   View, im Katalog, einzeln testbar, in anderen Rezepten wiederverwendbar
   („perfect shared primitives as actors").
3. **Prolog-Contracts als Step-IO** — ein Vokabular für alles; der Prover
   validiert das Rezept statisch.
4. **Erledigte Steps antippbar mit eigener View** — Stepper oben, aktiver
   Step rendert voll, angetippte erledigte Steps zeigen ihre EIGENE View
   mit committetem State.

## Approach

- **`flow-recipe.ts` (neu):** `Recipe`-Typ ({id, name, inputs: Predicate[],
  steps: [{actor: templateId, label, hold?: 'human'|'button'}]}),
  `validateRecipe(bus, recipe)` — läuft den Prover je Step über
  (Vorgänger-produces ∪ Flow-Inputs) und benennt den ersten unbeweisbaren
  Step+Prädikat.
- **`flow.actor.ts` (neu, generisch):** EIN FlowActor pro Rezept-Lauf:
  START {inputs} → pumpt Step um Step (jeder Hop dispatcht den
  Step-Actor mit den akkumulierten Outputs, keyed by functor), committet
  `stepRows`/`activeStep` (uuid) in seinen State, hält bei hold-Steps
  (human → flow_answer resumed; button → View-Events), trägt den
  Scrum-Zyklus als deklarierten Rücksprung (draft⇄probe, max 3).
- **6 Step-Actors (neu):** `steps/clarify.ts`, `scout.ts`, `plan.ts`,
  `draft.ts`, `probe.ts`, `stage.ts` — Logic/Briefs/Views aus dem heutigen
  COMPOSER_LOGIC herausgeschnitten; Caps bleiben die draft-pipeline.
- **Composer = Rezept + dünne Hülle:** compose/compose_answer bleiben die
  Tools; die Fenster-/HUD-/Prompt-Verdrahtung bleibt; die Phasen-Logic im
  Composer wird GELÖSCHT.
- **Flow-UI:** das generische Flow-Fenster rendert Stepper (antippbar) +
  die View des aktiven bzw. angetippten Step-Actors (AvenUiView über dessen
  State — Live-Stream inklusive, der Tail-Seam wandert in den Step).

## Out of scope (Folgekarten)

Rezepte zur Laufzeit minten (der Composer, der Rezepte komponiert — meta),
parallele Step-Zweige, Mehrfach-Instanzen desselben Flows gleichzeitig,
Negotiator-Migration aufs Rezept.

## Verification

```bash
cd app && bun test tests/flow.test.ts && bun test tests/composer.test.ts
```

```bash
cd app && bun test && bun run check
```

## Hand-off

```
/aven-build 0137
```

## Progress log

- `2026-08-12` — ROOT CAUSE des Gibberish (Samuel: „doublecheck your LLM roundtrip"): der Proxy schickte die Voice-Lane-Versicherungen an ALLE Modelle — `frequency_penalty: 0.3` bestraft im JSON-Grammatik-Zwang genau die Tokens, die eine lange strukturierte Antwort wiederholen MUSS (Quotes/Braces/Feldnamen) → das Modell flieht in endlose, nie repetierende snake_case-Wortschlangen (deshalb griff der Repetitions-Detektor nicht); `enable_thinking:false` (Qwen-Template-Kwarg) nahm kimi-k3 zusätzlich das Reasoning. Beide gelten jetzt NUR für die Qwen-Voice-Lane. Dazu: zweiter Degenerations-Detektor (240+ Zeichen ohne Whitespace/JSON-Interpunktion = Wortsalat), Rate-Limit-Backoff 15s/30s an der Lane (der sofortige Resample rannte in dieselbe 429-Wand), ehrliche Stepper-Rundenzähler (nur der re-enterte Step trägt den gedeckelten Zähler), Scout-Interview-Phase tickt live über den Seam, FlowView mit JSON-Disclosure pro Step + Clarify als nummerierter Fragebogen. Suite 98/98, Check 0.
- `2026-08-12` — HITL-Befund Samuel (Live-Stream zeigte Kimi in einer Repetitionsschleife: stop_stop_stop…, 16k-Token-Burn bis zur Membran) + Fix: `looksDegenerate()`-Guard an der Lane (≥12-Zeichen-Einheit 7+ mal im Tail von Antwort UND Reasoning → Stream-Abbruch nach ~1KB-Checks, strukturierter Lane-Fehler) und PLAN bekommt im Rezept eine onFail-Resample-Runde auf sich selbst (Degeneration heilt meist per Resample; geteiltes Fehler-Budget mit dem Scrum-Zyklus). 3 neue Detektor-Tests, Suite 97/97, Check 0.
- `2026-08-12` — GEBAUT, alle 6 Goal-Klauseln grün (24 Flow+Composer-Tests, Suite 94/94 aus app/, Check 0, live im Preview verifiziert): `flow-recipe.ts` (Recipe-Typ + validateRecipe — Prover je Step über Vorgänger-produces ∪ Flow-Inputs, benennt Step+Prädikat); `composer-steps.ts` (6 volle Step-Actors mit Manifest/Sandbox-Logic/Contracts/eigener View, Briefs extrahiert, gemeinsamer kimi-complete-Cap mit Live-Stream-Tail im Step-State, `internal`-Flag hält _run-Entries aus den Voice-Tools); `flow.actor.ts` (EIN generisches FLOW_LOGIC, Rezept via source, Holds human/button, onFail-Scrum mit tries-Deckel, stepRows/activeStep/history als echter State); Composer = COMPOSER_RECIPE + dünne Manifest-Hülle, die 0136-State-Machine GELÖSCHT; FlowView.svelte (antippbarer Stepper + die EIGENE View des aktiven/angetippten Step-Actors + Terminal-Chrome). ARCHITEKTUR-FUND unterwegs: das asyncified QuickJS-Modul erlaubt nur EINE suspendierte VM — der Flow ruft Steps deshalb NICHT aus der Sandbox (cap), sondern per `call:{method,payload,resume}`-Direktive an die Pump: der Host dispatcht zwischen den Reduces (Actor ruft Actor ohne verschachtelte Suspension — neues universelles Pump-Primitiv). Dazu WASM-Hygiene: Actor.dispose() gibt die Runtime frei (unregister/discard/Probe-Scratch/Test-afterEach). Abweichung von Files-to-touch: die 6 Steps leben in EINEM Modul composer-steps.ts statt steps/*.ts (weniger Boilerplate, gleiche Wiederverwendbarkeit).
- `2026-08-12` — Discover mit Samuel: alle vier Empfehlungen angenommen (Composer als Rezept #1, volle Step-Actors, Prolog-Contracts als IO, antippbare Step-Views). Kontext: 0083-Kreis schließt sich — das Rezept kehrt zurück, diesmal AUS den Primitiven (Actors, Contracts, Prover, Pump) und statisch beweisbar statt eingefroren. UX-Anlass: 8,5k blinde PLAN-Tokens; Quick-Fix (Live-Stream-Tail) separat gelandet, strukturelle Lösung ist die Step-eigene View. Karte direkt startklar in discover/.
