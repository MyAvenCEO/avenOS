---
title: FiBu-Flows — generisches Recipe-Modell + Svelte-Flow-Canvas (Mock)
summary: Sub-Tab »Flows« im Buchhaltung-Tab — Rezepte als reine JSON-Configs (n Inputs → Transforms → n Outputs, jeder Schritt actor-artig mit eigener Transformation), gerendert als Node-RED-artiger Canvas; Beispiel-Flow »Eingangsrechnung buchen«.
owner: samuel + claude
created: 2026-08-14
updated: 2026-08-14
tags: [fibu, app, ui, flows]
goal: "`bun test app/tests/fibu-recipe.test.ts`, `bun run check` und `bun run lint` exit 0; die Tests beweisen Port-Referenz-Integrität, Kind-Regeln (Inputs nur senden / Outputs nur empfangen), Azyklizität und volle Erreichbarkeit; Sub-Tab »Flows« rendert den Beispiel-Flow als Svelte-Flow-Canvas mit JSON-Detail-Panel (Screenshot im Transcript)"
---

# FiBu-Flows — generisches Recipe-Modell + Svelte-Flow-Canvas (Mock)

## Context

Folge-Card zu [[0139]]. Bevor die Flow-Engine gebaut wird, wollen wir Rezepte
**sehen und als Daten festnageln**: ein Rezept ist ein gerichteter Graph mit
n Inputs → Transformationen → n Outputs. Jeder Schritt ist node-/actor-artig —
benannte Ports als Kontrakt, genau **eine eigene `transform`-Sektion**
(`type` + deklarative `config`), kein Code. Die UI ist bewusst ein Mock: nichts
läuft, alles ist deklariert; die Engine kommt in einer eigenen Card.

Der Beispiel-Flow »Eingangsrechnung buchen« kodiert die Vier-Schichten-HITL-
Architektur aus dem FiBu-Kontextdokument als Graph: Belegeingang/Bank/Stammdaten
→ Extract (Parser bei E-Rechnung, KI bei PDF) → LLM-Klassifikation (gibt NIE
Konto/BU aus) → deterministische Steuerlogik (`rules:tax`, nie KI) →
Buchungszeilen ableiten (n:m, Begründungen) → Validieren + Zahlung matchen →
Buchungsstapel / HITL-Prüfliste / Offene Posten.

## Goal

Sub-Tab »Flows« im Buchhaltung-Tab zeigt den Beispiel-Flow als Node-RED-artigen
Canvas (Svelte Flow); Klick auf einen Schritt zeigt seine JSON-Config verbatim;
die Configs sind durch Invarianten-Tests als wohlgeformter Dataflow bewiesen.

**Completion condition** (identisch zum Frontmatter-`goal`): siehe oben.

## Files to touch

- `app/src/lib/fibu/recipe-config.ts` — neu: generische Typen + Beispiel-Rezept.
- `app/src/lib/fibu/RecipeFlow.svelte` — neu: Canvas + JSON-Detail-Panel.
- `app/src/lib/fibu/RecipeNode.svelte` — neu: Custom-Node (Kind-Badge, Ports).
- `app/src/lib/fibu/RecipeFit.svelte` — neu: fitView nach Node-Vermessung.
- `app/src/lib/fibu/FibuWorkspace.svelte` — neu: Sub-Tabs Belege | Flows.
- `app/src/routes/dashboard/+page.svelte` — FibuExplorer → FibuWorkspace.
- `app/tests/fibu-recipe.test.ts` — neu: Dataflow-Invarianten.

## Acceptance criteria

- [x] `bun test app/tests/fibu-recipe.test.ts` exit 0 — Port-Referenzen valide,
      Inputs senden nur / Outputs empfangen nur, Graph azyklisch, jeder Node von
      einem Input erreichbar und erreicht einen Output; Beispiel-Flow trägt die
      HITL-Form (3 In, 3 Out, `rules:tax` deterministisch, Classifier ohne
      Konto/BU-Output). *Evidenz: 5 pass, 113 expect() calls.*
- [x] Sub-Tab »Flows« rendert den Canvas; Node-Klick zeigt JSON-Config; Kanten
      des gewählten Nodes leuchten. *Evidenz: Screenshots im Transcript
      (Gesamtgraph + Steuerlogik-Detailpanel).*
