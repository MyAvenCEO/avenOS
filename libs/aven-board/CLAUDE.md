# CLAUDE.md — aven-board

The full workflow lives in [`AGENTS.md`](./AGENTS.md). Read it before working the board.

**TL;DR:** This is a git-based kanban. Each work item is one `.md` file under
`board/<column>/`, and **the folder is its state**:

```
idea/ → plan/ → test/ → done/
```

- **Capture** ideas as `board/idea/NNNN-slug.md` from `templates/work-item.md`.
- **Spec** them by `git mv` into `board/plan/` and filling out `templates/plan.md`
  (Approach, Acceptance criteria, Test plan).
- **Build**, then `git mv` into `board/test/`.
- **Verify** against the Test plan + `bun run check` / `bun run lint`, then
  `git mv` into `board/done/`.

Always move files with `git mv` (preserve history + id), keep the frontmatter
(`title`, `summary`, `tags`, `owner`, `goal`, dates) accurate — the board UI reads
it — and append a dated line to each item's `## Progress log` as you go.

**Goal-driven hand-off:** every `plan/` item has a `goal` — one measurable
completion condition provable from command output (the built-in `/goal` evaluator
reads only the transcript). Hand an item to Claude Code with:

```
/board-goal <item-ref>     # resolves the item, builds + verifies, moves columns
/goal <completion condition>  # or flip on the built-in cross-turn loop directly
```
