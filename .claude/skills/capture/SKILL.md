---
name: capture
description: Capture a raw thought, task, or idea as a well-formed aven-board idea card — the entry state of the spec-driven flow. Creates board/idea/NNNN-slug.md from templates/work-item.md with a scannable title, one-line summary, and a few sentences of Context; leaves goal rough/blank (capture, not spec). Use when someone wants to "capture this", "add to the backlog", "new idea", "throw this on the board", "jot this down", "make a card / work item", "log a task" — anything that should be remembered but isn't specced yet. Deliberately small. Hand off to the [[spec]] skill to turn the captured idea into a buildable plan with a measurable goal.
---

# Capture — get the idea onto the board (the `idea/` state)

This is the front door of the spec-driven flow. Its only job is to turn a raw
thought into a **well-formed idea card** so nothing is lost — capture, **not**
spec. Read `libs/aven-board/AGENTS.md` once before working the board.

The board lives at `libs/aven-board/board/<column>/*.md` and **the folder is the
state**. New work starts in `idea/` (the Backlog). Don't over-think it here — a
good capture is short and scannable; the real thinking happens later in the
[[spec]] skill when the card moves to `plan/`.

## What to do

1. **Pick the id.** Use the next free 4-digit number across `board/idea/` (look at
   the existing `NNNN-` prefixes and take the next one). Slug it lowercase and
   hyphenated. File: `libs/aven-board/board/idea/NNNN-short-slug.md`.
2. **Start from the template.** Copy `libs/aven-board/templates/work-item.md`.
3. **Fill the frontmatter** the board UI reads:
   - `title` — short, action-oriented (the card heading).
   - `summary` — one sentence a human can scan: *what is this and why does it
     matter?* (the card body).
   - `owner` — `unassigned` unless you know.
   - `created` / `updated` — today's date.
   - `tags` — `[area, kind]` if obvious; skip if not.
   - `goal` — **leave blank or rough.** It becomes a measurable completion
     condition later, in `plan/`. Don't force one now.
4. **Write a few sentences of Context** — why this exists, the problem or trigger.
   Link related items by id (e.g. `0007-foo`). Keep it short while it's an idea.
5. **Start the Progress log** with one dated line, newest first:
   `- \`YYYY-MM-DD\` — Created in idea.`

## Rules of thumb

- **One item per file.** If the thought hides two tasks, capture two cards (or note
  the split and let [[spec]] carve it when planning).
- **Short beats complete.** Resist writing the spec here — that's premature
  waterfall. The card just needs to be findable and understandable later.
- **`git mv` later, never delete.** Don't move it forward yet; capture leaves it in
  `idea/`. Promotion to `plan/` is the [[spec]] skill's job.

## Hand-off

When the idea is worth doing, promote it with the [[spec]] skill — interview to
uncover the real goal, make it measurable, and write the buildable plan:

> "Spec `idea/NNNN-slug` — let's uncover the goal and make it measurable."

## Condensed

1. Next free `NNNN`, lowercase-hyphenated slug, file under `board/idea/`.
2. From `templates/work-item.md`: accurate `title` + `summary`, a few lines of
   Context, dates, `goal` left rough.
3. One Progress-log line. Leave it in `idea/`.
4. Hand to [[spec]] when it's time to plan.
