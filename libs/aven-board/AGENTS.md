# aven-board — agent instructions

This is the git-based kanban for AvenOS work. **Read this before touching the board.**

Each work item is one markdown file. The **folder it lives in is its state** —
there is no database. Git is the single source of truth.

```
libs/aven-board/board/
  ideate/    ← raw ideas & tasks (aka backlog)
  discover/  ← being specced: uncover the goal, make it measurable
  build/     ← has a measurable goal; being built toward it
  review/    ← built & measured; awaiting human verification (HITL)
  ship/      ← released to all targets & pushed to main (archive)
```

## The lifecycle

```
ideate  →  discover  →  build  →  review  →  ship
(backlog)  (spec)       (execute) (evaluate) (release+archive)
```

Moving a card forward (or back) means **moving the file** with `git mv` so history
is preserved:

```sh
git mv libs/aven-board/board/ideate/0007-thing.md libs/aven-board/board/discover/0007-thing.md
```

Keep the numeric filename prefix stable across moves so the item keeps its id.

## A skill per state

Each board state has a dedicated skill that owns the work of that state (the
spec-driven method, end to end). Invoke with `/<name>`:

| State | Skill | What it does |
| --- | --- | --- |
| `ideate/` | **`/ideate`** | Capture a raw thought as a well-formed idea card. |
| `discover/` | **`/discover`** | Interview to uncover the real goal and make it **measurable**. |
| `build/` | **`/build`** | Take the measurable metric and **execute** the smallest change. |
| `review/` | **`/review`** | Evaluate the work against the metric; bubble to a human (HITL). |
| `ship/` | **`/ship`** | Release to all targets + push to main, then archive the record. |

The `build` state pairs with Claude Code's built-in **`/goal`** cross-turn loop,
which drives toward a transcript-provable completion condition. Each state has a
typed entry point in the input field: `/aven-ideate`, `/aven-discover`,
`/aven-build`, `/aven-review`, `/aven-ship` (thin commands that invoke the
skills). Chain them to move a card across columns.

## How you (the agent) work the board

### 1. Capture → `ideate/`  *(skill: `/ideate`)*
- Create `NNNN-short-slug.md` from `templates/work-item.md`.
- Use the next free 4-digit number in the column. Lowercase, hyphenated slug.
- Fill in frontmatter `title` + `summary` (the card shows these) and the Context.
- Keep it short. The idea is for capture, not specs.

### 2. Discover → `discover/`  *(skill: `/discover`)*
- `git mv` the file into `discover/`.
- Interview to uncover the real **goal** (the decision the work drives, not the
  task), then expand the doc using `templates/plan.md`: Approach, Steps, Files to
  touch, **Acceptance criteria**, and a **Verification** block.
- Write a **measurable goal** — a single completion condition provable from
  command output — into the frontmatter `goal` field (see "Goals" below).
- A card leaving `discover/` must be executable by another agent without asking
  questions.

### 3. Build → `build/`  *(skill: `/build`)*
- `git mv` the file into `build/` when you start executing.
- Implement the smallest change that satisfies the acceptance criteria.
- Update the doc as you go (check off criteria, append to the Progress log).
- When the code is written, `git mv` the file into `review/`.

### 4. Review → `review/`  *(skill: `/review`)*
- Run the item's **Verification** plus the repo checks (`bun run check`,
  `bun run lint`). Their output is the proof the metric refers to.
- Annotate each Acceptance criterion with its evidence, then **bubble a clear
  pass/fail verdict to a human** — review measures, the human verifies (HITL).
- If it fails, `git mv` it back to `build/` (re-execute) or `discover/` (re-spec)
  with a note explaining why.

### 5. Ship → `ship/`  *(skill: `/ship`)*
- Once a human has approved the review verdict, **release** (human-triggered):
  push/merge to remote `main`, deploy the server (`bun run deploy:server:sprite`),
  and release the apps (`bun run release:app:all <build#>` → macOS `.pkg` + iOS
  `.ipa`). These are outward-facing, credentialed, irreversible — never run them
  autonomously.
- Then check the final boxes, append to the Progress log, bump `updated:`, and
  `git mv` the file into `ship/`.
- A `ship/` item is the shipped record — never delete it to "clean up".

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

Every item promoted out of `ideate/` carries a **goal**: one measurable completion
condition that Claude Code's built-in `/goal` loop can work toward. The `/goal`
evaluator reads the **transcript only** — it never runs anything — so the goal
must be provable from command output you actually produce.

- **Good:** `` `bun run check` and `bun run lint` exit 0 and every Acceptance criterion is checked ``
- **Bad:** `fix the board` / `handle all edge cases` (nothing to verify)

Name three things: the **end state**, the **proof** (a command + its expected
result), and the **constraints** that matter (e.g. "no other files changed").

Hand an item to its state command (the skill resolves the item, reads it, does
that state's work, and moves the card forward):

```
/aven-build <item-ref>          # e.g. /aven-build 0001 — execute, move build → review
/aven-review <item-ref>         # evaluate against the metric, bubble to human
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
- `2026-06-02` — Moved discover → build; implemented X in `app/src/...`.
- `2026-06-02` — Discovery: uncovered the goal, made it measurable; moved ideate → discover.
- `2026-06-02` — Created in ideate.
```

## Rules of thumb

- One item per file. If an idea note hides two tasks, split it during discovery.
- Never delete a `ship/` item to "clean up" — it's the shipped record. Archive instead.
- Don't invent state outside the five folders. The folder is the truth.
- Prefer `git mv` over delete+create so the item keeps its history and id.
- Keep `.gitkeep` files so empty columns survive in git.
