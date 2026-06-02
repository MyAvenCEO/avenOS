---
title: Example — a planned, spec'd item
summary: What a card looks like once it's specced and ready for an agent to build.
owner: agent
created: 2026-06-02
updated: 2026-06-02
tags: [example, spec]
---

# Example — a planned, spec'd item

## Context

Cards in **plan** are ready to build: they carry a concrete approach and
checkable acceptance criteria, so an agent can pick one up without guessing.

## Approach

Follow `templates/plan.md`: state the strategy, list the files to touch, and
write a test plan before any code is written.

## Steps

1. Read the context and confirm scope.
2. Implement the smallest change that satisfies the acceptance criteria.
3. Update the progress log and move the card to **test**.

## Acceptance criteria

- [ ] Behaviour matches the goal described above
- [ ] Test plan below is green

## Test plan

- Run the project's checks (`bun run check`, `bun run lint`).
- Manually confirm the described behaviour in the app.

## Progress log

- `2026-06-02` — Planned. Example only; delete when you add real work.
