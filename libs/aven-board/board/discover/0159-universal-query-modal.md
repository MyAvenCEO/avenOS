---
title: Universal query modal — one answer surface, Spotlight-shaped
summary: Collapse chat, search, views and the HITL gate into ONE modal answer stream over the dimmed workspace; slice 1 is the shell with a mocked source.
owner: claude
created: 2026-08-21
updated: 2026-08-21
tags: [app, ui, actors, first-principles]
goal: "`bun run check` exits 0, `bun run lint` exits 0, `bun test app/tests` passes with the new `query.test.ts` green, `rg -n 'talk\\.open' app/src` finds nothing, and `git diff --shortstat main` shows a net line reduction — with every acceptance criterion below checked."
---

# Universal query modal — one answer surface, Spotlight-shaped

## Context

Samuel's sketches (2026-08-21) ask to retire the separate "Talk to MAIA" chat
surface and replace it with a modal widget that is *also* the app's default
search component — Spotlight-shaped, but the hits are living views.

The audit says the redesign is smaller than it looks, because the app already
has **five separate surfaces that all mean "the system answered you"**, each
with its own layout code:

| surface | where | lines |
| --- | --- | --- |
| chat transcript | `IntentsPlaceholder` 25% aside (`talk.open`) | ~45 |
| window/view surface | `IntentsPlaceholder` 75% main | ~30 |
| HITL gate card + its 5 preview layouts | `+page.svelte` dock | **414** |
| live transcription toast | `+page.svelte` dock | ~30 |
| activity log / artifact preview | `IntentsPlaceholder` centre | (stays) |

That is the redundancy this card removes. First principles: **there is one
answer stream, and answers have shapes.** A search hit, a rendered kanban
board, a sentence from the model and a human gate are four shapes of one
thing, not four features. Collapsing them gives one `Answer` union with one
dispatcher, and the 414-line HITL block becomes one shape among four.

Related: [[0152]] skills platform (the registry this searches), [[0134]] chat
UI as actor view, [[0130]] the AvenUiView renderer.

## Goal

One modal over the dimmed intent workspace answers everything typed or spoken
— entity hits, whole actor views, prose, and human gates — from one answer
stream, with the selected intent carried as context.

**Completion condition:**

> `bun run check` exits 0, `bun run lint` exits 0, `bun test app/tests` passes with the new `query.test.ts` green, `rg -n 'talk\.open' app/src` finds nothing, and `git diff --shortstat main` shows a net line reduction — with every acceptance criterion below checked.

## Approach

**The one abstraction.** A query produces `Answer[]`, where

```ts
type Answer =
  | { kind: 'rows';  source: string; rows: AnswerRow[] }   // typed entity hits
  | { kind: 'view';  window: string }                      // an actor view, via AvenUiView
  | { kind: 'say';   turn: ChatTurn }                      // prose from the model
  | { kind: 'gate';  held: HeldMessage }                   // a human gate
```

One renderer dispatches on `kind`. The `gate` arm reuses the existing
`HeldPreview` layouts verbatim — they move, they are not rewritten.

**Sources are registered, never switched on.** `AnswerRow` carries
`{ id, source, label, note?, shape }` and each source is a function
`(query, ctx) => AnswerRow[]` registered per skill. Slice 1 ships ONE mocked
source module so the registry is exercised by more than one implementation;
the real per-skill sources are the follow-on. There must be no `if (kind ===
'person')` anywhere — the [[no-hardcoded-vocabulary]] rule applies.

**Layout** (per sketch): a card centred over the workspace, `backdrop-blur`
plus a dimming scrim; the workspace stays rendered behind so the selected
intent stays visible. Top band = answers (scrolls, grows). Bottom band = chat
transcript + the live partial. The voice pill stays where it is, *below and
outside* the card.

**What dies:** `talk.open` and the 25/75 split; the MAIA entry as its own rail
context (the logo button opens the modal instead); the standalone HITL card
layer in the dock.

**Out of scope for this slice:** real per-skill search, model-driven answer
selection (slice 1 routes on a deterministic prefix so it is testable),
artifact attachment to the selected intent, calendar/docs/brain sources.

## Steps

1. `lib/query/answer.ts` — the `Answer`/`AnswerRow` types, the source registry
   (`registerSource`/`runQuery`), and intent context. Pure, no Svelte.
2. `app/tests/query.test.ts` — TDD first: registry fan-out, dedupe, context
   carry, a held message becoming a `gate` answer, no hardcoded kinds.
3. `lib/query/QueryModal.svelte` — the three bands + the `Answer` dispatcher;
   the HITL preview layouts move here from `+page.svelte`.
4. Wire the triggers: ⌘K, Esc, and the pill; scrim over the workspace.
5. Delete `talk.open`, the 25/75 split, the rail's MAIA context, and the dock
   HITL block.
6. **Checkpoint — stop and look.** Then slice 2 wires the real sources.

## Files to touch

- `app/src/lib/query/answer.ts` — new: the answer model + source registry.
- `app/src/lib/query/QueryModal.svelte` — new: the one answer surface.
- `app/src/lib/query/sources.mock.ts` — new: the slice-1 source.
- `app/src/routes/dashboard/+page.svelte` — HITL block and toast move out.
- `app/src/lib/intents/IntentsPlaceholder.svelte` — the talk split comes out.
- `app/src/lib/intents/talk.svelte.ts` — `talk.open` dies; `shell` stays.
- `app/src/routes/dashboard/+layout.svelte` — the logo opens the modal.
- `app/tests/query.test.ts` — new.

## Acceptance criteria

- [ ] `bun test app/tests` green, incl. `query.test.ts` — proven by the run's `0 fail`
- [ ] The registry has no hardcoded result kinds — proven by `rg -n "=== 'person'|=== 'todo'" app/src/lib/query` finding nothing
- [ ] `talk.open` is gone — proven by `rg -n 'talk\.open' app/src` finding nothing
- [ ] The dock no longer carries the HITL card — proven by `rg -c 'HeldPreview|hitlQueue' app/src/routes/dashboard/+page.svelte` finding nothing
- [ ] Net line reduction — proven by `git diff --shortstat main`
- [ ] `bun run check` 0 errors, `bun run lint` exit 0
- [ ] Live: ⌘K opens the modal over the dimmed workspace, a gate renders inside it, the workspace stays visible behind — proven by a screenshot in the transcript

## Verification

```bash
bun run check
bun run lint
bun test app/tests
rg -n 'talk\.open' app/src            # expect: no matches
rg -c 'HeldPreview|hitlQueue' app/src/routes/dashboard/+page.svelte
git diff --shortstat main
```

## Hand-off

```
/aven-build 0159
```

## Progress log

- `2026-08-21` — Discovery. Audited the five answer surfaces (414 lines of HITL card alone) and reduced them to one `Answer` union with one dispatcher. Samuel confirmed: shell-first slice with a mocked source, and the workspace stays visible/dimmed behind the modal. Moved ideate → discover.
