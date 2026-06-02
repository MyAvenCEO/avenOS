# aven-board — agent instructions

This is the git-based kanban for AvenOS work. **Read this before touching the board.**

Each work item is one markdown file. The **folder it lives in is its state** —
there is no database. Git is the single source of truth.

```
libs/aven-board/board/
  inbox/   ← raw ideas & tasks (aka backlog)
  plan/    ← specced, ready to build (aka spec)
  test/    ← built, awaiting verification (aka review)
  done/    ← verified & shipped
```

## The lifecycle

```
inbox  →  plan  →  test  →  done
(idea)   (spec)   (verify) (archive)
```

Moving a card forward (or back) means **moving the file** with `git mv` so history
is preserved:

```sh
git mv libs/aven-board/board/inbox/0007-thing.md libs/aven-board/board/plan/0007-thing.md
```

Keep the numeric filename prefix stable across moves so the item keeps its id.

## How you (the agent) work the board

### 1. Capture → `inbox/`
- Create `NNNN-short-slug.md` from `templates/work-item.md`.
- Use the next free 4-digit number in the column. Lowercase, hyphenated slug.
- Fill in frontmatter `title` + `summary` (the card shows these) and the Context.
- Keep it short. The inbox is for capture, not specs.

### 2. Spec → `plan/`
- `git mv` the file into `plan/`.
- Expand it using `templates/plan.md`: Approach, Steps, Files to touch,
  **Acceptance criteria**, and a **Verification** block.
- Write a **measurable goal** — a single completion condition provable from
  command output — into the frontmatter `goal` field (see "Goals" below).
- A card in `plan/` must be buildable by another agent without asking questions.

### 3. Build → move to `test/`
- Implement the smallest change that satisfies the acceptance criteria.
- Update the doc as you go (check off criteria, append to the Progress log).
- When the code is written, `git mv` the file into `test/`.

### 4. Verify → `done/`
- Run the item's **Test plan** plus the repo checks (`bun run check`, `bun run lint`).
- If it passes, check the remaining boxes and `git mv` into `done/`.
- If it fails, fix it, or move it back to `plan/` with a note explaining why.

## Frontmatter contract

The board UI reads these fields, so keep them accurate:

```yaml
---
title: Short title              # card heading
summary: One scannable sentence # card body
owner: who-or-which-agent       # optional
created: YYYY-MM-DD             # optional
updated: YYYY-MM-DD             # bump when you touch it
tags: [area, kind]              # optional, inline array
goal: <completion condition>    # the line handed to `/goal` (see below)
---
```

`title` falls back to the first `# H1`, then the humanized filename.
`summary` falls back to the first body paragraph.

## Goals — and handing work to Claude Code

Every item promoted to `plan/` carries a **goal**: one measurable completion
condition that Claude Code's built-in `/goal` loop can work toward. The `/goal`
evaluator reads the **transcript only** — it never runs anything — so the goal
must be provable from command output you actually produce.

- **Good:** `` `bun run check` and `bun run lint` exit 0 and every Acceptance criterion is checked ``
- **Bad:** `fix the board` / `handle all edge cases` (nothing to verify)

Name three things: the **end state**, the **proof** (a command + its expected
result), and the **constraints** that matter (e.g. "no other files changed").

Hand an item to Claude Code with the project command (resolves the item, reads
it, builds + verifies, moves it across columns):

```
/board-goal <item-ref>          # e.g. /board-goal plan/0001-example-spec
```

…or flip on the built-in cross-turn loop directly with the item's condition:

```
/goal <the item's completion condition>
```

The board's full-screen doc view surfaces the goal and a one-click "Copy /goal".

## The Progress log — always update it

Every work item ends with a `## Progress log`. Append a dated one-liner for each
meaningful step, newest first. This is how the next agent picks up cold:

```md
## Progress log
- `2026-06-02` — Moved plan → test; implemented X in `app/src/...`.
- `2026-06-02` — Planned; moved inbox → plan.
- `2026-06-02` — Created in inbox.
```

## Rules of thumb

- One item per file. If an inbox note hides two tasks, split it when planning.
- Never delete a `done/` item to "clean up" — it's the shipped record. Archive instead.
- Don't invent state outside the four folders. The folder is the truth.
- Prefer `git mv` over delete+create so the item keeps its history and id.
- Keep `.gitkeep` files so empty columns survive in git.
