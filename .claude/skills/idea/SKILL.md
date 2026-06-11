---
name: idea
description: Ideate — capture a raw thought, task, or spark as a well-formed aven-board idea card, the entry state (backlog) of the spec-driven flow. Creates board/idea/NNNN-slug.md from templates/work-item.md with a scannable title, one-line summary, and a few sentences of Context; leaves goal rough/blank (this is capture, not a spec). Use when someone wants to "capture this", "add to the backlog", "new idea", "ideate", "throw this on the board", "jot this down", "make a card / work item", "log a task" — anything worth remembering but not specced yet. Deliberately small. Hand off to the [[discovery]] skill to uncover the real goal and make it measurable.
---

# Idea — get the spark onto the board (the `idea/` state)

This is the front door of the spec-driven flow. Its only job is to turn a raw
thought into a **well-formed idea card** so nothing is lost — capture, **not**
spec. Read `libs/aven-board/AGENTS.md` once before working the board.

The board lives at `libs/aven-board/board/<column>/*.md` and **the folder is the
state**. The lifecycle is `idea → discovery → goal → review → ship`; new work
starts in `idea/` (the Backlog). Don't over-think it here — a good idea card is
short and scannable. The real thinking happens next, in the [[discovery]] skill,
when the card moves to `discovery/`.

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
     condition later, in [[discovery]]. Don't force one now.
4. **Write a few sentences of Context** — why this exists, the problem or trigger.
   Link related items by id (e.g. `0007-foo`). Keep it short while it's an idea.
5. **Start the Progress log** with one dated line, newest first:
   `- \`YYYY-MM-DD\` — Created in idea.`

## Rules of thumb

- **One item per file.** If the thought hides two tasks, capture two cards (or note
  the split and let [[discovery]] carve it).
- **Short beats complete.** Resist writing the spec here — that's premature
  waterfall. The card just needs to be findable and understandable later.
- **`git mv` later, never delete.** Capture leaves it in `idea/`. Promotion to
  `discovery/` is the [[discovery]] skill's job.

## Hand-off

When the idea is worth doing, promote it with the [[discovery]] skill — interview
to uncover the real goal and make it measurable:

> "Discovery on `idea/NNNN-slug` — let's uncover the goal and turn it into a metric."

## Condensed

1. Next free `NNNN`, lowercase-hyphenated slug, file under `board/idea/`.
2. From `templates/work-item.md`: accurate `title` + `summary`, a few lines of
   Context, dates, `goal` left rough.
3. One Progress-log line. Leave it in `idea/`.
4. Hand to [[discovery]] when it's time to plan.