- [x] `bun run check`, `bun run lint`, volle Suite grün. *Evidenz: 459 FILES
      0 ERRORS; biome »No fixes applied«; 55/55 Tests (325 Assertions).*

## Verification

```bash
bun test app/tests/fibu-recipe.test.ts
bun run check
bun run lint
```

## Hand-off

```
/aven-review 0140
```

## Progress log

- `2026-08-14` — Umnummeriert 0132 → 0140: beim Merge der Fibu-Arbeit in die Actor-Linie kollidierten die Nummern (0131/0132 waren dort bereits vergeben und aus vier Quelldateien referenziert). Inhalt unverändert; Code-Kommentare mitgezogen.
- `2026-08-14` — Tabs flachgezogen (User): kein Sub-Tab mehr unter
  »Buchhaltung«, stattdessen **»Buchhaltung«** (Belegansicht) und **»Skills«**
  (Flow-Canvas) gleichrangig in der Haupt-Tab-Leiste; `FibuWorkspace.svelte`
  entfernt, die Vollbreiten- und Toast-Regeln laufen über ein `wide`-Derived
  für beide Arbeitsflächen. Gates grün (75/75, check 0 Errors, lint clean);
  im Preview beide Tabs verifiziert.

- `2026-08-14` — **HITL als generischer Skill + Autonomie als Actor-Cap**
  (User-Spec): Neuer Skill **HITL** mit `hitl-posteingang` (Eintritt) und
  `hitl-whitelist`. Alle vier Review-Queue-Sinks der anderen Skills sind jetzt
  `handoff`-Nodes dorthin (Weiß-nicht-Box, Klärung, Validierungs-Prüfliste,
  EXTF-Abweisungen) — eine Warteschlange für Freigaben, Fehler und Unklares aus
  jedem Skill, nach Risiko sortiert. Neue **Actor-Capability** `autonomie` an
  jedem Node: `modus` hitl | stichprobe | auto, **absent = hitl** (ein neuer
  Actor läuft unter Aufsicht), plus `freigabe` mit durch/seit/nachweis. Test
  erzwingt: **keine Provenienz, keine Autonomie**. `hitl-whitelist` bildet den
  Weg dorthin ab — Bilanz je Actor (Läufe, Korrekturquote, **Spätfehlerquote**)
  → Freigabe nur durch einen Menschen, **Rückstufung deterministisch und
  sofort**. Im Detail-Panel neuer Autonomie-Block.
  *v1-Vereinfachung im selben Zug (User):* die automatische LLM-Fehlerbehandlung
  wieder entfernt — `hitl-fehlerbehandlung` gelöscht, `fehler` nur noch
  hitl | retry, ein Fehler ist schlicht eine Meldung an den Menschen; Test hält
  fest, dass kein Flow sich selbst repariert. Ebenso Webhook- und
  Message-Eingang aus der Triage entfernt (3 Quellen: Mail, Postbox, Upload).
  Suite 75/75, alle Gates grün; im Preview verifiziert (Handoff → HITL-Eintritt,
  Autonomie-Block).

- `2026-08-14` — **Skills als Ebene über den Flows** (User-Spec): Flows liegen
  flach in einer Registry, ein Skill ist eine benannte Menge darüber plus
  Vertrag (`accepts`/`provides`/`entry`) — die Einheit, die aven installiert
  und aktiviert. Neues `skill-config.ts` mit zwei Skills: **Inbox**
  (inbox-triage, belege-extrahieren, scan-zu-dokument) und **Buchhaltung**
  (eingangsrechnung-buchen, zahlungsabgleich, buchungsvorgang, datev-export —
  DATEV gehört dazu, läuft nur am Periodenende statt am Beleg). Neues
  `handoff`-Node-Kind reicht Arbeit an einen anderen Skill weiter, statt dessen
  Flows zu verschlucken — genau das hält den Flow-Graph flach: die Triage
  nistet `eingangsrechnung-buchen` nicht mehr ein, sondern endet an der
  Skill-Grenze (grün gestrichelt, Klick springt zum Eintrittsflow). Damit
  wanderte die Extraktion dorthin, wo sie hingehört: der Inbox-Skill liest
  Belege UND Auszüge selbst und übergibt strukturierte Positionen/Transaktionen;
  `beleg-und-zahlung` schrumpfte zum reinen **`zahlungsabgleich`**. Aside-Liste
  jetzt nach Skills gruppiert (Vertragszeile, »Eintritt«- und »aktiv«-Marker).
  Neuer Test `fibu-skill.test.ts` (5 Tests): jeder Flow gehört zu ≥1 Skill,
  `entry` ∈ `flows`, Handoff-Ziel existiert, ist nie der eigene Skill, und was
  über die Grenze geht, steht beim Sender in `provides` und beim Empfänger in
  `accepts`. Suite 71/71, alle Gates grün; im Preview verifiziert.
