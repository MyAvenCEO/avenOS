---
title: FiBu-Tab — Rechnungsposition → Buchungszeilen (hardcoded Svelte)
summary: Read-only Beispielansicht der untersten Buchungs-Primitive (Position → 1..n Buchungszeilen) als neuer Dashboard-Tab, mit dem Event-Agentur-Härtetest als Mock-Daten.
owner: samuel + claude
created: 2026-08-12
updated: 2026-08-14
tags: [fibu, app, ui]
goal: "`bun test app/tests/fibu-mock.test.ts`, `bun run check` und `bun run lint` exit 0; der Test beweist Soll=Haben & Positionssummen für alle Mock-Rechnungen; neuer Dashboard-Tab »Buchhaltung« rendert das Master-Detail (Screenshot im Transcript); keine Änderungen an actors/vibes außer den 3 Tab-Edits in dashboard/+page.svelte"
---

# FiBu-Tab — Rechnungsposition → Buchungszeilen (hardcoded Svelte)

## Context

Wir bauen eigene FiBu-Software für GmbHs (DATEV ersetzen, LLM bucht vor → HITL).
Die zentrale Architekturlehre aus der Recherche: **Rechnungsposition → 1..n
Buchungszeilen, Buchungszeile → 1..n Auswertungen — beides n:m.** Die
Verarbeitungseinheit ist die Position, nicht die Rechnung.

Bevor irgendetwas an Engine/Actors gebaut wird, wollen wir diese unterste
Primitive **sehen**: eine hardcoded Svelte-Ansicht mit Beispieldaten, bewusst
**unabhängig von der Actor-/Vibe-Architektur** (kein `@avenos/aven-ui`, kein
QuickJS-Face — plain Svelte + Tailwind-Tokens aus `app.css`).

Stand der App (nach 0121-Strip + Merge von `claude/game-subroute-dashboard-selector-73256b`):

- Tabs sind hardcoded in `app/src/routes/dashboard/+page.svelte`:
  Union `'views' | 'actors' | 'chat'` (Zeile ~40), Inline-Tab-Array (~179),
  `{:else if}`-Branches (~195ff). Neuer Tab = genau diese 3 Edits.
- Pattern-Vorbild für eine tab-mounted hardcoded Komponente: `app/src/lib/actors/ActorExplorer.svelte`.
- Styling über Tailwind-v4-Semantik-Tokens in `app/src/app.css`
  (`bg-surface-card`, `border-border`, `text-foreground`, `font-display`, …).
- Alte FiBu-UI wurde in `53cfa8a6` gestrippt; verwandte Karten: 0069, 0072, 0073, 0098.

Beispieldaten = das durchgerechnete Beispiel aus dem FiBu-Kontextdokument
(Eingangsrechnung Event-Agentur, 5.735,00 € brutto, Skonto 2 %/10 Tage):

| Position | netto | Satz | USt |
|---|---|---|---|
| Raummiete | 2.000,00 | 19 % | 380,00 |
| Catering (Bewirtung) | 1.500,00 | 19 % | 285,00 |
| Übernachtung Referenten | 800,00 | 7 % | 56,00 |
| Werbegeschenke 10 × 60 € | 600,00 | 19 % | 114,00 |

→ 7 Buchungszeilen: Raumkosten 2.000,00 · Bewirtung 70 % 1.050,00 · Bewirtung
30 % n. abz. 450,00 · Reisekosten Übernachtung 800,00 · Geschenke > 50 € n. abz.
714,00 (USt wird Anschaffungskosten!) · Vorsteuer 19 % 665,00 · Vorsteuer 7 %
56,00 — Haben: Verb. L&L 5.735,00. Dazu 2–3 triviale 1-Positions-Rechnungen
(z. B. SaaS-Abo 19 %, Hosting Reverse-Charge-frei einfach gehalten oder zweite
Inlandsrechnung), damit die Liste realistisch wirkt.

## Goal

Ein neuer read-only Dashboard-Tab »Buchhaltung« zeigt Eingangsrechnungen als
Master-Detail: Rechnung → Positionen → abgeleitete Buchungszeilen, mit sichtbarer
Soll=Haben-Balance und Begründung (§-Verweis) pro Zeile — komplett aus hardcoded,
typisierten Mock-Daten.

**Completion condition** (identisch zum Frontmatter-`goal`):

> `bun test app/tests/fibu-mock.test.ts`, `bun run check` und `bun run lint`
> exit 0; der Test beweist Soll=Haben & Positionssummen für alle Mock-Rechnungen;
> neuer Dashboard-Tab »Buchhaltung« rendert das Master-Detail (Screenshot im
> Transcript); keine Änderungen an actors/vibes außer den 3 Tab-Edits in
> `dashboard/+page.svelte`.

## Approach

Plain-Svelte-Vertikale ohne Actor-Bus:

