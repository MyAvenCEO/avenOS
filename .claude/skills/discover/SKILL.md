---
name: discover
description: Discover — turn a vague idea or task into a tightly-scoped spec with a measurable goal, by interviewing the user to uncover the real goal (the decision the work drives, not the task), making "done" provable from command output, slicing it agile-small, and forcing explicit verification of key decisions. Use when an idea is ready to be specced, or someone asks to "do discovery", "discover the goal", "spec this out", "make this goal measurable", "what's the actual goal here", "interview me about this", "how do I make 'done' provable", "is this a task or a goal", "turn this into a plan/work item". Promotes an aven-board card into discover/ with a measurable goal, then hands the metric to the [[build]] skill (or /board-goal / /goal) to execute. Mirrors [[storytelling]] for engineering work — find the real goal first, then build.
---

# Discover — uncover the goal, make it measurable (the `discover/` state)

AI is brilliant at what can be **measured** and lost on what can't. Ask a model
"the car wash is 50 m away — should I drive or walk?" and it says walk, because it
has no signal that you need the *car* there. That gap — between your understanding
of what you actually want and the model's computational power — is what discovery
closes. The output of discovery is a **measurable metric**: a single completion
condition the [[build]] skill can then execute toward.

This is the `ideate → discover` promotion and the work done while a card sits in
`discover/`. It does what plan-mode is too high-level for: work *with* the user to
design a detailed spec whose **goal is measurable**, so building and verifying it
are no longer matters of taste. In this repo the spec is the work-item file in
`libs/aven-board/board/discover/NNNN-slug.md` (template `templates/plan.md`); its
measurable `goal` is the line later handed to [[build]] / `/goal` / `/board-goal`.
Read `libs/aven-board/AGENTS.md` once first. Lifecycle:
`ideate → discover → build → review → ship`.

## How to run it (interactively)

Like [[storytelling]]: walk the user through the questions **one at a time**, in
order. Don't dump the theory and don't write the whole spec in one shot — ask,
listen, push back when an answer is vague, and only move on when each piece is
solid. You are interviewing them to pull the goal *out of their head and into the
spec*. The user supplies understanding; you supply structure and precision.

Bias hard toward **small**. If the thing is really several specs, say so and carve
the first slice only (split into multiple cards). A tight spec you can finish and
verify beats a grand one that drifts.

---

## Step 1 — Uncover the goal (interview, don't assume)

> "Create an end-of-month report" is a **task**. The **goal** is the conclusion it
> lets someone draw — the decision the report drives. The why is the one thing the
> model can never decide for you.

Interview — one question at a time — until the real goal surfaces:

- **What decision or outcome does this work unlock?** If the answer just restates
  the task, dig: *and then what — what does having that let you do?*
- **Who relies on the result, and what would make it useless to them?**
- **How will we know it actually worked** — not "looks good", but a thing we could
  point at?
- **What's explicitly *out* of scope?** (Naming edges now stops drift later.)

Don't proceed on a task dressed as a goal. Every assumption you skip is a chance
for the build to drift from what they actually wanted.

---

## Step 2 — Make the goal measurable (the metric)

This is the heart of discovery, and the artifact you hand downstream: **one
completion condition, provable from command output you actually produce** — because
the thing that ultimately checks it (`/goal`) reads only the transcript and never
runs anything itself. Name three parts:

1. **End state** — the observable thing that is true when this is done.
2. **Proof** — a *command* and its *expected result* (exit 0, a named test passing,
   a specific line of output, `git status` clean).
3. **Constraints** — what must stay true (e.g. "no other files changed").

Push every fuzzy goal through this until it has all three:

| Vague (a wish) | Measurable (a metric) |
| --- | --- |
| "fix the board" | "`bun run check` and `bun run lint` exit 0 and every Acceptance criterion below is checked" |
| "make the report look good" | "the report has 3 sections, each ending in a recommendation — proven by …" |
| "handle all edge cases" | "new test `rejects_low_order_shared_secret` exits 0; `cargo build -p aven-caps` exits 0; no other crate changes" |

If you cannot name a command whose output would prove it, the goal is not
measurable yet — keep interviewing (back to Step 1) rather than writing a metric
you can't check.

---

## Step 3 — Slice it agile, not waterfall

Handing an agent the *whole* thing at once feels efficient but maximizes drift.
Spec it **agile**: tight scope, one clear checkpoint, review, adjust, repeat.

- If the goal needs more than a handful of verifiable steps, it's **too big** —
  carve off the first slice that has its own measurable metric and spec *that*.
  Note the rest as follow-on cards back in `ideate/`.
- Each step should be **small and independently verifiable** — checkable before
  moving on, not a leap of faith.
- State the checkpoint explicitly: "we'll stop and look after step N."

---

## Step 4 — Be precise, and make the user verify key decisions

The more precise the spec, the less the model has to assume — and assumptions are
where it drifts. Before finalizing, **surface the load-bearing decisions and make
the user confirm them explicitly**:

- Call out each choice that shapes the outcome (approach, library, data shape,
  trade-off, anything irreversible) and ask the user to confirm or redirect.
- When a decision is genuinely the user's, ask it directly (`AskUserQuestion` is
  good for this) rather than guessing.
- Name what you're deliberately *not* doing. "Out of scope" is part of precision.

Outsource the typing, not the understanding. The user must read the spec back and
recognize it as what they meant.

---

## Seed the evaluation criteria up front

Before any building, write **what "good" looks like** — the **Acceptance
criteria**, each checkable from the transcript (a command + its output proves it).
This is the same precision as the metric, applied to the parts, and it's the seed
of the [[review]] (evaluator) layer that grades the work later.

---

## Output — write the spec, promote to `discover/`, hand off the metric

When the four steps hold:

1. **Promote the card.** `git mv` the file from `board/ideate/` into
   `board/discover/` (keep the `NNNN-` prefix).
2. **Write the spec** using `templates/plan.md`: **Context** (so it stands alone),
   **Goal** + the measurable **Completion condition**, **Approach**, small
   **Steps**, **Files to touch**, **Acceptance criteria**, **Verification**
   commands.
3. **Mirror the metric into frontmatter** — put the one-line measurable condition
   in `goal:`, identical to the Completion condition in the body. Keep `title`,
   `summary`, `tags`, `owner`, dates accurate; append a dated `## Progress log`
   line (newest first).
4. **Hand the metric to execution** — the [[build]] skill takes it from here
   (`git mv discover → build` and builds toward the condition):

   ```
   /board-goal <item-ref>          # resolve, build + review, move across columns
   /goal <paste the completion condition>   # or flip on the cross-turn loop directly
   ```

Discovery's job is the **measurable metric**, not the build. Don't start
implementing here unless the user asks — hand off a spec another agent could
execute without asking a single question.

## The whole method, condensed

1. **Uncover the goal** — the decision the work drives, not the task.
2. **Make it measurable** — end state + proof (command + expected result) +
   constraints. No provable command ⇒ not a goal yet.
3. **Slice it agile** — tight scope, one checkpoint; carve big specs into small.
4. **Be precise & verify decisions** — confirm load-bearing choices explicitly.
5. **Seed the criteria** — Acceptance criteria, each provable from the transcript.
6. **Promote & hand off** — write the `discover/` spec, mirror the metric into
   `goal:`, pass it to the [[build]] skill / `/board-goal` / `/goal`.

You can outsource the thinking, but not the understanding. The spec is your
understanding made precise enough that a model can execute it and you can prove
it's done.
