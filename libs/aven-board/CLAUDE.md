# CLAUDE.md — aven-board

The full workflow lives in [`AGENTS.md`](./AGENTS.md). Read it before working the board.

**TL;DR:** This is a git-based kanban. Each work item is one `.md` file under
`board/<column>/`, and **the folder is its state**. Each state has a skill
(`/<name>`):

```
ideate/ → discover/ → build/ → review/ → ship/
```

- **`/ideate`** — capture ideas as `board/ideate/NNNN-slug.md` from `templates/work-item.md`.
- **`/discover`** — `git mv` into `board/discover/`, interview to uncover the real
  goal, make it **measurable**, and fill out `templates/plan.md` (Approach,
  Acceptance criteria, Verification).
- **`/build`** — execute the smallest change; `git mv` into `board/review/` when built.
- **`/review`** — run the Verification + `bun run check` / `bun run lint`, measure
  against the goal, and bubble a pass/fail verdict to a human (HITL).
- **`/ship`** — on human approval, release to all targets (push to main, deploy
  server, release Mac + iOS apps), then `git mv` into `board/ship/` as the record.

Always move files with `git mv` (preserve history + id), keep the frontmatter
(`title`, `summary`, `tags`, `owner`, `goal`, dates) accurate — the board UI reads
it — and append a dated line to each item's `## Progress log` as you go.

**Goal-driven hand-off:** every item past `ideate/` has a `goal` — one measurable
completion condition provable from command output (the built-in `/goal` evaluator
reads only the transcript). Hand an item to Claude Code with:

```
/aven-build <item-ref>        # execute toward the goal, move build → review
/aven-review <item-ref>       # evaluate the metric, bubble to human sign-off
/goal <completion condition>  # or flip on the built-in cross-turn loop directly
```