1. **Datenmodell** in `app/src/lib/fibu/mock-data.ts` — bewusst minimal, aber
   die n:m-Lehre tragend:
   - `Rechnung { id, lieferant, belegdatum, brutto, skontoHinweis?, positionen: Position[], buchungszeilen: Buchungszeile[] }`
   - `Position { id, bezeichnung, netto, ustSatz, ust, kategorie }`
   - `Buchungszeile { konto, seite: 'soll' | 'haben', betrag, positionIds: string[], begruendung }`
   - `positionIds` als Array (nicht Single-Ref): die Verbindlichkeits-Zeile
     referenziert alle Positionen, die 70/30-Splits referenzieren dieselbe
     Position zweimal → n:m sichtbar im Typ.
   - Beträge als Integer-Cents, Anzeige über `Intl.NumberFormat('de-DE')`.
   - `begruendung` trägt den §-Verweis (»70/30 § 4 Abs. 5 Nr. 2 EStG«,
     »§ 15 Abs. 1a UStG — VSt nicht abziehbar, brutto aktiviert«) — Lehre aus
     dem Automation-Bias-Kapitel: Begründung statt grünem Häkchen.
2. **View** `app/src/lib/fibu/FibuExplorer.svelte` (Pattern: `ActorExplorer.svelte`):
   Rechnungsliste links/oben, aufgeklappte Rechnung zeigt Positionen-Tabelle und
   darunter den Buchungssatz als Soll/Haben-Tabelle; Hover/Selektion einer
   Position hebt ihre Buchungszeilen hervor (die eine echte Interaktion, rein
   visuell); Fußzeile mit Soll- und Haben-Summe. Read-only, kein HITL, keine Edits.
3. **Tab-Registrierung**: 3 Edits in `app/src/routes/dashboard/+page.svelte`
   (Union + Tab-Array-Eintrag `{ id: 'fibu', label: 'Buchhaltung' }` + Branch).
4. **Invarianten-Test** `app/tests/fibu-mock.test.ts` (bun test): pro Rechnung
   Σ Soll = Σ Haben = brutto; pro Position netto + USt konsistent zum Satz;
   jede Buchungszeile referenziert existierende Positionen; der Härtetest hat
   exakt 7 Zeilen und die Kz-66-relevante Vorsteuer ist 665,00 + 56,00 (die
   114 € Geschenke-USt taucht in keiner Vorsteuer-Zeile auf).

**Out of scope** (Folge-Cards in ideate/, wenn gewünscht): HITL-Freigabe/Korrektur,
Editierbarkeit, Persistenz/Predications, Skonto-Zahlungsbuchung, echter
Kontenrahmen/Mapping-Objekt, UStVA/BWA/E-Bilanz-Auswertungssichten,
Actor-/Vibe-Integration.

## Steps

1. `mock-data.ts` mit Typen + Härtetest-Rechnung + 2–3 einfachen Rechnungen;
   `fibu-mock.test.ts` grün. *(Checkpoint: Test-Output zeigen)*
2. `FibuExplorer.svelte` read-only Master-Detail mit Tokens aus `app.css`.
3. Tab in `dashboard/+page.svelte` registrieren; Preview-Screenshot.
4. `bun run check` + `bun run lint` grün; Karte → review.

## Files to touch

- `app/src/lib/fibu/mock-data.ts` — neu: Typen + Beispieldaten (Integer-Cents).
- `app/src/lib/fibu/FibuExplorer.svelte` — neu: read-only Master-Detail-View.
- `app/tests/fibu-mock.test.ts` — neu: Balance-/Konsistenz-Invarianten.
- `app/src/routes/dashboard/+page.svelte` — 3 Tab-Edits (Union, Array, Branch).

## Acceptance criteria

- [x] `bun test app/tests/fibu-mock.test.ts` exit 0 — beweist Σ Soll = Σ Haben =
      brutto je Rechnung, Positions-USt-Konsistenz, 7 Zeilen im Härtetest,
      abziehbare Vorsteuer = 72.100 Cent (665,00 + 56,00).
      *Evidenz: 5 pass / 0 fail, 65 expect() calls.*
- [x] Härtetest-Buchungszeilen enthalten die Splits 1.050,00 / 450,00 und
      714,00 mit §-Begründung — proven by Test-Assertions + `git diff`.
      *Evidenz: Assertions `[45000, 105000]` + `71400` grün; Begründungen in
      `mock-data.ts`.*
- [x] Neuer Tab »Buchhaltung« rendert die Ansicht — proven by Screenshot aus dem
      Browser-Preview im Transcript. *Evidenz: Screenshots Härtetest (Positionen
      + 8-Zeilen-Buchungssatz, Fußzeile »Soll = Haben ✓«), Hetzner (3 Zeilen),
      Hover auf Catering hebt beide 70/30-Zeilen hervor, andere gedimmt. Keine
      Console-Errors.*
