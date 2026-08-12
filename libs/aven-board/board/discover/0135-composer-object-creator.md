---
title: Composer — der ObjectCreator: Wunsch → Actor, staged wie next/production
summary: Composer und Negotiator bleiben ZWEI Actors (wie abjects ObjectCreator/Negotiator) über EINER geteilten Draft-Pipeline (Membran → Staging → Promote/Export); die Kimi-k3-Lane entwirft komplette Actors (Manifest+Logic+Views+Style), der Draft läuft als LIVE-Staging-Instanz („next"), Promote (button-only) macht ihn production + Code-Export
owner: Claude Code (build agent)
created: 2026-08-12
updated: 2026-08-12
tags: [actors, composer, object-creator, staging, sandbox]
goal: "`cd app && bun test tests/composer.test.ts` exits 0 — proving with a FAKED llm actor: (1) INTERVIEW: compose(wish) asks the mesh caller-aware (asker='composer'), quotes a house exemplar (workitem manifest) into the design brief, and the model call carries settings.model='moonshotai/kimi-k3'; (2) MEMBRANE: the draft passes validateViewDef/validateStyleDef AND a sandbox probe (logic evaluates, initState returns an object, a smoke reduce runs) BEFORE anything is staged — an invalid draft is a structured failure with the exact error, nothing enters the mesh (single-shot, no auto-retry); (3) STAGING: a valid draft is spawned as a LIVE staging instance (tagged staging, windows derivable, usable via dispatch) while the composer still holds it pending; (4) PROMOTE is button-only (no promote/discard tool in toolSpecs): the PROMOTE event drops the staging tag and returns a catalog-ready TS export, DISCARD disposes the staged instance and its windows; (5) SHARED PIPELINE: the negotiator is REWIRED onto the same shared draft-pipeline module (membrane → stage → promote/export) while remaining its own actor, and the 0131 bridge chain (metric → proxy → miles) still proves end-to-end; AND `cd app && bun test` plus `bun run check` (0 errors) stay green"
---

# Composer — der ObjectCreator: Wunsch → Actor, staged wie next/production

## Context

Abjects ObjectCreator-These: „ObjectCreator interviews existing Abjects, learns
their protocols through the Ask Protocol, and generates living collaborators.
The tool teaches the creator how to use it." Der alte avenOS-Composer wurde
gelöscht, weil er UNGATED in localStorage generierte. Der Negotiator (0131) hat
inzwischen genau die fehlende Maschinerie bewiesen: Interview per caller-aware
ask() → Draft hinter der Membran → HITL-Gate (button-only) → Session +
Code-Export. Dieser Karte generalisiert sie.

**Entschieden im Discover-Interview (Samuel, 2026-08-12):**

1. **ZWEI Actors, EINE Pipeline** (Korrektur Samuel, final): Composer und
   Negotiator bleiben getrennte Actors — exakt abjects Aufteilung
   (ObjectCreator und Negotiator sind dort eigenständige System-Abjects mit
   eigenen Rollen und eigenen Gesichtern). Geteilt wird die MASCHINERIE als
   Host-Modul `draft-pipeline.ts`: Membran-Probe, Staging-Spawn,
   Promote/Export, Discard — beide Actors granten dieselben Caps daraus.
   0131 bleibt unangetastet geliefert; der Negotiator wird nur intern auf die
   geteilte Pipeline umverdrahtet.
2. **Slice 1 = voller Actor** (Flaggschiff): Wunsch → Manifest + Logic +
   View(s) + Style + Contracts. View-only-Drafts und Logic-Änderungen an
   Bestehendem sind Folge-Slices.
3. **Staging statt Preview** (Samuels Architektur): der validierte Draft wird
   als ECHTE Instanz gespawnt — „next" — mit Staging-Markierung, eigenen
   Fenstern, voll benutzbar. Die beste Preview ist der laufende Actor. Promote
   = „production" (Markierung fällt, Code-Export im Record); Discard = dispose.
4. **Single-Shot-Generierung:** ein Draft-Versuch; scheitert die Membran, wird
   der exakte Fehler strukturiert gemeldet — der Mensch stößt neu an. (Die
   Scrum-Schleife mit Fehler-Kontext ist der benannte Folge-Slice.)
5. **Kimi-k3-Lane:** die Composer-Completions laufen über den LLM-Actor mit
   `settings = {model: 'moonshotai/kimi-k3', temperature: 0.3, json: true}` —
   Entwerfen ist langsame, sorgfältige Arbeit; die Voice-Lane bleibt schnell.

## Die Ausführungs-Schritte, im Detail

**Schritt 0 — Goal-Intake.** Chat-Tool `compose` {wish} (Event COMPOSE). Der
Wunsch wird wörtlich ins Composer-State-Goal gelegt (`state.goal`), Phase →
`interviewing`. Das Composer-Fenster nimmt automatisch die Bühne (wie beim
Bridge-Draft). (`negotiate` bleibt beim Negotiator-Actor — anderes Tool,
anderes Fenster, dieselbe Pipeline darunter.)

**Schritt 1 — Interview (Plan-Runde).** Caps, fail-closed:
- `actors` → Registry-Snapshot: vergebene Ids/Namen (Kollisionsschutz),
  vorhandene Contracts (Andock-Kandidaten).
- `manifest` {actor} → das HAUSVORBILD: das workitem-Manifest (Logic, View,
  Style, Event-Muster) wird wörtlich in den Design-Brief zitiert — „the tool
  teaches the creator".
- `ask` {actor, question} mit asker='composer' → bei Andock-Wünschen (z. B.
  Erinnerungen) werden die Partner nach exakten Payload-Formen befragt.
  Alle Antworten landen in `state.interviews[]` (im Fenster sichtbar).

**Schritt 2 — Draft (Scrum-Runde, single-shot).** Cap `complete` {system,
question, settings: kimi-k3} → EIN JSON-Objekt: `{id, description, tags,
requires, produces, methods[] (mit event/hitl), logic, view, style, views[]}`.
Der Brief enthält: das Manifest-Schema mit den Hausregeln (Events statt
Handler, hitl-Label für Destruktives, said/record aus der Sandbox), die
aven-ui-Whitelist-Zusammenfassung (erlaubte Knoten, $each auf dem Container,
Brand-Tokens), das Hausvorbild, die vergebenen Ids, die Interviews. Parsen
HINTER der Membran: Garbage → `{ok:false, error}` mit Modell-Auszug, Phase →
`idle`, nichts passiert sonst.

**Schritt 3 — Membran (Validierung VOR dem Menschen).** Cap `probe` {draft}:
1. `validateViewDef` auf view + jede named view, `validateStyleDef` auf style.
2. Probe-Sandbox: `createSession(draft.logic)` (Syntaxfehler fangen),
   `initState(source)` muss ein Objekt liefern, ein Smoke-`reduce` mit dem
   ersten deklarierten Event darf nicht werfen.
Jeder Fehler → strukturierte Meldung mit dem exakten Wortlaut (said spricht
ihn), Phase → `idle`. Kein Auto-Retry (Entscheidung 4).

**Schritt 4 — Staging („next").** Cap `stage` {draft}: spawnt den Draft als
echte Instanz — Tag `staging`, instanceName `<id>`, Fenster entstehen über die
bestehende Instanz-Fenster-Mechanik und das erste nimmt die Bühne. Der Actor
ist JETZT benutzbar (Voice-Tools, Klicks, Trace). Der Composer hält den Draft
weiter pending (`state.staged`); die HUD-Leiste zeigt „Staged: <id> — Promote
oder Discard".

**Schritt 5 — Promote / Discard (HITL, button-only).** Kein promote-Tool im
Toolspecs — nur die Buttons (HUD + Composer-Fenster) feuern PROMOTE/DISCARD
als View-Events. PROMOTE: Cap `promote` entfernt das staging-Tag (production),
Record trägt den katalog-fertigen TS-Export (committen = dauerhaft; „Code ist
die Wahrheit" bleibt der Endzustand). DISCARD: Cap `discard` disposed die
Staging-Instanz samt Fenstern; der Draft verfällt.

**Schritt 6 — Retrospective (Folgekarten).** Läuft ein produzierter Actor
schief, wird die Trace-Fehlerhistorie zum Heal-Re-Draft-Kontext
(Self-Healing-Karte); die Scrum-Schleife (Auto-Retry mit Fehler-Kontext,
Änderungswunsch = neue Runde) ist der zweite benannte Folge-Slice.

## Die Composer-View (Zustände des einen Fensters)

Datengetrieben über `state.phase` (leere Arrays rendern nichts — das
$each-Conditional-Muster):

1. **idle** — Titel „Composer", Note „Sag, was existieren soll — ich
   interviewe die Mesh und entwerfe es." Darunter: Liste der staged +
   produzierten Actors dieser Session (Name, Status-Chip staging/production).
2. **interviewing** — Goal als Zitat, darunter die Interview-Zeilen (wen er
   fragt, was geantwortet wurde) als kleine Karten — der Prozess ist sichtbar,
   nicht magisch.
3. **drafting** — Goal + „Kimi entwirft…" (die Modell-Lane läuft; kimi-k3).
4. **staged** — die Draft-Karte: id, description, Contract-Pills, Entries
   (Name + Event-Chip + hitl-Badge), Logic-Vorschau (gekürzt, aufklappbar via
   Logic-Lens des staged Actors), Hinweis „Läuft als Staging-Instanz — probier
   sie aus". Buttons **Promote** / **Discard** ($on → PROMOTE/DISCARD).
5. **failed** — der exakte Membran- oder Parse-Fehler als Karte, mit dem
   Modell-Auszug; Note „Sag es nochmal oder anders — single-shot, kein
   Auto-Retry."

## Files to touch

- `app/src/lib/actors/draft-pipeline.ts` (neu — die GETEILTE Maschinerie:
  Membran-Probe, Staging-Spawn, Promote/Export, Discard; von beiden Actors
  als Caps gegrantet)
- `app/src/lib/actors/composer.actor.ts` (neu — Logic mit COMPOSE/PROMOTE/
  DISCARD, Caps actors/manifest/ask/complete/probe/stage/promote/discard)
- `app/src/lib/actors/negotiator.actor.ts` (bleibt eigener Actor; register-Cap
  wird auf die geteilte Pipeline umverdrahtet — Staging statt Direkt-Register)
- `app/src/lib/actors/chat.actor.svelte.ts` (Wiring, kimi-Settings im
  complete-Cap), `chat.svelte.ts` (Prompt: compose-Intent, staging erklärt)
- `app/src/lib/actors/windows.ts` (Composer-Fenster ersetzt Negotiator-Fenster)
- `app/src/routes/dashboard/+page.svelte` (HUD-Leiste generisch für staged
  Drafts — die bestehende Bridge-Leiste wird die Staged-Leiste)
- `app/tests/composer.test.ts` (neu — der Beweis), `tests/negotiator.test.ts`
  (umverdrahtet auf den Composer)

## Acceptance criteria

- [ ] Interview caller-aware ('composer') + Hausvorbild im Brief + kimi-k3-Settings am complete-Cap. (Test)
- [ ] Membran: invalider Draft (View-Verstoß ODER Logic-Syntaxfehler ODER initState-Nichtobjekt) = strukturierter Fehler mit Wortlaut, nichts gestaged. (Test)
- [ ] Staging: valider Draft läuft als Instanz (tag staging, dispatch-bar), Composer hält pending. (Test)
- [ ] Promote button-only (kein Tool), entfernt staging, liefert TS-Export; Discard disposed Instanz + Fenster. (Test)
- [ ] Negotiator bleibt eigener Actor, intern auf die geteilte Pipeline umverdrahtet; 0131-Bridge-Kette (metric→proxy→miles) weiter grün. (Test)
- [ ] Suite + Check grün.
- [ ] **(HITL)** Per Stimme „Ich will einen Habit-Tracker mit Streaks" → Composer-Fenster zeigt Interview→Draft→Staged, die Staging-Instanz ist benutzbar, Promote per Button, Export-Code im Record.

## Verification

```bash
cd app && bun test tests/composer.test.ts
```

```bash
cd app && bun test && bun run check
```

## Hand-off

```
/aven-build 0135
```

## Progress log

Newest entry first.

- `2026-08-12` — Korrektur Samuel (final): ZWEI Actors — Composer und Negotiator getrennt wie bei abject (ObjectCreator/Negotiator), geteilte Draft-Pipeline als Host-Modul; Karte entsprechend umgeschrieben.
- `2026-08-12` — Discovery mit Samuel: zunächst EIN Composer erwogen, Slice 1 = voller Actor, STAGING statt Preview (Draft läuft live als „next"-Instanz, Promote = „production" + Code-Export, button-only), Single-Shot-Generierung (Membran-Fehler wörtlich melden, kein Auto-Retry — Scrum-Schleife als Folge-Slice), Kimi-k3-Lane für alle Composer-Completions. Ausführungs-Schritte und die fünf View-Zustände des Composer-Fensters im Detail spezifiziert; messbar via composer.test.ts (Interview/Membran/Staging/button-only-Promote/0131-Kette). Karte direkt in discover/.