- `2026-08-14` — Platzhalter-Zweige aus der Triage entfernt (User): Vertrags-Flow,
  Ablage, Support und Dokument-Ablage zeigten auf Flows, die es nicht gibt. Die
  Weiche führt jetzt nur noch die gebauten Pfade — `beleg` und `transaktionen`
  in den Buchungs-Subflow, alles andere in die Weiß-nicht-Box (HITL); die
  Klassifikator-Config nennt entsprechend nur noch die zwei echten Klassen.
  Neuer Test hält fest, dass kein Sink mit »(folgt)« markiert ist: ein
  ungebauter Pfad ist ein Mensch in der Schleife, keine Kiste, die Arbeit
  schluckt. Triage 16 → 12 Schritte; Gates grün (66/66, 1337 Assertions).

- `2026-08-14` — Flow-Auswahl als linke Aside-Liste statt Chip-Leiste (die bei
  sieben Flows zweizeilig umbrach und die Breadcrumb verdrängte): Drei-Spalten-
  Layout wie im Belege-Tab — Flow-Liste links (Name + »N Schritte · M
  Subflows«, aktiver Flow getönt), Canvas mittig, Detail-Panel rechts; die
  Breadcrumb sitzt jetzt schmal über dem Canvas. Drill-down synchronisiert
  beides: Liste hebt den geöffneten Subflow hervor, Breadcrumb zeigt den Pfad.
  Im Preview verifiziert (zwei Ebenen tief), Gates grün (66/66, lint clean).

- `2026-08-14` — Ports links/rechts + Split des Buchungsflows + DATEV als
  eigenes System (User-Spec): (1) Im Node stehen In-Ports als Liste **links**,
  Out-Ports **rechts** — der Node liest sich wie der Graph fließt; Node-Höhe
  wird im Layout aus `max(inputs, outputs)` berechnet, DOM-Check bestätigt
  0 Überlappungen (auch bei der Triage-Weiche mit 7 Ausgängen). (2)
  `eingangsrechnung-buchen` in **zwei** Subflows zerlegt:
  **`beleg-und-zahlung`** (allgemein, kennt kein Steuerrecht: Extraktion,
  Auszug/CSV/Bank, Matching) und **`buchungsvorgang`** (steuerlich: Kategorie,
  Steuerlogik, Zeilen, Soll/Ist, Vier-Augen, Festschreibung). Die Klammer
  darüber hat nur noch 7 Nodes. Offene Posten laufen bewusst als **Zustand**
  (Output im Buchungsteil, Input im Erfassungsteil) statt als Leitung — sonst
  wäre es ein Zyklus statt eines DAG; Test sichert beides. (3) Neues Root-Rezept
  **`datev-export`**: liest festgeschriebene Buchungen als Bestand, Stapel je
  Periode × Belegkreis (nie über die WJ-Grenze), **»Vorsteuer falten«** (unsere
  expliziten VSt-Zeilen → BU-Schlüssel auf Bruttobetrag, 19→9 / 7→8), EXTF
  v700/Windows-1252/TTMM schreiben, prüfen, Abweisungen an HITL. Test hält fest,
  dass niemand datev-export referenziert und es niemanden referenziert.
  16 Rezept-Tests / 1165 Assertions, Suite 66/66; im Preview verifiziert.

