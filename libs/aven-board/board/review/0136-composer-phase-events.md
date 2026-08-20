---
title: Composer-Phasen als echte Events — Mensch-Interview, Reuse-Prüfung, Scrum-Schleife
summary: Der monolithische COMPOSE-reduce wird eine echte State-Machine (CLARIFY → SCOUT → PLAN → DRAFT → PROBE → STAGE) mit Commit pro Phase; CLARIFY befragt den MENSCHEN (HITL-Rückfragen zu Features, wartend — im Monolith unmöglich), SCOUT prüft Reuse (bestehende Actors/Instanzen) vor Negotiate vor Compose, und eine gescheiterte PROBE re-entert als neue DRAFT-Runde mit Fehler-Kontext (Scrum) statt Single-Shot-Tod
owner: Claude Code (build agent)
created: 2026-08-12
updated: 2026-08-12
tags: [actors, composer, state-machine, scrum, hitl]
goal: "`cd app && bun test tests/composer.test.ts` exits 0 — proving with a FAKED llm actor: (1) CLARIFY holds: a vague wish returns clarify questions in state (phase 'clarifying', NO next), nothing else runs; a compose_answer resumes the chain to 'staged' in one dispatch; a precise wish (empty questions) chains straight through; (2) PHASES ARE REAL: after the run the bus trace carries one 'pump'-sourced entry per phase (SCOUT/PLAN/DRAFT/PROBE/STAGE) and the intermediate commits are actual state (no host overlay — the overlay seam is deleted, only the token ticker remains host-written); (3) SCOUT verdict ladder: 'reuse' spawns the instance DIRECTLY via the spawn cap and ends with record.reused (no draft); 'negotiate' ends advising the negotiator (no draft); 'compose' proceeds to PLAN; (4) SCRUM: a draft failing the membrane re-enters DRAFT with the exact error quoted in the next design brief (asserted on the fake llm's received question), round 2 stages; three failed rounds = structured failed state with 3 history entries; (5) STOP: an aborted pump signal halts the chain between phases — no staging; (6) stepper: state.phaseRows carries CLARIFY·SCOUT·PLAN·DRAFT·PROBE·STAGE with ✓/◐/○/✕ marks and the DRAFT round counter; (7) promote stays button-only and the full suite plus `bun run check` stay green"
---

# Composer-Phasen als echte Events — Mensch-Interview, Reuse-Prüfung, Scrum-Schleife

## Context

Zwei Befunde aus Samuels 0135-Live-Review (2026-08-12):

1. **„Interview" heißt ZUERST der Mensch.** Samuels Klärung: das Interview
   soll erst herausfinden, wie die App GENAU funktionieren soll — Features,
   Grenzen — als HITL-Rückfragen an den Menschen (die Discover-Philosophie,
   vom Composer am Menschen ausgeführt). DANACH erst die Mesh: können
   bestehende Actors das schon (Reuse — ggf. reicht eine Instanz)? Muss
   verhandelt werden (Negotiator-Bridge)? Nur was fehlt, wird komponiert.
   **Im heutigen Monolith-reduce ist Stufe 1 unmöglich** — ein reduce kann
   nicht anhalten und auf menschliche Antworten warten. Eine State-Machine
   kann: die CLARIFY-Phase hält, zeigt die Fragen im Fenster, die nächste
   Antwort treibt sie weiter.
2. **Single-Shot verbrennt echte Läufe.** Der Habit-Tracker-Lauf war fast
   perfekt (3 saubere Proofs, 2 exzellente Mesh-Interviews: workitem „kein
   recurrence-Attribut", metric „kann keine Streaks") — und starb nach ~2
   Minuten Kimi-Arbeit an `expecting ';'` (Syntaxfehler in der generierten
   Logic, mutmaßlich abgeschnittene Antwort). Die Membran hielt korrekt,
   aber der ganze Lauf war verloren. Die Scrum-Schleife — Re-Draft mit exakt
   diesem Fehler als Kontext, `state.history` existiert seit 0135 — hätte
   das mit einer Runde geheilt.

Dazu Samuels Interface-Frage: Steps als voice-callbare TOOLS = nein
(Button-only-Gesetz; die Schritte sind als Capabilities sichtbar). Steps als
interne EVENTS mit echten Commits = ja, genau diese Karte.

## Idea — die Phasen

**CLARIFY (neu — der Mensch zuerst).** Aus dem Wunsch entstehen 1–3
konkrete Feature-Rückfragen an den MENSCHEN (kimi-Lane), im Composer-Fenster
als Fragekarten. Die Machine HÄLT. Antworten kommen per Stimme/Chat
(compose_answer-Tool oder Folge-Utterance) und committen die Phase.
Skip-Regel: ist der Wunsch schon präzise, überspringt CLARIFY sich selbst.

