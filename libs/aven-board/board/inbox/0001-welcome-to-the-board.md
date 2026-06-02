---
title: Welcome to the board
summary: How this kanban works — drop ideas in inbox, spec them in plan, let an agent build, verify in test, archive in done.
owner: aven
created: 2026-06-02
updated: 2026-06-02
tags: [meta, guide]
---

# Welcome to the board

This is **aven-board** — a git-based, markdown-first kanban. Every card you see
is a single `.md` file under `libs/aven-board/board/<column>/`. The folder a file
lives in *is* its state. There is no database: git is the single source of truth.

## The flow

1. **Inbox** — Throw any idea or task here. One file, a title, a sentence. Don't overthink it.
2. **Plan** — Spec it. Add a concrete plan and acceptance criteria (see `templates/plan.md`).
3. **Test** — An agent has built it; now verify against the test plan.
4. **Done** — Verified and shipped. Kept as a record.

## How to move a card

Moving a card = moving the file:

```sh
git mv libs/aven-board/board/inbox/0001-welcome-to-the-board.md \
       libs/aven-board/board/plan/0001-welcome-to-the-board.md
```

## How to read a card

Click any card to open the full markdown doc full-screen. The back button is
centered at the bottom.

> New here as an agent? Read `libs/aven-board/AGENTS.md` first.
