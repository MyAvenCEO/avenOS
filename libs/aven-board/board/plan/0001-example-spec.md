---
title: Example — a planned, spec'd item
summary: What a card looks like once it's specced and ready for an agent to build.
owner: agent
created: 2026-06-02
updated: 2026-06-02
tags: [example, spec]
goal: "`bun run check` and `bun run lint` exit 0 and every Acceptance criterion below is checked"
---

# Example — a planned, spec'd item

## Context

Cards in **plan** are ready to build: they carry a concrete approach, a measurable
goal, and checkable acceptance criteria, so an agent can pick one up without guessing.

## Goal

The change is implemented and the project gates are green.

**Completion condition** (hand-off line for `/goal`):

> `bun run check` and `bun run lint` exit 0 and every Acceptance criterion below is checked

## Approach

Follow `templates/plan.md`: state the strategy, list the files to touch, and write
the verification before any code is written.

## Steps

1. Read the context and confirm scope.
2. Implement the smallest change that satisfies the acceptance criteria.
3. Run the verification, update the progress log, and move the card to **test**.

## Acceptance criteria

- [ ] Behaviour matches the goal above — proven by the verification output
- [ ] No unrelated files changed — proven by `git status`

## Verification

```bash
bun run check
bun run lint
```

## Hand-off

```
/board-goal plan/0001-example-spec
```

## Progress log

- `2026-06-02` — Planned. Example only; delete when you add real work.
