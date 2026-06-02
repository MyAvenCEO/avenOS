# @avenos/aven-board

A git-based, markdown-first **kanban board** for AvenOS. Every work item is a
single `.md` file; the folder it lives in is its state. No database — git is the
single source of truth.

```
inbox/ → plan/ → test/ → done/
(idea)   (spec)   (verify) (archive)
```

Throw any idea or task into `inbox`, spec it in `plan`, let an agent build it, and
verify it in `test` before it lands in `done`.

## Layout

```
aven-board/
├─ board/                 # the work items — single source of truth
│  ├─ inbox/  (backlog)
│  ├─ plan/   (spec)
│  ├─ test/   (review)
│  └─ done/   (shipped)
├─ templates/             # how to write items + plans
│  ├─ work-item.md
│  └─ plan.md
├─ src/                   # the kanban engine + Svelte UI
│  ├─ types.ts            # WorkItem, BoardColumn, column ids
│  ├─ columns.ts          # column metadata
│  ├─ frontmatter.ts      # frontmatter parser
│  ├─ render.ts           # markdown → sanitized HTML (marked + DOMPurify)
│  ├─ work-items.ts       # loads board/<col>/*.md via import.meta.glob
│  ├─ BoardView.svelte    # the kanban (4 columns)
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

## Working the board

See **[AGENTS.md](./AGENTS.md)**. In short: create items in `inbox/` from
`templates/work-item.md`, move them forward with `git mv`, keep frontmatter
accurate, and append to each item's `## Progress log`.