- [x] `bun run check` und `bun run lint` exit 0. *Evidenz: check 454 FILES
      0 ERRORS; lint »Checked 158 files. No fixes applied« exit 0; dazu volle
      Suite `bun test app/tests` 50 pass / 0 fail.*
- [x] `git diff --stat` zeigt nur die 4 genannten Dateien (+ diese Karte) —
      **Abweichung, siehe Progress log:** zusätzlich 5 Dateien mit reinen
      Lint-Baseline-Fixes, die der Merge von
      `claude/game-subroute-dashboard-selector-73256b` mitbrachte; ohne sie kann
      `bun run lint` nicht exit 0 liefern. Keine Verhaltensänderung: ungenutzte
      Importe entfernt (`bus.ts`, `+page.svelte`), Template-Literals + 
      biome-ignore für den QuickJS-Hook `initState` (`vibes/chat/logic.js`),
      Optional-Chains (Website-Slug-Guards), `last`-Guard statt unsicherem
      Optional-Chaining (`actors.test.ts`).

## Verification

```bash
bun test app/tests/fibu-mock.test.ts
bun run check
bun run lint
git diff --stat
```

## Hand-off

```
/aven-build 0139
```

…oder direkt:

```
/goal `bun test app/tests/fibu-mock.test.ts`, `bun run check` und `bun run lint` exit 0; Test beweist Soll=Haben & Positionssummen; Tab »Buchhaltung« rendert das Master-Detail (Screenshot); nur die 4 genannten Dateien geändert
```

## Progress log

- `2026-08-14` — Umnummeriert 0131 → 0139: beim Merge der Fibu-Arbeit in die Actor-Linie kollidierten die Nummern (0131/0132 waren dort bereits vergeben und aus vier Quelldateien referenziert). Inhalt unverändert; Code-Kommentare mitgezogen.
- `2026-08-14` — Spacing-Iteration: einheitliches 8px-Raster für alle Abstände
  (`gap-2`/`p-2` am Dashboard-`main`, `-mt-2` am Voice-Panel entfernt,
  Toast-Streifen im FiBu-Tab per `{#if}` ganz entfernt statt kollabiert,
  Detail-Panel innen `gap-2 p-2`). Per JS im Preview gemessen: Fensterkante→Tabs,
  Tabs→View, View→Voice-Panel alle exakt 8 px. Gates grün (lint exit 0,
  50/50 Tests).
- `2026-08-14` — Layout-Iteration nach Test in der Mac-App (Samuel): Inbox-Stil —
  volle Fensterbreite nur im FiBu-Tab (`max-w-none` konditional in
  `dashboard/+page.svelte`), Aside `w-80` mit flachen Listenzeilen +
  Trennlinien statt Karten, Detailbereich als eigene Fläche; Toast-Reservestreifen
  (`min-h-16`) wird im FiBu-Tab kollabiert, damit die Unterkante direkt über dem
  Voice-Panel sitzt. Gates grün (check 0 Errors, biome clean); im Browser
  verifiziert: internes Scrollen der Detailspalte bis zur Fußzeile
  »Soll = Haben ✓«.

- `2026-08-12` — Build: `mock-data.ts` (4 Rechnungen, Integer-Cents, n:m
  `positionIds`), `FibuExplorer.svelte` (Master-Detail, Hover-Highlight),
  Tab »Buchhaltung« in `dashboard/+page.svelte`, `fibu-mock.test.ts` (5 Tests,
  65 Assertions, grün). Gates grün: check 0 Errors, lint exit 0,
  `bun test app/tests` 50/50. Browser-Preview verifiziert (Härtetest, Hetzner,
  Hover, Fußzeile »Soll = Haben ✓«, keine Console-Errors). **Scope-Abweichung:**
  der zuvor gemergte Branch brachte Lint-Fehler mit — mechanisch bereinigt in
  `app/src/lib/actors/bus.ts`, `app/tests/actors.test.ts`,
  `libs/aven-ui/src/vibes/chat/logic.js` (biome-ignore: `initState` wird per
  Name in der QuickJS-Sandbox aufgerufen, `app/src/lib/actors/sandbox.ts:60`),
  2× Website-Slug-Guards. Außerdem `.claude/launch.json`: Eintrag
  `fibu-preview` (autoPort). Moved build → review.
- `2026-08-12` — Discovery: Interview geführt (Master-Detail Position→Zeilen,
  Härtetest + einfache Rechnungen, read-only v1, neuer Dashboard-Tab). Spec
  geschrieben, Karte direkt in discover/ angelegt. Vorher Branch
  `claude/game-subroute-dashboard-selector-73256b` in den Worktree gemerged
  (fast-forward auf `5586b54d`).
