---
title: MOCKUP-Step im Composer-Rezept — erst das Gesicht, dann die Logik
summary: Zwischen PLAN und DRAFT kommt ein spezialisierter MOCKUP-Step-Actor, der NUR View + Style + Beispiel-State entwirft (sofort validierbar, sofort als Vorschau renderbar); DRAFT entwirft danach nur noch Methods + Logic GEGEN das Mockup und die Proofs — zwei kleine Completions statt einer monolithischen, was Budget-Truncation strukturell entschärft und dem Menschen einen frühen visuellen Checkpoint gibt
owner: unassigned
created: 2026-08-12
updated: 2026-08-12
tags: [actors, composer, flow, mockup, ui]
---

# MOCKUP-Step im Composer-Rezept — erst das Gesicht, dann die Logik

## Context

Samuels Vorschlag im 0137-Review: „shouldn't after plan first the UI mockup
schleifen, before wiring the full logic at step draft? like a specialized
view/styling ui mockup step/actor in between?"

Zwei Gründe, warum das genau richtig ist:

1. **UX/Prozess:** Menschen denken vom Gesicht her. Ein Mockup nach PLAN ist
   der früheste sinnvolle visuelle Checkpoint — man sieht, WAS entsteht,
   bevor Minuten in Logic-Design fließen. (Optional als eigener Hold:
   „gefällt dir die Richtung?" — siehe Entscheidungen.)
2. **Technisch:** Der Live-Test starb an Budget-Truncation — der
   monolithische DRAFT verlangt id+methods+logic+view+style in EINER
   Completion, und kimis Reasoning teilt sich dasselbe Token-Budget. Zwei
   kleine Completions (Mockup: view/style/sample-state; Logic: methods/
   logic) halbieren die Einzelantworten und damit das Truncation-Risiko
   strukturell — zusätzlich zur 32k-Erhöhung und finish_reason-Erkennung.

Dank 0137 ist das eine REZEPT-Änderung plus ein Step-Actor — kein
Engine-Umbau: `steps: [clarify, scout, plan, mockup, draft, probe, stage]`.

## Idea

- **`mockup`-Step-Actor** (composer-steps.ts): requires `plan(P)`, produces
  `mockup(M)`. Brief: NUR `{view, style, sample}` — eine aven-ui-View, ein
  Style, und ein Beispiel-State (`sample`), der die View mit plausiblen
  Daten füllt. Die Membran-Hälfte läuft sofort im Step:
  validateViewDef/validateStyleDef direkt nach dem Parse — ein invalides
  Mockup re-entert sich selbst (onFail backTo mockup) mit dem exakten
  Validator-Fehler im Brief.
- **Die Step-View IST die Vorschau:** das Mockup-Gesicht rendert die
  entworfene View über dem sample-State — im Flow-Fenster sieht man das
  künftige Actor-Gesicht, bevor eine Zeile Logic existiert. (Mechanik:
  der Step-Actor legt view/style/sample in seinen State; die FlowView
  rendert für den mockup-Step eine zweite AvenUiView mit
  view-Override = state.mockupView über state.sample.)
- **DRAFT schrumpft:** Brief bekommt das Mockup als GEGEBEN — entwirft nur
  noch `{id, description, tags, methods, logic}`; view/style/views kommen
  aus `data.mockup`. draftManifest fügt beide zusammen.
- **PROBE unverändert** (View-Validierung wird dort zum No-op-Doppelcheck,
  Proofs + Sandbox bleiben das Urteil).

## Zu entscheiden im Discover

1. Hold nach dem Mockup (hold:'human': „so ungefähr?" — Feedback fließt in
   den Logic-Brief) oder durchlaufen ohne Halt (schneller, Mockup nur
   sichtbarer Zwischenstand)?
2. Mockup-Feedback-Runde: darf der Mensch per Stimme Änderungen am Mockup
   verlangen (re-enter mockup mit Feedback), oder ist das der
   Scrum-Folge-Slice?
3. Eigenes onFail-Budget für mockup (z. B. 2) vs. geteiltes Budget mit
   draft/probe.

Messbar später via: composer.test.ts — Mockup-Step liefert view/style/sample
vor jedem Logic-Call (Call-Reihenfolge am Fake-LLM), invalides Mockup
re-entert mit Validator-Fehler im Brief, DRAFT-Brief enthält das Mockup und
KEIN view/style im Antwortschema, draftManifest fügt Mockup + Logic-Draft
zusammen, 0137-Kette bleibt grün.

## Progress log

- `2026-08-12` — Ideate aus Samuels Review-Vorschlag; technische Doppel-Begründung (visueller Checkpoint + Truncation-Entschärfung durch kleinere Completions) und die drei Discover-Fragen notiert.
