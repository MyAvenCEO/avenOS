---
title: MOCKUP-Step im Composer-Rezept — erst das Gesicht, dann die Logik, iteriert per Stimme
summary: Zwischen PLAN und DRAFT entwirft ein spezialisierter MOCKUP-Step-Actor NUR View + Style + Beispiel-State; die FlowView rendert das entworfene Gesicht LIVE über dem Sample als echte Vorschau, der Flow hält, und der Mensch iteriert per Stimme („mach den Titel größer") — jede Antwort re-entert den Mockup-Step mit dem Feedback, bis eine klare Zustimmung kommt; DRAFT entwirft danach nur noch Methods + Logic gegen Mockup und Proofs (zwei kleine Completions statt einer monolithischen = Truncation strukturell entschärft)
owner: Claude Code (build agent)
created: 2026-08-12
updated: 2026-08-12
tags: [actors, composer, flow, mockup, ui]
goal: "`cd app && bun test tests/composer.test.ts && bun test tests/flow.test.ts` exits 0 — proving with a FAKED llm lane: (1) MOCKUP BEFORE LOGIC: after PLAN the mockup step designs ONLY {view, style, sample} (call order asserted: the mockup brief runs before any logic-design call, and the design brief's answer schema no longer contains view/style); (2) FACE PREVIEW: the mockup step's state carries face/faceStyle/sample so the flow window renders the drafted view over the sample state as a live preview; (3) VOICE ITERATION ON THE FACE: the flow HOLDS at the mockup (hold:'human' with resume:'self'); a compose_answer with change feedback re-enters the MOCKUP step with the feedback and the previous mockup in its input, producing a NEW face and holding again; a clear approval answer makes the mockup step return {approved:true} and the chain continues — asserted over a three-call mockup sequence (first face → changed face → approved); (4) INVALID FACES NEVER HOLD: a mockup failing validateViewDef/validateStyleDef re-enters itself via onFail with the exact validator error riding in the retry brief (shared failure budget); (5) THE STAGED ACTOR WEARS THE MOCKUP: probe and stage merge the approved mockup's view/style into the logic draft — the staged instance's manifest carries the mockup view and its windows derive from it; (6) hold answers are keyed per step (clarify_answer vs mockup_answer) so later steps still see the clarify context; AND the full suite plus `bun run check` (0 errors) stay green"
---

# MOCKUP-Step im Composer-Rezept — erst das Gesicht, dann die Logik, iteriert per Stimme

## Context

Samuels Vorschlag im 0137-Review, plus die Iterations-Klärung: „we want to
be able to iterate on the mockup using face". Doppelte Begründung:

1. **UX/Prozess:** Menschen denken vom Gesicht her. Das Mockup nach PLAN
   ist der früheste visuelle Checkpoint — und mit der Stimme-Schleife wird
   er zum Gestaltungs-Dialog: sehen, ändern lassen, wieder sehen, freigeben.
2. **Technisch:** Der Live-Test starb an Budget-Truncation — der
   monolithische DRAFT verlangt alles in EINER Completion, und kimis
   Reasoning teilt sich dasselbe Token-Budget. Zwei kleine Completions
   (Gesicht, dann Logik) halbieren die Einzelantworten.

**Entschieden (Samuel, 2026-08-12):** (a) hold:'human' nach dem Mockup;
(b) ITERATIVE Feedback-Schleife per Stimme am gerenderten Gesicht — die
Zustimmung erkennt der Mockup-Step selbst ({approved:true}); (c) geteiltes
onFail-Budget mit draft/probe.

## Approach

- **`flow-recipe.ts`:** RecipeStep bekommt `resume?: 'self' | 'next'`
  (Default 'next') — wohin ANSWER nach einem human-Hold zurückkehrt.
- **`flow.actor.ts`:** ANSWER speichert das Feedback pro Step
  (`data[<holdActor>_answer]`), bei resume:'self' re-entert der Hold-Step;
  Hold-said kommt aus `out.say` (Mockup: „Das Gesicht steht — sag, was
  anders soll, oder sag passt."), Titel-Zweig für phase 'mockup'.
- **`draft-pipeline.ts`:** `validateFace(view, style)` als leichter
  Membran-Ausschnitt (von probeDraft wiederverwendet).
- **`composer-steps.ts`:** neuer `mockup`-Step (requires plan(P), produces
  mockup(M); Caps complete + validate): Brief liefert {approved:true} ODER
  {view, style, sample}; Validator-Fehler → ok:false (onFail re-entert mit
  Fehler im Brief); valide → State face/faceStyle/sample + hold. DRAFT-Brief
  schrumpft (kein view/style im Schema, Mockup als GEGEBEN im Input);
  scout/plan/draft lesen `clarify_answer`; probe & stage mergen das Mockup
  in den Logic-Draft.
- **`composer.actor.ts`:** Rezept-Zeile mockup{hold:'human', resume:'self',
  onFail backTo mockup, maxRuns 3} zwischen plan und draft; draft requires
  +mockup(M).
- **`FlowView.svelte`:** rendert für einen Step mit face im State eine
  zweite AvenUiView (view-Override = face, State = sample) — die LIVE-Vorschau.
- **`chat.svelte.ts`:** Prompt: der Composer darf MEHRFACH halten (Fragen,
  Mockup-Feedback) — jede Nutzer-Antwort geht wörtlich als compose_answer.

## Verification

```bash
cd app && bun test tests/composer.test.ts && bun test tests/flow.test.ts
```

```bash
cd app && bun test && bun run check
```

## Progress log

- `2026-08-14` — **REJECTED im Review (Samuel):** Komplexität zu hoch — der Composer samt Step-Actors und Flow-Engine (Rezepte, Pump, FlowView) wurde vollständig zurückgebaut (Commit c1c5b2f1). Das Wissen bleibt in der Git-History; erhalten blieben die unabhängig wertvollen Härtungen (Degenerations-Guard, Rate-Limit-Backoff, Stall-Watchdog, Token-Budgets, Trace-Notes, LLM-Exchange-Log, Actor.dispose, Work-Signal/Stop, Views-Scroll) sowie der Negotiator auf der verschlankten draft-pipeline.
- `2026-08-12` — GEBAUT, alle 6 Goal-Klauseln grün (28 Flow+Composer-Tests, App-Suite 102/102, Check 0, live verifiziert: Rezept = clarify(human) → scout → plan → mockup(human/self) → draft → probe → stage(button)): RecipeStep.resume ('self' re-entert den Hold-Step mit dem Feedback — die Stimme-Iteration am Gesicht); ANSWER keyed pro Step (clarify_answer/mockup_answer — spätere Steps behalten den Clarify-Kontext); validateFace als eigenständige Membran-Hälfte; mockup-Step-Actor (Brief: approved|view/style/sample, Validator-Fehler re-entern via onFail mit exaktem Fehler im Brief, Zustimmung erkennt der Step selbst); DESIGN_BRIEF verschlankt (NO view/NO style — das Gesicht ist GEGEBEN, State-Shape muss dem sample matchen); probe & stage tragen das Mockup in den Logic-Draft; FlowView rendert die entworfene View LIVE über dem sample (Face-Preview, remounted bei Gesichts-Änderung); Prompt: der Composer hält MEHRFACH, jede Antwort geht als compose_answer. Beweise: Feedback-Iteration über 3-Mockup-Sequenz (Feedback + previous im Brief, Gesicht ändert sich auf der Bühne, Logik gegen das GEÄNDERTE Gesicht), invalides Gesicht hält nie (Ternary-Fehler im Retry-Brief), Staged trägt das Mockup-Gesicht.
- `2026-08-12` — Discover: Samuels Entscheidungen (Hold ja, iterative Stimme-Schleife am gerenderten Gesicht, geteiltes Budget) + resume:'self'-Mechanik und Antwort-Keying pro Step spezifiziert; messbares Goal geschrieben. Direkt weiter in build.
- `2026-08-12` — Ideate aus Samuels Review-Vorschlag (visueller Checkpoint + Truncation-Entschärfung).
