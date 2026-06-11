---
name: build
description: Build toward a measurable goal — take the metric produced by discovery and implement the smallest change that satisfies it, then git mv the card from build/ into review/. This is the execution state of the spec-driven flow. Use when someone says "build NNNN", "build toward the goal", "implement the spec", "execute this item", "drive this to its metric", "do the plan", or hands you a build/ (or discover-specced) card to implement. Requires a card with a measurable goal (if it's still raw, run the [[discover]] skill first). Pairs with Claude Code's built-in /goal cross-turn loop and the [[board-goal]] command; evaluation + human sign-off is the [[review]] skill's job.
---

# Build — execute toward the measurable metric (the `build/` state)

This skill owns **execution**: take the measurable goal that [[discover]] produced
and build the **smallest** change that satisfies it. Read
`libs/aven-board/AGENTS.md` once before working the board. The folder a card lives
in is its state; lifecycle is `ideate → discover → build → review → ship`.

**Precondition:** the card carries a **measurable goal** — one completion
condition provable from command output — plus Acceptance criteria, and is in
`libs/aven-board/board/build/` (or being promoted there from `discover/`). If
there's no provable metric yet, stop and run [[discover]] first; building without
a measurable goal is how agents drift. A build-ready card is, by contract,
buildable without asking questions — if you *do* have a real question, the spec
was incomplete, so answer it back into the spec rather than guessing.

The metric is your target the whole way through. Claude Code's built-in **`/goal`
loop** is the engine that drives toward exactly this kind of transcript-provable
condition across turns — this skill is the board-state discipline around it, and
the [[board-goal]] command composes build → review end to end.

## What to do

1. **Read the spec in full** — Context, Goal + Completion condition, Approach,
   Steps, Files to touch, Acceptance criteria, Verification. The goal is the single
   end state you're driving toward; the Acceptance criteria are the parts.
2. **Land the card in `build/`.** If it's still in `discover/`, `git mv` it into
   `board/build/` (keep the `NNNN-` prefix) so the board shows it's executing:
   ```sh
   git mv libs/aven-board/board/discover/NNNN-slug.md libs/aven-board/board/build/NNNN-slug.md
   ```
3. **Implement the smallest change** that satisfies the Acceptance criteria and
   follows the Approach. Touch only the Files to touch unless the spec is wrong —
   if reality contradicts the spec, surface it and update the spec rather than
   silently expanding scope.
4. **Stay agile.** Work in the small, verifiable Steps the spec defines. After each
   meaningful step, check the box it satisfies and append a dated line to the
   `## Progress log` (newest first) so the next agent can pick up cold. Don't batch
   the whole build into one opaque leap.
5. **Match the surrounding code** — its naming, idioms, and comment density.
6. **Bump `updated:`** in frontmatter as you touch the file.

## Where to stop

Building ends when the change is **written and the card is in `review/`** — built
and ready to be measured against the metric. Promote it:

```sh
git mv libs/aven-board/board/build/NNNN-slug.md libs/aven-board/board/review/NNNN-slug.md
```

Do **not** declare it done here. Running the Verification, proving the metric from
real output, and bubbling the result to a human is the [[review]] skill's job. To
run the whole thing in one pass, use the [[board-goal]] command (resolve → build →
review), or flip on the built-in loop with `/goal <completion condition>`.

## Condensed

1. Confirm a measurable goal exists — else [[discover]] it first.
2. Read the spec; `git mv` discover → build as you start executing.
3. Implement the smallest change that meets the Acceptance criteria; touch only the
   listed files.
4. Check boxes + log progress per step; bump `updated`.
5. Stop at "built"; `git mv` build → review and hand to [[review]] to evaluate.