**SCOUT (neu — Reuse vor Negotiate vor Compose).** Mesh-Interviews wie
heute (caller-aware ask), aber mit expliziter Verdikt-Leiter: (a) ein
bestehender Actor/eine Instanz DECKT den Wunsch → Vorschlag statt Neubau
(spawn/Config), (b) Vokabular-Lücke zwischen Bestehenden → an den Negotiator
verweisen, (c) wirklich neu → weiter zu PLAN. Das Verdikt steht im Fenster.

**PLAN.** Proofs first wie in 0135 — jetzt als eigene Phase mit eigenem
Commit (die Proofs erscheinen als echter State, nicht als Overlay).

**DRAFT → PROBE (Scrum-Zyklus).** Kimi entwirft gegen Proofs + Interviews +
Clarify-Antworten. Scheitert die PROBE, re-entert DRAFT mit dem exakten
Membran-Fehler + dem letzten Draft als Kontext — max. N Runden (2–3), dann
strukturierter failed-State wie heute. `state.history` trägt jede Runde.

**STAGE.** Wie 0135: echte Instanz, Tag staging, Promote/Discard button-only.

## Die Composer-View: ein Phasen-Stepper (Samuels Nachtrag)

Das Fenster bekommt eine klare Pro-Schritt-Fluss-UI über allem: ein
**Stepper** (CLARIFY · SCOUT · PLAN · DRAFT · PROBE · STAGE) als
Fortschritts-Leiste — jeder Schritt ein Chip mit Zustand (✓ erledigt,
◐ aktiv, ○ ausstehend, ✕ gescheitert), die Scrum-Runden als Zähler am
DRAFT-Chip (z. B. „Draft ②"). Darunter rendert IMMER der Inhalt der aktiven
Phase (Fragekarten in CLARIFY, Verdikt in SCOUT, Proof-Karten in PLAN,
Ticker in DRAFT, Fehler in PROBE, Draft-Karte + Buttons in STAGE);
erledigte Schritte sind antippbar und zeigen ihren committeten Inhalt —
möglich, WEIL jede Phase ein echter State-Commit ist. Datengetrieben ohne
Conditionals: der Stepper ist ein $each über `state.phaseRows`, der
Inhaltsbereich rendert leere Arrays der Nicht-Phasen zu nichts (das
bewährte Muster).

## Mechanik

- **Continuation-Pump:** ein reduce-Outcome darf `record.next = {send,
  payload}` tragen; der Host pumpt das nächste Event in die Mailbox. Kein
  minutenlang suspendierter reduce mehr; Stop verwirft schlicht das
  next-Event. CLARIFY trägt KEIN next — sie wartet auf den Menschen.
- **Echte Phasen-Commits:** das Fenster rendert aus echtem State; das
  0135-Host-Overlay (Steps/Ticker via Caps) wird gelöscht — nur der
  Token-Ticker bleibt Host-Naht.
- **Jede Phase ein Trace-Eintrag** — der Prozess wird Biography; Neustart
  verliert nur die aktuelle Phase.

Messbar später via: composer.test.ts — (1) CLARIFY hält (kein next, Fragen
im State), eine Antwort committet weiter; (2) SCOUT-Verdikt reuse/negotiate/
compose je nach Mesh-Lage; (3) DRAFT-PROBE-Schleife: erster Draft mit
Syntaxfehler, zweiter (mit Fehler-Kontext im Brief, per Test belegt) staged;
(4) Zwischen-States sind ECHT (kein Overlay), `state.phaseRows` trägt den
Stepper mit ✓/◐/○/✕ und Scrum-Rundenzähler; (5) Stop zwischen Phasen
verwirft das next-Event; (6) 0135-Kette bleibt grün.

## Entschieden (Samuel, 2026-08-12)

1. **CLARIFY-Antworten kommen voice-natürlich**: der Mensch antwortet per
   Folge-Äußerung, das Chat-Modell routet sie als `compose_answer`-Tool.
   EINE Clarify-Runde (die Fragen kommen gebündelt, eine Antwort darf alle
   adressieren), dann läuft die Kette weiter.
2. **Scrum-Deckel = 3 Draft-Versuche**, dann strukturierter failed-State.
3. **SCOUT-Reuse darf DIREKT spawnen** — kein Rückfrage-Gate; das Verdikt
   samt Begründung steht im Record und im Fenster.

## Files to touch

- `app/src/lib/actors/bus.ts` — Continuation-Pump in send(): ein Record mit
  `next: {send, payload}` treibt denselben Actor weiter, jeder Hop ein
  Trace-Eintrag (from 'pump'); `pumpSignal`-Seam — abgebrochen = Kette hält.
- `app/src/lib/actors/composer.actor.ts` — Logic als State-Machine
  (COMPOSE→CLARIFY-Hold, ANSWER, SCOUT, PLAN, DRAFT{round}, PROBE, STAGE);
  CLARIFY-/SCOUT-Briefs; spawn-Cap; Overlay-Seam gelöscht (nur Ticker);
  Stepper (`phaseRows`) + Phasen-Inhalte in present(); compose_answer-Entry.
- `app/src/lib/actors/chat.actor.svelte.ts` — pumpSignal-Wiring,
  chat.svelte.ts-Prompt (compose_answer erwähnen).
- `app/tests/composer.test.ts` — umgeschrieben auf die Phasen-Beweise.

Out of scope (Folge-Slices): antippbare erledigte Stepper-Schritte,
Mehr-Runden-Clarify, SCOUT-Verdikt nach Interview-Antworten verfeinern.

## Progress log

- `2026-08-14` — **REJECTED im Review (Samuel):** Komplexität zu hoch — der Composer samt Step-Actors und Flow-Engine (Rezepte, Pump, FlowView) wurde vollständig zurückgebaut (Commit c1c5b2f1). Das Wissen bleibt in der Git-History; erhalten blieben die unabhängig wertvollen Härtungen (Degenerations-Guard, Rate-Limit-Backoff, Stall-Watchdog, Token-Budgets, Trace-Notes, LLM-Exchange-Log, Actor.dispose, Work-Signal/Stop, Views-Scroll) sowie der Negotiator auf der verschlankten draft-pipeline.
- `2026-08-12` — HITL-Befund Samuel (2. Lauf, CLARIFY+SCOUT liefen live perfekt) + Fix: PLAN starb nach 163s als ✕ in der Trace-Lens — Ursache: **Barge-in und Stop-Button teilten sich das Abort-Signal**; `interrupted` (feuert bei jeder Spracherkennung) rief core.stop() und killte damit den Kimi-Fetch der laufenden Phase. Fix: eigenes WORK-Signal (workController in chat.actor.svelte.ts) — Composer/Negotiator-Fetches + Pump hängen daran, abortiert wird es NUR vom Stop-Button (stopWork() neben chat.stop()); Barge-in stoppt weiter nur die Antwort. Dazu Observability (Samuels „wie sehen wir unter die Haube?"): (1) Lane-Fehler reisen als DATEN durch die Membran — der complete-Cap gibt bei ok:false `{lane_error}` zurück, die Sandbox behält die echte Ursache im history-Excerpt (Test: „boom upstream (504)" steht im Fenster); (2) PLAN-Fehler behalten die Roh-Antwort als Excerpt (war leer); (3) die failed-Note lügt nicht mehr („died before drafting" statt „three rounds were spent" bei failedAt<3); (4) der LLM-Actor führt ein Exchange-Log (letzte 12 Calls mit Modell/ms/ok/Antwort-Excerpt) in instanceState — sichtbar in der Instances-Lens. 17 Composer-Tests, Suite 87/87, Check 0.
- `2026-08-12` — GEBAUT, alle Goal-Klauseln grün (16 Composer-Tests, Suite 86/86 aus app/, Check 0): Continuation-Pump in bus.send() (record.next treibt denselben Actor, jeder Hop ein Trace-Eintrag from 'pump', pumpSignal hält bei Abort); Composer-Logic komplett als State-Machine neu (COMPOSE→CLARIFY-Hold mit Fragen im State und said, ANSWER resumed, SCOUT-Verdikt-Leiter mit direktem spawn-Cap für Reuse und Negotiator-Verweis, PLAN nur Proofs, DRAFT{round} mit retry:{error,previous} im Brief, PROBE→Scrum-Re-Entry, 3-Runden-Deckel, STAGE final); Stepper (phaseRows ✓/◐/○/✕, Draft-Rundenzähler) + Fragen-/Verdikt-Karten in der View; 0135-Host-Overlay gelöscht — einzig verbliebene Host-Naht ist der Token-Ticker (state.ticker); compose_answer-Tool + Prompt-Update + bus.pumpSignal=turnSignal-Wiring; im Dev-Preview live verifiziert (Stepper rendert, Tools da). Vorbestehend & unberührt: 2 Root-bun-test-Fails aus ARCHIVE/aven-mail (fehlendes smtp-server-Paket).
- `2026-08-12` — Discover abgeschlossen: Samuels 3 Entscheidungen (voice-natürliche Antworten via compose_answer, 3 Scrum-Runden, Reuse spawnt direkt) eingearbeitet, messbares Goal + Files to touch geschrieben, Karte → discover/. Hand-off: /aven-build 0136.
- `2026-08-12` — Umgeschrieben nach Samuels Review-Befunden: CLARIFY-Phase (Mensch-Interview als HITL-Rückfragen — braucht die State-Machine zwingend), SCOUT mit Reuse-vor-Negotiate-vor-Compose-Verdikt, DRAFT↔PROBE als Scrum-Zyklus (der Habit-Tracker-Lauf starb Single-Shot an `expecting ';'` nach 2 Minuten Kimi-Arbeit — genau der Fall, den die Schleife heilt).
- `2026-08-12` — Erstfassung: Phasen-Events als Antwort auf die Interface-Frage (Steps als Events, nicht als Tools).
