---
description: Pick up an aven-board work item and drive it to its measurable goal.
argument-hint: <item-ref — slug, filename, or column/slug, e.g. goal/0001-example-spec>
allowed-tools: Bash, Read, Edit, Glob, Grep
---

You are picking a work item off the **aven-board** kanban and driving it to ship.
The board lives at `libs/aven-board/board/<column>/*.md` (columns: `idea`,
`discovery`, `goal`, `review`, `ship`); the folder a file sits in is its state.
Read `libs/aven-board/AGENTS.md` for the full workflow before acting.

## Requested item

`$ARGUMENTS`

## Candidate files

!`find libs/aven-board/board -type f -name '*.md' | grep -i -- "$ARGUMENTS" 2>/dev/null || echo "(no filename match — list libs/aven-board/board/ yourself and pick)"`

## What to do

1. **Resolve** the reference to exactly one work-item file. If it's ambiguous,
   list the candidates and ask which one. If you can't find it at all, say so.
2. **Read** the file in full.
   - If it's in `idea/`, it isn't specced yet — it has no real `goal`. Stop and
     run discovery first (turn it into a spec with `templates/plan.md`, uncover a
     measurable goal, `git mv` it to `discovery/`), rather than building blind.
3. **Find the completion condition** — the frontmatter `goal` field (mirrored in
   the `## Goal` section). This is the single, transcript-verifiable end state.
   If it's missing or vague (not provable from command output), sharpen it first
   and write it back into the file.
4. **Execute it.** Implement the smallest change that satisfies the Acceptance
   criteria and Approach. When you start implementing, `git mv` the file from
   `discovery/` (or `goal/`) into `goal/`, then into `review/` once it's built
   (preserve the `NNNN-` prefix so the id is stable).
5. **Review** by running the item's `## Verification` commands plus the repo gates
   (`bun run check`, `bun run lint`). Run them for real so the output — the proof
   the goal condition refers to — is in the transcript, then present a clear
   pass/fail verdict.
6. **Close the loop (HITL).** When the completion condition is met: check off the
   Acceptance criteria, append a dated line to the `## Progress log`, bump
   `updated:` in frontmatter, and — once a human has verified the verdict —
   `git mv` the file to `ship/`. If verification fails and you can't fix it in
   scope, move it back to `goal/` or `discovery/` with a note in the progress log
   explaining why.

## Goal-driven autonomy

This command does the work in-session. To let Claude Code keep iterating across
turns on its own until the condition holds, the human can flip on the built-in
goal loop with the item's completion condition:

```
/goal <the item's completion condition>
```

So, after you resolve the item, **print its completion condition as a ready-to-run
`/goal …` line** so the human can enable that loop if they want it. Keep the
condition provable from command output — the `/goal` evaluator only reads the
transcript, never runs anything itself.
