---
title: Intents workspace — mocked three-pane UI (list · detail · artifact cluster)
summary: The Intents tab becomes a mail-app-style three-pane workspace (mocked, zero actor/flow imports) in brand cream — left intent cards by type, center the selected intent's story + proposed skill-flow actions, right the cluster of related artifacts. Intent types derived from the private-life/paper-archiving use case.
owner: claude (Opus 4.8)
created: 2026-08-20
updated: 2026-08-20
tags: [intents, ui, mock]
goal: "`bun run check` (from app/) exits 0 and the Intents tab renders a hardcoded three-pane workspace (verified live): left aside = search + intent-type cards (≥6 types incl. pay-invoice, deadline-letter, tax-compilation, statement-reconcile, work-time, free-form request), center = the selected intent's detail (source→classify→intent→actions timeline + proposed skill-flow action cards with mock confirm), right aside = the artifact cluster (source doc, linked todo, calendar entry, person/company, brain entity); selection switches the detail; still zero imports from actors/skills (`rg 'actors/|skills/' app/src/lib/intents` empty)."
---

# Intents workspace — mocked three-pane UI

## Context

From Samuel (interviewed inline): **an intent combines many artifacts and skill/flows to
solve one task.** Primary use case: organize private life automatically — paper archiving
and work-time extraction. Inputs: doc/PDF types (contracts, invoices), free-form
text/prompt/email requests, bank statements, letters-to-resolve (e.g. a health-insurance
letter with a deadline, the 2023 tax return).

**The global (invisible) inbox flow — the north star this UI fronts:**
1. email / doc / pdf / post → ingest → **archive artifact**
2. **classify** artifact types (todo, doc type, calendar entry, person, …)
3. **extract intents**
4. **trigger skill-flows** — mutate todos, calendar entries, brain enrichments

**The standard intents derived from the inputs:**

| Type | Example | Combines |
| --- | --- | --- |
| `bezahlen` | invoice → pay by due date | doc + todo(due, amount) |
| `frist` | insurance letter → respond by deadline | doc + todo + calendar + draft reply (HITL) |
| `steuer` | compile tax return 2023 | MANY docs + statements + long-running collection |
| `abgleich` | reconcile bank statement | statement + invoice matches |
| `arbeitszeit` | extract work times KW | calendar/mails → timesheet |
| `auftrag` | free-form request ("cancel the gym") | email/prompt → decomposed todos |

**Visual reference:** the mail-app screenshot — rounded white cards on soft ground,
left list / center reading pane / right actions — translated to brand cream tokens.
Mock only: hardcoded data, no bus/skills imports (like the current placeholder).

## Acceptance criteria

- [x] Three panes render (left list w/ search, center detail, right cluster), brand cream.
- [x] ≥6 intent-type cards; clicking selects and switches the detail + cluster.
- [x] Center shows the pipeline story (ingested→classified→intent→actions) + proposed
      skill-flow action cards with mock confirm/reject on the HITL one.
- [x] Right cluster: source doc card, todo, calendar entry, person/company, brain entity.
- [x] `bun run check` 0 errors; `rg 'actors/|skills/' app/src/lib/intents` empty.

## Progress log

- `2026-08-20` — Iteration 5 (Samuel): left aside gains "Talk to MAIA" ABOVE the INTENTS
  divider — the generic AI chat (mock transcript: an inline todo-view answer to "zeig mir
  alle offenen Todos", plus a free-form ask MAIA turns into an extracted-intent chip that
  jumps to the intent); done intents fold into a closed-by-default ARCHIV toggle section.
  Global HITL card restyled: full main width, min-height, title/description top-centered,
  Confirm/Reject bottom-centered, INVERTED marine like the voice pill.
- `2026-08-20` — Iteration 4 (Samuel): TEMPLATE ↔ INSTANCE SYNC — the skill flows in the
  intent screen are now the REAL templates from lib/skills/registry (docs/calendar/brain/
  abgleich added as declared SkillDefs → the catalog holds all 6 epic skills); clicking a
  skill renders its actual workflow via SvelteFlow with the SAME FlowNode cards as the
  Skills viewer, instance state overlaid per node (✓ done / amber running / red waiting —
  SkillStatus now carries workflow/done/current instead of a step counter). Brain artifact
  preview is an Obsidian-style markdown note (frontmatter, wikilinks, checkboxes,
  backlinks). PENDING HITL moved into the GLOBAL confirm bar above the voice pill (seeded
  into the real hitlQueue; the log keeps the entry as history with a pointer). The mock now
  deliberately imports the skills templates + hitl queue — instances stay mocked.
- `2026-08-20` — Iteration 3 (Samuel): activity log TYPED per skill (each entry carries
  a clickable skill chip); skill cards match artifact-card roundedness; clicking a skill
  opens its FLOW STEPPER in the center (canonical steps, current position ringed, plus
  the skill's own log lines); artifact preview is full-width — generic header + divider +
  the view on the same bg, no sub-cards. Tabs reordered Intents·Views·Skills (Intents
  default) in the prior iteration. Live-verified.
- `2026-08-20` — Iteration 2 (Samuel): full-width layout for the workspaces (views keeps
  reading width); selected intent card fully INVERTED (navy bg, light text) instead of
  border/ring; left aside compacted to w-72 (same width as the right aside); Skills
  section moved ABOVE Artefakte. Live-verified.
- `2026-08-20` — Iteration (Samuel): `arbeitszeit` intent removed; center rebuilt as an
  ACTIVITY-LOG timeline (status dots on a connector line, timestamps right, rich entries
  as cards — the HITL draft card carries Freigeben/Ablehnen); right aside split into TWO
  categories — Artefakte and **Skills** (per-skill status card: dot + fertig/läuft/wartet +
  where it currently stands). Live-verified, check clean.
- `2026-08-20` — Build → review. Live-verified: 6 intent cards (frist/bezahlen/steuer/abgleich/arbeitszeit/auftrag), selection switches detail+cluster, HITL Freigeben/Ablehnen mock on the waiting action, Anweisung-ergänzen seam. 0 errors, isolation clean.
- `2026-08-20` — Discovery inline (Samuel supplied the model + reference); straight to build.
