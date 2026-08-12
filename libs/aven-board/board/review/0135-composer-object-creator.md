---
title: Composer — der ObjectCreator: Wunsch → Actor, staged wie next/production
summary: Composer und Negotiator bleiben ZWEI Actors (wie abjects ObjectCreator/Negotiator) über EINER geteilten Draft-Pipeline (Membran → Staging → Promote/Export); die Kimi-k3-Lane entwirft komplette Actors (Manifest+Logic+Views+Style), der Draft läuft als LIVE-Staging-Instanz („next"), Promote (button-only) macht ihn production + Code-Export
owner: Claude Code (build agent)
created: 2026-08-12
updated: 2026-08-12
tags: [actors, composer, object-creator, staging, sandbox]
goal: "`cd app && bun test tests/composer.test.ts` exits 0 — proving with a FAKED llm actor: (1) INTERVIEW, PROOFS FIRST: compose(wish) asks the mesh caller-aware (asker='composer'), writes state.proofs (Prolog goals + seed payloads + expected record keys) BEFORE the design call, quotes both the proofs and a house exemplar (workitem manifest) into the design brief, and the model call carries settings.model='moonshotai/kimi-k3'; (2) MEMBRANE: the draft passes validateViewDef/validateStyleDef AND a sandbox probe (logic evaluates, initState returns an object, a smoke reduce runs) AND every proof from state.proofs is satisfied on an isolated scratch bus (satisfy(goal, seed) ends ok with the expected record keys) BEFORE anything is staged — an invalid draft is a structured failure with the exact error, nothing enters the mesh (single-shot, no auto-retry), AND the failure is KEPT as an entry in state.history (wish + error + model excerpt) so the future scrum loop has its legacy context; (3) STAGING: a valid draft is spawned as a LIVE staging instance (tagged staging, windows derivable, usable via dispatch) while the composer still holds it pending; (4) PROMOTE is button-only (no promote/discard tool in toolSpecs): the PROMOTE event drops the staging tag and returns a catalog-ready TS export, DISCARD disposes the staged instance and its windows; (5) SHARED PIPELINE: the negotiator is REWIRED onto the same shared draft-pipeline module (membrane → stage → promote/export) while remaining its own actor, and the 0131 bridge chain (metric → proxy → miles) still proves end-to-end; AND `cd app && bun test` plus `bun run check` (0 errors) stay green"
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

**Schritt 1 — Interview (Plan-Runde): PROOFS FIRST.** Das Interview endet
nicht mit Prosa, sondern mit dem messbaren „done" — dieselbe Philosophie wie
das Discover-Skill selbst („AI is brilliant at what can be measured"):
BEVOR irgendetwas entworfen wird, schreibt der Composer aus dem Wunsch die
**Proofs** in `state.proofs[]`:

```
{ goal: 'streak(H, S)', seed: { habit: 'meditieren', done: [d1, d2, d3] },
  expect: { streak: 3 } }
```

— Prolog-Ziele (die Contracts, die der neue Actor `produces`), konkrete
Seed-Payloads und die erwarteten Record-Felder. Die Proofs SIND die
Definition von „gut" für den menschlichen Intent; sie stehen im Fenster,
bevor Kimi eine Zeile Logic sieht, und der Design-Brief zitiert sie wörtlich
(„build the actor that makes these goals satisfiable"). Caps, fail-closed:
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
3. **Die Proofs laufen** — auf einem SCRATCH-Bus (isoliert, die echte Mesh
   sieht nichts): der Draft wird dort als Probe-Instanz registriert, und
   jeder Proof aus Schritt 1 muss beweisbar sein — `satisfy(goal, seed)`
   endet `ok` und der letzte Record trägt die erwarteten Felder. Ein Draft,
   der seine eigene Definition von „done" nicht erfüllt, erreicht weder
   Staging noch Mensch; der Fehler nennt den gescheiterten Proof beim Namen.
Jeder Fehler → strukturierte Meldung mit dem exakten Wortlaut (said spricht
ihn), Phase → `idle`. Kein Auto-Retry (Entscheidung 4). **Aber: der Fehler
wird BEHALTEN, nicht verworfen** — er landet als Eintrag in
`state.history[]` (wish, exakter Fehler, Modell-Auszug). Das ist das
Retrospective-Futter: die spätere Scrum-Schleife promptet „letzter Draft +
diese Fehlerhistorie → nächste Runde", ohne neue Maschinerie.

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
Änderungswunsch = neue Runde) ist der zweite benannte Folge-Slice. Slice 1
legt dafür den Boden: Membran-/Parse-Fehler liegen strukturiert in
`state.history[]` (Schritt 3), Laufzeitfehler der Staging-Instanz in der
Bus-Trace unter ihren Run-Ids — der Legacy-Kontext für die nächste
Iteration existiert also bereits, die Folgekarte muss ihn nur prompten.

## Zukunftssicherheit — Update/Migration ist derselbe Flow (abject-Alinierung)

Bewusst OUT OF SCOPE für Slice 1: Multi-Actor-Ensembles (ein Wunsch, der
mehrere Actors braucht) und Edit/Merge an Bestehendem. Aber die Architektur
ist dafür schon richtig geschnitten, denn abject kennt kein separates
Migrations-Framework — **ein Update IST eine weitere Goal-Runde durch
dieselbe Maschinerie** (Plan → Scrum → Review → Retrospective). Drei
Invarianten sichern die Kompatibilität, alle drei existieren bereits:

1. **Identität bleibt, Implementierung wechselt** — die uuid ist die
   Adresse (abjects AbjectId), das Manifest ist das versionierte Artefakt.
   Ein Edit = neue Version als „next"-Instanz NEBEN der Production stagen,
   ausprobieren, Promote = Swap. Genau die Staging-Architektur dieser Karte.
2. **State-Migration hat einen Hook** — `initState(source)` nimmt seit 0130
   einen source-Parameter: die neue Logic bekommt den alten State und
   migriert ihn selbst. Für Updates wird der Hook nur benutzt, nicht gebaut.
3. **Verträge verhandeln statt brechen** — ändert eine neue Version ihr
   Vokabular, ist das ein Negotiator-Fall (Bridge), kein Breaking Change.
   Deshalb ist „zwei Actors, eine Pipeline" auch update-technisch richtig.

## Die Composer-View (Zustände des einen Fensters)

Datengetrieben über `state.phase` (leere Arrays rendern nichts — das
$each-Conditional-Muster):

1. **idle** — Titel „Composer", Note „Sag, was existieren soll — ich
   interviewe die Mesh und entwerfe es." Darunter: Liste der staged +
   produzierten Actors dieser Session (Name, Status-Chip staging/production).
2. **interviewing** — Goal als Zitat, darunter die Interview-Zeilen (wen er
   fragt, was geantwortet wurde) als kleine Karten — der Prozess ist sichtbar,
   nicht magisch. Sobald die Proofs stehen, erscheinen sie hier als eigene
   Karten (Prolog-Ziel + Seed + Erwartung) — der Mensch sieht die Definition
   von „done", BEVOR entworfen wird.
3. **drafting** — Goal + „Kimi entwirft…" (die Modell-Lane läuft; kimi-k3).
4. **staged** — die Draft-Karte: id, description, Contract-Pills, **die
   Proofs als grüne Chips** (Ziel + „bewiesen" — sie SIND hier grün, sonst
   wäre nichts gestaged), Entries (Name + Event-Chip + hitl-Badge),
   Logic-Vorschau (gekürzt, aufklappbar via Logic-Lens des staged Actors),
   Hinweis „Läuft als Staging-Instanz — probier sie aus". Buttons
   **Promote** / **Discard** ($on → PROMOTE/DISCARD).
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

- [x] Interview caller-aware ('composer') + Hausvorbild im Brief + kimi-k3-Settings am complete-Cap. (Test)
- [x] Proofs first: `state.proofs` (Prolog-Ziel + Seed + erwartete Record-Felder) existieren VOR dem Design-Call und stehen wörtlich im Brief. (Test)
- [x] Membran: invalider Draft (View-Verstoß ODER Logic-Syntaxfehler ODER initState-Nichtobjekt ODER gescheiterter Proof auf dem Scratch-Bus) = strukturierter Fehler mit Wortlaut bzw. Proof-Name, nichts gestaged, Fehler als `state.history`-Eintrag behalten (Retrospective-Futter). (Test)
- [x] Staging: valider Draft läuft als Instanz (tag staging, dispatch-bar), Composer hält pending. (Test)
- [x] Promote button-only (kein Tool), entfernt staging, liefert TS-Export; Discard disposed Instanz + Fenster. (Test)
- [x] Negotiator bleibt eigener Actor, intern auf die geteilte Pipeline umverdrahtet; 0131-Bridge-Kette (metric→proxy→miles) weiter grün. (Test)
- [x] Suite + Check grün (80/80 Tests, svelte-check 0 Fehler).
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

- `2026-08-12` — HITL-Befund Samuel, Runde 2 + Fix: der Prozess gehört ins COMPOSER-FENSTER, nicht als Toast neben die Voice-Pill. Umgesetzt als Host-Overlay-Seam: compose fronted das Composer-Fenster VOR dem Dispatch; während der eine reduce läuft, overlayen die Caps transienten Prozess-State ins reaktive state (Steps-Liste ✓/◐, Token-Ticker im aktuellen Step, Interviews live, Wunsch als Zitat, phase interviewing→drafting) — der finale Sandbox-Commit überschreibt das Overlay komplett (die Sandbox bleibt Owner der Wahrheit, der Host erzählt nur, was er selbst tut; er parst weiterhin nichts). Boot-Race abgefangen (Opening-Patch wird beim ersten Step re-merged). Composer-Activity-Wiring entfernt; erfolgreiches Staging fronted weiter das Fenster der Staging-Instanz via Spawn-Hook. Neuer Test: Mid-Run zeigt state phase=drafting + processRows + goal, danach ersetzt die Sandbox-Wahrheit das Overlay (processRows weg). Suite 83/83, Check 0.
- `2026-08-12` — HITL-Befund Samuel + Fix: (1) STOP-BUG — der Stop-Button brach nur den Reply-Stream ab, der Kimi-Fetch und damit die ganze Compose-Pipeline liefen weiter. Fix: Abort-Seam durchgezogen — `Chat.signal` (Getter auf den Turn-Controller) → Composer/Negotiator `options.signal` → LaneExtras auf dem llm-Transport → `complete({signal})` → fetch; Abbruch endet als strukturierter failed-State mit history-Eintrag (Test: „the turn signal reaches the lane"). (2) ZERO PROGRESS — der eine COMPOSE-reduce committet State erst am Ende, interviewing/drafting wurden nie gerendert, die Pill zeigte Minuten nur „Thinking". Fix: die Host-Caps SIND die Progress-Naht — ask/complete/probe melden Zeilen in die Activity-Leiste, der Kimi-Stream tickt via onDelta (~Token-Zähler, 800ms-Throttle) durch. Echte Phasen-Committs (reduce in Stufen-Events splitten) bleiben Folge-Slice. Dazu: idle-Titel-Dublette „Composer/Composer" → „Idle — nothing staged yet". 12 Composer-Tests, Suite 82/82, Check 0.
- `2026-08-12` — GEBAUT (Slice 1 komplett, alle Kriterien grün): `draft-pipeline.ts` als geteilte Maschinerie (draftManifest, probeDraft = Validatoren + Sandbox-Probe + Proofs auf Scratch-Bus, stageDraft/promoteStaged/discardStaged/registerDraft, exportCode, Staging-Tag-Set als Singleton); `composer.actor.ts` mit sandboxed COMPOSE/PROMOTE/DISCARD-Logic (Plan-Runde schreibt state.proofs VOR dem Design-Call, state.history behält jeden Fehler, 8 fail-closed Caps, kimi-k3-Settings fest am complete-Cap); Negotiator-register-Cap auf registerDraft umverdrahtet (proxyManifest = Alias über draftManifest); Wiring: ReactiveComposer + Composer-Fenster + Staged-HUD-Leiste (Promote/Discard buttons-only via uiEvent) + compose-Intent im Chat-Prompt; nach erfolgreichem Staging nimmt das FENSTER DER STAGING-INSTANZ die Bühne (Spawn-Hook), das Composer-Fenster nur bei Fehlschlag. ABWEICHUNG von „Files to touch": das Negotiator-Fenster bleibt BESTEHEN (Composer-Fenster kommt dazu) — Entscheidung 1 („0131 bleibt unangetastet geliefert") schlägt die Fenster-Ersetzungs-Notiz. 10 neue Tests in composer.test.ts, Suite 80/80, Check 0 Fehler.
- `2026-08-12` — Proofs first (Samuel): das Interview endet mit `state.proofs` (Prolog-Ziele + Seeds + erwartete Record-Felder) BEVOR entworfen wird — die Proofs sind die Definition von „done" für den menschlichen Intent (dieselbe Philosophie wie das Discover-Skill, abjects Plan-Runde). Membran-Schritt 3 neu: alle Proofs müssen auf einem isolierten Scratch-Bus via satisfy() beweisbar sein, sonst kein Staging; staged-View zeigt die Proofs als grüne Chips. Goal + Acceptance entsprechend erweitert.
- `2026-08-12` — Nachschärfung (Samuel-Fragen): Multi-Actor + Edit/Merge explizit out of scope, aber Update/Migration als abject-alinierter Zukunftspfad dokumentiert (Update = neue Goal-Runde: uuid-Identität bleibt, initState(source) als Migrations-Hook, Vokabular-Änderung = Negotiator-Fall). Membran-Fehler werden ab Slice 1 in state.history behalten (+ Goal/Acceptance) — der Legacy-Fehlerkontext für die Scrum-Schleife existiert damit von Anfang an.
- `2026-08-12` — Korrektur Samuel (final): ZWEI Actors — Composer und Negotiator getrennt wie bei abject (ObjectCreator/Negotiator), geteilte Draft-Pipeline als Host-Modul; Karte entsprechend umgeschrieben.
- `2026-08-12` — Discovery mit Samuel: zunächst EIN Composer erwogen, Slice 1 = voller Actor, STAGING statt Preview (Draft läuft live als „next"-Instanz, Promote = „production" + Code-Export, button-only), Single-Shot-Generierung (Membran-Fehler wörtlich melden, kein Auto-Retry — Scrum-Schleife als Folge-Slice), Kimi-k3-Lane für alle Composer-Completions. Ausführungs-Schritte und die fünf View-Zustände des Composer-Fensters im Detail spezifiziert; messbar via composer.test.ts (Interview/Membran/Staging/button-only-Promote/0131-Kette). Karte direkt in discover/.
