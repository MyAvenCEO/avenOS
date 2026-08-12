---
title: Composer-Phasen als echte Events — die Prozess-Schritte werden das Interface
summary: Der monolithische COMPOSE-reduce wird in Phasen-Events zerlegt (PLAN → INTERVIEW → DRAFT → PROBE → STAGE) mit echten State-Commits pro Phase; das Host-Overlay entfällt, jeder Schritt landet als eigener Trace-Eintrag, und die Scrum-Schleife (Re-Draft mit Fehler-Kontext) bekommt ihre natürlichen Andockpunkte
owner: unassigned
created: 2026-08-12
updated: 2026-08-12
tags: [actors, composer, state-machine, scrum]
---

# Composer-Phasen als echte Events — die Prozess-Schritte werden das Interface

## Context

Samuels Frage im 0135-Review: „Sollte der Composer nicht eigentlich die
verschiedenen Methods/Interface-Tools für jeden seiner Progress-Steps haben?"

Die Antwort hat zwei Hälften:

1. **Als TOOLS (voice-callbar): bewusst NEIN.** compose bleibt der eine
   Eingang. Würden plan/draft/probe/stage/promote einzelne Tools, könnte das
   Voice-Modell direkt stagen oder promoten — das Button-only-Gesetz wäre
   gebrochen. Die Schritte sind heute schon im Manifest sichtbar, aber als
   das, was sie sind: **Capabilities** (die 8 fail-closed Host-Türen unter
   „Behaviour & containment") — was der Composer vom Host erbitten DARF,
   nicht was andere von ihm verlangen können.

2. **Als interne EVENTS: JA — das ist die richtige Evolution.** Heute läuft
   die ganze Pipeline in EINEM reduce; der State committet erst am Ende,
   weshalb 0135 den Fortschritt als transientes Host-Overlay erzählt (die
   Sandbox bleibt Owner, aber der Prozess selbst ist keine echte
   State-Machine). Der Ziel-Zustand: PLAN → INTERVIEW → DRAFT → PROBE →
   STAGE als deklarierte Reducer-Events mit echtem Commit pro Phase.

## Idea

- **Continuation-Pump im Host:** ein reduce-Outcome darf `record.next =
  {send, payload}` tragen; der Host (Bus oder Actor-Basis) pumpt das nächste
  Event in die Mailbox. Die Sandbox bleibt je Phase kurzlebig — kein
  minutenlanger suspendierter reduce mehr.
- **Echte Phasen-Commits:** das Fenster rendert idle → interviewing →
  drafting → staged aus ECHTEM State — das 0135-Overlay (Steps/Ticker via
  Caps) wird gelöscht, nur der Token-Ticker bleibt Host-Naht.
- **Jede Phase ein Trace-Eintrag:** der Prozess wird Biography — sichtbar in
  der Trace-Lens, abbrechbar zwischen Phasen (Stop verwirft einfach das
  next-Event statt einen Fetch zu killen).
- **Scrum-Andockpunkt:** eine gescheiterte PROBE-Phase kann als neue
  DRAFT-Runde mit Fehler-Kontext re-entern (state.history ist seit 0135 da)
  — die Scrum-Schleife wird ein Event-Zyklus statt neuer Maschinerie.
- **Resumability:** ein Neustart mitten im Compose verliert nur die aktuelle
  Phase, nicht den ganzen Lauf.

Messbar später via: composer.test.ts prüft echte Zwischen-States (nach PLAN
ist phase='interviewing' OHNE Host-Overlay), Trace trägt einen Eintrag pro
Phase, Stop zwischen Phasen verwirft das next-Event, 0135-Kette bleibt grün.
