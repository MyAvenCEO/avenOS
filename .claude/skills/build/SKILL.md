---
name: build
description: Build an aven-board plan/ item — implement the smallest change that satisfies its acceptance criteria, then git mv it into test/. This is the plan→test transition of the spec-driven flow. Use when someone says "build this item", "implement the plan/spec", "start building NNNN", "code up this work item", "do the plan", or hands you a plan/ card to implement. Requires a card already in plan/ with a measurable goal (if it's still in idea/, use the [[spec]] skill first). Verification + closing the card is the [[ship]] skill's job; the [[board-goal]] command runs build → ship end to end.
---

# Build — implement the spec, move it to `test/` (the build verb)

This skill owns the `plan → test` transition: take a specced work item and write
the **smallest** change that satisfies it. Read `libs/aven-board/AGENTS.md` once
before working the board. The folder a card lives in is its state.

**Precondition:** the item is in `libs/aven-board/board/plan/` and carries a
**measurable goal** plus Acceptance criteria. If it's still in `idea/` (no real
goal yet), stop and run the [[spec]] skill first — building blind is how agents
drift. A `plan/` card is, by contract, buildable without asking questions; if you
*do* have a real question, the spec was incomplete — answer it back into the spec,
don't guess.

## What to do

1. **Read the plan in full** — Context, Goal + Completion condition, Approach,
   Steps, Files to touch, Acceptance criteria, Verification. The goal is the
   single end state you're building toward; the Acceptance criteria are the parts.
2. **`git mv` plan → test when you start writing code**, keeping the `NNNN-` prefix
   so the id stays stable:
   ```sh
   git mv libs/aven-board/board/plan/NNNN-slug.md libs/aven-board/board/test/NNNN-slug.md
   ```
   (Move it as you begin implementing — the board should reflect that it's in
   flight, not finished.)
3. **Implement the smallest change** that satisfies the Acceptance criteria and
   follows the Approach. Touch only the Files to touch unless the spec is wrong —
   if reality contradicts the spec, surface it and update the spec rather than
   silently expanding scope.
4. **Stay agile.** Work in the small, verifiable Steps the spec defines. After each
   meaningful step, check the box it satisfies and append a dated line to the
   `## Progress log` (newest first) so the next agent can pick up cold. Don't batch
   the whole build into one opaque leap.
5. **Match the surrounding code** — its naming, idioms, and comment density. Write
   code that reads like the code already there.
6. **Bump `updated:`** in frontmatter as you touch the file.

## Where to stop

Build ends when the change is **written and the card is in `test/`** — ready for
its own verification. Do **not** declare it done here. Running the Verification
commands, proving the measurable goal from their output, and `git mv`-ing into
`done/` is the [[ship]] skill's job. (If you want the whole thing in one pass, the
[[board-goal]] command resolves the item and runs build → ship together, and
`/goal <completion condition>` loops it across turns.)

## Condensed

1. Confirm the item is in `plan/` with a measurable goal — else [[spec]] it first.
2. Read the plan; `git mv` plan → test as you start coding.
3. Implement the smallest change that meets the Acceptance criteria; touch only the
   listed files.
4. Check boxes + log progress per step; bump `updated`.
5. Stop at "code written, card in `test/`." Hand to [[ship]] to verify and close.
