# CLAUDE.md — aven-board

The full workflow lives in [`AGENTS.md`](./AGENTS.md). Read it before working the board.

**TL;DR:** This is a git-based kanban. Each work item is one `.md` file under
`board/<column>/`, and **the folder is its state**:

```
inbox/ → plan/ → test/ → done/
```

- **Capture** ideas as `board/inbox/NNNN-slug.md` from `templates/work-item.md`.
- **Spec** them by `git mv` into `board/plan/` and filling out `templates/plan.md`
  (Approach, Acceptance criteria, Test plan).
- **Build**, then `git mv` into `board/test/`.
- **Verify** against the Test plan + `bun run check` / `bun run lint`, then
  `git mv` into `board/done/`.

Always move files with `git mv` (preserve history + id), keep the frontmatter
(`title`, `summary`, `tags`, `owner`, dates) accurate — the board UI reads it —
and append a dated line to each item's `## Progress log` as you go.
