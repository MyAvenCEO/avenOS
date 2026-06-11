# @avenos/aven-board

A git-based, markdown-first **kanban board** for AvenOS. Every work item is a
single `.md` file; the folder it lives in is its state. No database — git is the
single source of truth.

```
ideate/ → discover/ → build/ → review/ → ship/
(backlog)  (spec)      (execute) (evaluate) (release+archive)
```

Throw any idea or task into `ideate`, spec it into a **measurable goal** in
`discover`, execute it in `build`, evaluate it against the metric in `review`
(human-verified, HITL), and release + archive it in `ship`. Each state has a
skill: `/ideate`, `/discover`, `/build`, `/review`, `/ship`.

## Layout

```
aven-board/
├─ board/                 # the work items — single source of truth
│  ├─ ideate/     (backlog)
│  ├─ discover/   (spec — uncover + measure the goal)
│  ├─ build/      (execute toward the metric)
│  ├─ review/     (evaluate; human-verified, HITL)
│  └─ ship/       (released to all targets / archive)
├─ templates/             # how to write items + plans
│  ├─ work-item.md
│  └─ plan.md
├─ src/                   # the kanban engine + Svelte UI
│  ├─ types.ts            # WorkItem, BoardColumn, column ids
│  ├─ columns.ts          # column metadata
│  ├─ frontmatter.ts      # frontmatter parser
│  ├─ render.ts           # markdown → sanitized HTML (marked + DOMPurify)
│  ├─ work-items.ts       # loads board/<col>/*.md via import.meta.glob
│  ├─ BoardView.svelte    # the kanban (5 columns)
│  ├─ BoardColumn.svelte
│  ├─ BoardCard.svelte    # title + summary card
│  └─ WorkItemDoc.svelte  # full-screen doc + bottom-center back button
├─ AGENTS.md              # how AI agents drive the board (read this first)
└─ CLAUDE.md              # short pointer for Claude Code
```

## Usage

```svelte
<script lang="ts">
  import { BoardView, getBoardColumns, boardItemHref } from '@avenos/aven-board'
  const columns = getBoardColumns()
</script>

<BoardView {columns} onOpen={(item, e) => goto(boardItemHref(item))} />
```

Items are loaded at build time via Vite `import.meta.glob`, so in dev the board
hot-reloads as you add, edit, or `git mv` files, and a Tauri build bakes in the
current board state.

## Goal-driven hand-off

Every item past `ideate/` carries a **`goal`** in its frontmatter: one measurable
completion condition, provable from command output. That makes items compatible
with Claude Code's built-in `/goal` loop, and with the project command:

```
/aven-build <item-ref>          # execute toward the goal, move the card build → review
/aven-review <item-ref>         # evaluate against the metric, bubble to human sign-off
/goal <completion condition>    # or flip on the built-in cross-turn loop directly
```

The per-state commands live at `.claude/commands/aven-*.md` (thin entry points
into the skills), and the full-screen doc view surfaces the goal with a
one-click "Copy /goal".

## Working the board

See **[AGENTS.md](./AGENTS.md)**. In short: create items in `ideate/` from
`templates/work-item.md`, move them forward with `git mv` (`ideate → discover →
build → review → ship`), keep frontmatter accurate (`title`, `summary`, `tags`,
`owner`, `goal`, dates), and append to each item's `## Progress log`.
