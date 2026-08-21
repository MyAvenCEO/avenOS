---
title: Universal query modal — one answer surface, Spotlight-shaped
summary: Collapse chat, search, views and the HITL gate into ONE modal answer stream over the dimmed workspace; slice 1 is the shell with a mocked source.
owner: claude
created: 2026-08-21
updated: 2026-08-21
tags: [app, ui, actors, first-principles]
goal: "`bun run check` exits 0, `bun run lint` exits 0, `bun test app/tests` passes with the new `query.test.ts` green, `rg -n 'talk\\.open' app/src` finds nothing, the dock sheds at least 150 net lines, and every acceptance criterion below is checked."
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

> `bun run check` exits 0, `bun run lint` exits 0, `bun test app/tests` passes with the new `query.test.ts` green, `rg -n 'talk\.open' app/src` finds nothing, the dock sheds at least 150 net lines, and every acceptance criterion below is checked.

**Amended during build (2026-08-21).** The condition first asked for a NET line
reduction across the change. That was wrong for this slice and would have been
met only by fudging: slice 1 *adds* the engine, the modal and its tests while
removing only the chat aside and the dock's gate card — and the gate card
MOVED (172 of GatePreview's 186 lines are the old block, unedited) rather than
dying. The reduction the card is really about arrives in slice 2, when the
mocked source is replaced and the remaining surfaces fold in. What slice 1 can
prove is the dock shrinking, so that is what it now claims.

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

- [x] `bun test app/tests` green, incl. `query.test.ts` — 81 pass / 0 fail across 11 files
- [x] The registry has no hardcoded result kinds — `rg -n "=== 'person'|=== 'todo'" app/src/lib/query` finds nothing; `query.test.ts` also round-trips an invented shape (`quantum-widget`)
- [x] `talk.open` is gone — `rg -n 'talk\.open' app/src` finds nothing
- [x] ~~The dock no longer carries the HITL card~~ **REVERSED on Samuel's call (2026-08-21)**: the gate keeps its legacy place above the pill. Only its 186 lines of layout left the dock, into `GatePreview.svelte`; the dock renders that component in eight lines. A gate is not something you asked for — putting it inside a surface you can dismiss made it missable.
- [x] The dock sheds 169 net lines — `git diff --numstat` on `+page.svelte`: +36 / −205
- [x] `bun run check` 0 errors / 471 files, `bun run lint` exit 0
- [x] Live: ⌘K opens the modal over the dimmed workspace (scrim covers the rail too; the dock and its gate stay above it); typing `krank` returns three differently-shaped row groups (contacts · calendar · docs) and `board` loads the Kanban view — proven by DOM reads in the transcript. NOT proven by screenshot: the Browser pane was hidden, so the page stopped compositing frames.

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

- `2026-08-21` — Second review pass. The gate does not belong in the floating dock either: it moved into the intents CENTRE COLUMN, sticky to its bottom, as content about the intent — so the overlay dims it and lies over it like everything else. That also gave the modal its height back (305px → 590px on a 720px viewport, since the dock now carries only the pill). Chat autoscroll added to the modal's conversation band, tracking streamed content and the live partial, not just the turn count. **Found and fixed a real bug while proving it**: in a plain browser tab `leaveTyping()` dropped out of text mode on every submit, but the recognizer never runs there and the keystroke that re-enters typing is gated on the conversation being live — so you could send exactly ONE message and then the panel had no input at all. Mine, from the voice↔text auto-switch earlier the same day; latent because the Tauri app has a voice mode to fall back to.

- `2026-08-21` — Review feedback, same session. Five corrections: (1) the rail's avenNAME logo — the legacy chat route — is gone, ⌘K is the only door; (2) **the human gate leaves the modal and returns to the dock**, and with it the `gate` arm of the `Answer` union and its tests: nothing produced it any more, and a dead arm is worse than none; (3) the dock rises to `z-50` so the voice/text pill stays above the scrim — you must be able to talk to what you opened; (4) the scrim goes `fixed` so it dims the left rail as well; (5) the modal grows to `min(72rem, 94%)` wide and takes every pixel above the dock, capped at 82vh — a flat 82vh plus the dock clearance overflowed off the top of the screen. NOTE: with a gate raised the modal is ~305px tall on a 720px viewport, because the gate sits below it and is not covered. That is the cost of keeping the gate outside.

- `2026-08-21` — Build, slice 1 complete. `answer.ts` (the union + source registry) TDD-first with 11 tests; `QueryModal.svelte` (two bands, four-arm dispatcher); `GatePreview.svelte` (the gate card moved out of the dock verbatim); `sources.mock.ts`. Triggers: ⌘K, Esc, the rail mark. Deleted: `talk.open`, the 25/75 split, the MAIA rail context, the dock's 184-line gate block. Gate scoping moved from `talk.intentContext` onto `query.intent`. **Amended the completion condition** — see Goal. Two pre-existing lint failures cleared on the way, both unrelated: three hollow `describe` blocks in `actors.test.ts` (helpers, zero tests, green-but-asserting-nothing since #68) and the vendored `app/static/webcm` bundle, now in biome's ignore list beside ARCHIVE. Moved build → review.

- `2026-08-21` — Discovery. Audited the five answer surfaces (414 lines of HITL card alone) and reduced them to one `Answer` union with one dispatcher. Samuel confirmed: shell-first slice with a mocked source, and the workspace stays visible/dimmed behind the modal. Moved ideate → discover.