- `2026-08-14` — Progressive Disclosure statt Alles-auf-einmal (User-Spec):
  Subflows werden nicht mehr inline expandiert, sondern als **eine violett
  gestrichelte Summary-Kachel** mit ihren Ports gezeigt; ein Klick **navigiert
  in den gefilterten Flow** (eigener Canvas), eine Breadcrumb führt zurück —
  jede Ebene für sich lesbar (Wurzel: 16 statt 60 Nodes). Damit fielen
  `ClusterNode.svelte` und die Rekursion weg; `recipe-flatten.ts` →
  **`recipe-layout.ts`**: das Layout wird jetzt **berechnet statt gesetzt**
  (Spalten aus der Graphtiefe, Zeilen gestapelt und zentriert — dasselbe
  Prinzip wie `ActorGraph` mit `bus.stages()`), wodurch alle handgesetzten
  `position`-Felder aus den Configs verschwinden (~40 Zeilen weniger, keine
  Koordinaten-Pflege mehr). Neuer Layout-Test beweist: jede Kante läuft
  vorwärts (x_source < x_target), Inputs teilen die linke Spalte, keine zwei
  Nodes auf demselben Punkt. 14 Rezept-Tests / 846 Assertions, Suite 64/64;
  im Preview vier Ebenen durchgeklickt (Triage → buchen → extrahieren →
  Scan zu Dokument), Konsole fehlerfrei.

- `2026-08-14` — Canvas-Reaktivität: Svelte Flow warnte bei jedem Mount
  (»Use $state.raw for nodes«). Ursache war nicht die nodes-Liste, sondern dass
  `recipe` als `$state` die **gesamte Rezept-Config tief proxied** hat — Svelte
  Flow lief damit über 60 Proxy-Nodes pro Interaktion. Fix: nur noch die
  Rezept-**id** im State (`$derived` löst sie auf), Nodes/Edges als
  `$state.raw` aus reinen Build-Funktionen. Warnung im Preview nach
  `console.clear` + Rezeptwechsel reproduzierbar weg; Rendering unverändert.
- `2026-08-14` — Inbox als Wurzel + OCR als typgesteuerter Leaf (User-Spec):
  (1) `scan-zu-text` → **`scan-zu-dokument`**: nimmt Bild **+ Dokumenttyp**,
  liefert **schemakonforme Daten + Volltext**. Neuer deterministischer Schritt
  »Schema wählen« (`registry:doc-schema`) übersetzt den Typ in JSON-Schema +
  typspezifischen System-Prompt — ein neuer Dokumenttyp ist ein
  Registry-Eintrag, kein neuer Flow. (2) **Wiederverwendung**: derselbe Leaf
  liest den Beleg (`belege-extrahieren/ocr`, Typ »rechnung«) UND den
  Kontoauszug (`eingangsrechnung-buchen/auszug-ocr`, Typ »kontoauszug«); dazu
  Auszugsweiche csv | scan, CSV deterministisch geparst. Test erzwingt, dass
  beide Nutzer einen `typ`-Port verdrahtet haben. (3) Die **eine
  Klassifikation** in der Triage emittiert jetzt `klassifiziert` + `dokumenttyp`;
  der Typ reist mit und steuert stromabwärts die OCR. (4) `inbox-triage` ist
  die **Wurzel**: Beleg- und Transaktions-Zweig laufen in den Subflow
  `eingangsrechnung-buchen` (der wiederum `belege-extrahieren` enthält, der
  wiederum den OCR-Leaf) — **vier Ebenen**, im Canvas als verschachtelte
  gestrichelte Cluster, 60 Nodes. 14 Rezept-Tests / 884 Assertions, Suite
  64/64; im Preview verifiziert (Wurzel-Canvas mit doppelt instanziiertem
  OCR-Cluster, Leaf-Detailpanel mit Registry).

