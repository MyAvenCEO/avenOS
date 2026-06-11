---
title: Short, action-oriented title
summary: One sentence a human can scan on the card. What is this and why does it matter?
owner: unassigned
created: YYYY-MM-DD
updated: YYYY-MM-DD
tags: [area, kind]
# goal — leave blank or rough in idea; make it a single, measurable,
# transcript-verifiable completion condition before this moves to `discovery`.
goal:
---

# Short, action-oriented title

> Replace this whole file's contents. Keep the frontmatter above accurate — the
> board card reads `title`, `summary`, `tags`, `owner`, `goal`, and dates from it.

## Context

Why this exists. The problem, the trigger, or the idea. Link related items by id
(e.g. `0007-foo`). Keep it to a few sentences while this lives in **idea**.

## Goal

What "good" looks like when this is done. Observable, not vague.

When this moves to **discovery**, sharpen this into a single **completion
condition** that can be proven from command output, and copy it into the
frontmatter `goal` so it can be handed to `/goal` / `/board-goal`. See
`templates/plan.md`.

## Plan

_Filled in when the item moves to **discovery**. See `templates/plan.md` for the
full spec shape — paste its sections here or keep the plan inline._

## Acceptance criteria

Each must be checkable from the transcript (a command + its output proves it).

- [ ] Condition 1 — proven by `…`
- [ ] Condition 2 — proven by `…`

## Progress log

Newest entry first. One line per meaningful step. This is how an agent narrates
what it did so the next agent (or human) can pick up cold.

- `YYYY-MM-DD` — Created in idea.
