---
title: <work item title>
summary: <one-line summary>
owner: <who/which agent will build this>
created: YYYY-MM-DD
updated: YYYY-MM-DD
tags: [area, kind]
# goal — the SINGLE completion condition Claude Code's built-in `/goal` works toward.
# It must be provable from command output in the transcript (exit codes, test output,
# git status). One end state + how to prove it + the constraints that matter.
# Good:  "`bun run check` and `bun run lint` exit 0 and the acceptance criteria below are all checked"
# Bad:   "fix the board" / "handle all edge cases"  (nothing to verify)
goal: <one measurable, transcript-verifiable completion condition>
---

# <work item title>

## Context

The problem and any constraints. Link related work items by id. Carry over the
relevant parts of the idea note so this doc stands alone.

## Goal

One sentence: the observable outcome when this is done.

**Completion condition** (the hand-off line for `/goal` — keep it identical to the
frontmatter `goal`):

> `<one measurable, transcript-verifiable completion condition>`

A good condition names three things: the **end state**, the **proof** (a command and
its expected result), and the **constraints** that matter (e.g. "no other files
changed"). The `/goal` evaluator only reads the transcript, so every part must show
up as command output — never write a goal that can't be proven by running something.

## Approach

The chosen strategy in prose. Name the key files/modules that will change and the
shape of the change. Call out trade-offs and anything explicitly out of scope.

## Steps

1. Step one — small, verifiable.
2. Step two.
3. …

## Files to touch

- `path/to/file` — what changes and why.

## Acceptance criteria

Each box must be checkable from the transcript (a command + its output proves it).

- [ ] Condition 1 — proven by `…`
- [ ] Condition 2 — proven by `…`

## Verification

The exact commands to run; their output is the proof the `/goal` evaluator reads.

```bash
bun run check   # svelte-kit sync + svelte-check + docs word count
bun run lint    # biome
# + any item-specific tests, e.g. `bun test app/tests`
```

## Hand-off

Pick this up with the board command (resolves the item, loads it, drives it):

```
/board-goal <item-ref>
```

…or hand the condition straight to the built-in goal loop:

```
/goal <paste the Completion condition above>
```

## Progress log

Newest entry first.

- `YYYY-MM-DD` — Discovery: uncovered the goal, made it measurable. Moved ideate → discover.
