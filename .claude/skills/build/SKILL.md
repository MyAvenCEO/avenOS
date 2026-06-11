---
name: build
description: Build toward a measurable goal — take the metric produced by discovery and implement the smallest change that satisfies it, then git mv the card from build/ into review/. This is the execution state of the spec-driven flow. Use when someone says "build NNNN", "build toward the goal", "implement the spec", "execute this item", "drive this to its metric", "do the plan", or hands you a build/ (or discover-specced) card to implement. Requires a card with a measurable goal (if it's still raw, run the [[discover]] skill first). Pairs with Claude Code's built-in /goal cross-turn loop (typed entry: /aven-build); evaluation + human sign-off is the [[review]] skill's job.
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

The metric is your target the whole way through. **Iterate to it in-session:**
run the Verification, read the output against the Acceptance criteria, fix, and
re-run — keep looping until the metric is provably met, rather than stopping at
"I wrote the code". That in-session loop is yours to drive; the build skill cannot
start Claude Code's built-in **`/goal`** loop itself (slash commands only fire from
a user message), so for *unattended, cross-turn* continuation you **emit a
ready-to-run `/goal` line** for the human to flip on (see "Where to stop").
Evaluation follows as its own state: [[review]] (`/aven-review`).

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
6. **Iterate to green in-session.** Run the Verification, compare against the
   Acceptance criteria, fix what's red, re-run — loop until the metric is provably
   met. Don't hand off a build you haven't seen pass.
7. **Bump `updated:`** in frontmatter as you touch the file.

## Where to stop

Building ends when the change is **written and the card is in `review/`** — built
and ready to be measured against the metric. Promote it:

```sh
git mv libs/aven-board/board/build/NNNN-slug.md libs/aven-board/board/review/NNNN-slug.md
```

Do **not** declare it done here. Running the Verification, proving the metric from
real output, and bubbling the result to a human is the [[review]] skill's job.

**Always emit the hand-off line.** Before you end the turn, print the card's
completion condition as a ready-to-run `/goal` line so a human can flip on
unattended, cross-turn continuation if they want it (the build skill can't enable
it for them):

```
/goal <paste the card's completion condition>
```

Then hand the result to the evaluator state: `/aven-review <item-ref>`.

## Condensed

1. Confirm a measurable goal exists — else [[discover]] it first.
2. Read the spec; `git mv` discover → build as you start executing.
3. Implement the smallest change that meets the Acceptance criteria; touch only the
   listed files.
4. Check boxes + log progress per step; bump `updated`.
5. Iterate to green in-session: run Verification → fix → re-run until the metric holds.
6. `git mv` build → review, hand to [[review]], and print the `/goal <condition>`
   line for optional unattended continuation.