- `2026-08-14` — Ist-Versteuerung + Vier-Augen-Festschreibung + Inbox-Triage:
  (1) Neues `hitl`-Kind (menschliche Gates mit Rolle) — Kette
  validate → Freigabe GF (1/2) → Freigabe Buchhalter (2/2) →
  Festschreiben (`seal:festschreibung`, Hash-Kette + Blockchain-Anchoring,
  UStVA-Periode) → Buchungsstapel; Test beweist, dass nichts an den Gates
  vorbeiführt. (2) Ist-Versteuerung als Policy-Route im Zahlungsstrom
  (§ 20 UStG aus Mandanten-Policy): `ist` → »USt fällig stellen«
  (deterministisch, § 13 Abs. 1 Nr. 1 b, anteilig bei Teilzahlung/Skonto) →
  Festschreibung (any-Merge). (3) Universelles Rezept `inbox-triage` als
  Front-Door: 5 Quellen (Mail/Postbox/Upload/Webhook/Message) → Annehmen
  (any) → LLM-Split (Mail mit 3 Rechnungen = 3 Vorgänge) → LLM-Klassifikation
  (Schwelle 0.8, darunter nie raten) → Route in 7 Pfade inkl. Support-HITL und
  Weiß-nicht-Box (Korrektur-wird-Regel). 13 Rezept-Tests / 630 Assertions,
  Suite 63/63; im Preview verifiziert (Triage-Canvas, HITL-Detailpanel).

- `2026-08-14` — Composite-Iteration (User-Korrektur: kein kollabierter Node!):
  Subflows rendern EXPANDIERT — die Actor-Nodes bleiben in voller Granularität
  sichtbar, umrahmt von einem gestrichelten Cluster (`ClusterNode` +
  xyflow-Parent-Nodes). Neues `recipe-flatten.ts` expandiert rekursiv
  (pfad-namespaced ids `extract/ocr/in-bild`, Kanten via `portMap` an die
  Input-/Output-Nodes des Sub-Rezepts gedockt, Cluster vor Kindern).
  Composite–Leaf beliebig tief: neues Leaf-Rezept `scan-zu-text`
  (Vorverarbeiten → Vision-OCR), der OCR-Schritt in `belege-extrahieren` ist
  jetzt dessen Subflow → 2 Ebenen Schachtelung im Hauptflow; Test beweist den
  Referenz-DAG als azyklisch + Leaf ohne Subflows. Detail-Panel mit Tabs
  »Details | JSON«: Transformation als Config-Tabelle, LLM-Einsatz mit
  Constraint-Chips, Ports mit entweder/oder-Markierung. 10 Tests / 355
  Assertions; Suite 60/60; im Preview verifiziert (Cluster-in-Cluster,
  Dock-Kanten, Details-Panel).

- `2026-08-14` — Modell-Erweiterung (User-Spec): (1) In-Ports mit `mode:
  'all' | 'any'` — mehrfach gespeiste Ports MÜSSEN `any` sein (Test erzwingt
  das); (2) `route`-Kind: die Belegweiche feuert genau einen Ausgang
  (E-Rechnung | PDF-Text | Scan); (3) optionaler `llm`-Block pro Node mit
  purpose + constraints — Steuerlogik per Test beweisbar OHNE; (4) `subflow`-Kind:
  Extraktion ist jetzt eigenes Rezept `belege-extrahieren` (Weiche → Parser /
  OCR→LLM-Extraktion → any-Merge), im Hauptflow als Cluster-Node mit
  Drill-down-Button. Dazu Kontoauszug-PDF-Pfad (`in-kontoauszug` → `ocr-auszug`
  → match.transaktionen ∨ Bank-Feed). RecipeFit robust gemacht: fittet erst bei
  realer Containergröße (bind:clientWidth), refittet bei Resize; Canvas per
  `{#key recipe.id}` je Rezept frisch. 8 Tests / 225 Assertions grün; Suite
  58/58; im Preview verifiziert (Hauptflow, Subflow-Drill-down, ∨-Ports,
  LLM-Chips).

- `2026-08-14` — Build direkt aus dem Gespräch (User-Spec: Sub-Tab, n+1 In/Out,
  actor-artige Steps mit eigener Transformation, JSON-Configs, Svelte-Flow-UI,
  Engine später). Zwei Rendering-Fallen gelöst: fitView vor Node-Vermessung
  (RecipeFit via `useNodesInitialized`) und Default-`minZoom` 0.5, das den
  ~2000px-Graph am Einpassen hinderte (`minZoom={0.15}`). Alle Gates grün;
  im Preview verifiziert. Karte direkt in review/ angelegt.
