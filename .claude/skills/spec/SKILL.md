---
name: spec
description: Turn a vague task into a tightly-scoped, spec-driven work item with a measurable goal — by interviewing the user to uncover the real goal (the decision the work drives, not the task), making "done" provable from command output, slicing it agile-small, and forcing explicit verification of key decisions. Use when someone hands a task and wants a spec/plan before building, or asks to "write a spec", "spec this out", "make this goal measurable", "what's the actual goal here", "interview me about this", "how do I make 'done' provable", "is this a task or a goal", "turn this into a plan/work item", "spec-driven". Produces an aven-board `plan/` item with a measurable `goal` and hands it off to `/board-goal` / `/goal`. Pairs with the [[board-goal]] command (this writes the spec, that drives it) and mirrors [[storytelling]] for engineering work — find the real goal first, then build.
---

# Spec — uncover the goal, make it measurable, slice it small

AI is brilliant at what can be **measured** and lost on what can't. Ask a model
"the car wash is 50 m away — should I drive or walk?" and it says walk, because
it has no signal that you need the *car* there. That gap — between your
understanding of what you actually want and the model's computational power — is
what a **spec** closes. A spec is how you hand your understanding to Claude in a
form it can act on.

This skill is the discovery process for writing that spec. It does the thing
plan-mode is too high-level for: work *with* the user to design a detailed spec
whose **goal is measurable** — so building it, and verifying it, is no longer a
matter of taste. In this repo the spec is an **aven-board** `plan/` item
(`libs/aven-board/board/plan/NNNN-slug.md`, template `templates/plan.md`); its
measurable `goal` is the line handed to `/goal` / `/board-goal`. Read
`libs/aven-board/AGENTS.md` once before writing one.

## How to run it (interactively)

Like [[storytelling]]: walk the user through the questions **one at a time**, in
order. Don't dump the theory and don't write the whole spec in one shot — ask,
listen, push back when an answer is vague, and only move on when each piece is
solid. You are interviewing them to pull the goal *out of their head and into the
spec*. The user supplies understanding; you supply structure and precision.

Bias hard toward **small**. If the thing in front of you is really several specs,
say so and spec the first slice only. A tight spec you can finish and check beats
a grand one that drifts.

---

## Step 1 — Uncover the goal (interview, don't assume)

> "Create an end-of-month report" is a **task**. The **goal** is the conclusion
> it lets someone draw — the decision the report drives. The task is what to do;
> the goal is *why*, and the why is the one thing the model can never decide for
> you.

So your first job is to interview. Ask the user — one question at a time — until
the real goal surfaces:

- **What decision or outcome does this work unlock?** ("…so we can ship X", "…so I
  know whether to keep paying for Y", "…so a peer can't forge a KEK".) If the
  answer just restates the task, dig: *and then what — what does having that let
  you do?*
- **Who relies on the result, and what would make it useless to them?**
- **How will we know it actually worked** — not "looks good", but a thing we could
  point at?
- **What's explicitly *out* of scope?** (Naming the edges now stops drift later.)

Don't proceed on a task dressed as a goal. Every assumption you skip is a chance
for the build to drift from what they actually wanted.

---

## Step 2 — Make the goal measurable

This is the heart of the skill. A measurable goal is one **completion condition,
provable from command output you actually produce** — because the thing that
ultimately checks it (`/goal`) reads only the transcript and never runs anything
itself. Name three parts:

1. **End state** — the observable thing that is true when this is done.
2. **Proof** — a *command* and its *expected result* (exit 0, a test name passing,
   a specific line of output, `git status` clean).
3. **Constraints** — what must stay true (e.g. "no other files changed", "existing
   suite still green").

Push every fuzzy goal through this until it has all three:

| Vague (a wish) | Measurable (a condition) |
| --- | --- |
| "fix the board" | "`bun run check` and `bun run lint` exit 0 and every Acceptance criterion below is checked" |
| "make the report look good" | "the report has 3 sections, each ending in a recommendation — proven by …" |
| "handle all edge cases" | "new test `rejects_low_order_shared_secret` exits 0; `cargo build -p aven-caps` exits 0; no other crate changes" |

If you cannot name a command whose output would prove it, the goal is not
measurable yet — keep interviewing (back to Step 1) rather than writing a goal you
can't check. For non-code work, the "command" is whatever produces verifiable
signal: a diff against a reference format, a count, a checklist each line of which
points at evidence.

---

## Step 3 — Slice it agile, not waterfall

People instinctively hand an agent the *whole* thing at once (waterfall) because
it feels efficient. It isn't — it maximizes drift. Spec it **agile**: tight scope,
one clear checkpoint, review the output, adjust, repeat.

- If the goal needs more than a handful of verifiable steps, it's **too big** —
  carve off the first slice that has its own measurable goal and spec *that*. Note
  the rest as follow-on items (`idea/`) rather than cramming them in.
- Each step in the spec should be **small and independently verifiable** — a thing
  you could check before moving on, not a leap of faith.
- Prefer many small specs that each reach `done/` over one heroic spec that stalls
  in `test/`.

State the checkpoint explicitly: "we'll stop and look after step N."

---

## Step 4 — Be precise, and make the user verify key decisions

The more precise the spec, the less the model has to assume — and assumptions are
where it drifts. Before you finalize, **surface the load-bearing decisions and
make the user confirm them explicitly**, so nothing important is decided by
default:

- Call out each choice that shapes the outcome (an approach, a library, a data
  shape, a trade-off, anything irreversible) and ask the user to confirm or
  redirect — don't bury it in prose and move on.
- When a decision is genuinely the user's to make, ask it directly (the
  `AskUserQuestion` tool is good for this) rather than guessing.
- Name the trade-offs and what you're deliberately *not* doing. "Out of scope" is
  part of being precise.

Outsource the typing, not the understanding. The user must be able to read the
spec back and recognize it as what they meant.

---

## Seed the verifier (evaluation criteria, up front)

Before any building starts, write down **what "good" looks like** — the
**Acceptance criteria**, each one checkable from the transcript (a command + its
output proves it). This is the same precision as the goal, applied to the parts.
It's also the seed of the verification layer: a spec that defines its own checks
up front is one a feedback loop can later grade against, which is where most of
the quality gain comes from. Vague: "make it better." Precise: "section 3 ends
with a recommendation — proven by reading the rendered output."

---

## Output — write the spec, then hand it off

When the four steps hold, write the work item as an aven-board `plan/` spec:

1. **Capture / locate the item.** New work starts as
   `board/idea/NNNN-slug.md` from `templates/work-item.md` (next free 4-digit
   number, lowercase-hyphenated slug). If it already exists in `idea/`, use it.
2. **Spec it into `plan/`.** `git mv` the file into `board/plan/` and fill out
   `templates/plan.md`: **Context** (so the doc stands alone), **Goal** + the
   measurable **Completion condition**, **Approach**, small **Steps**, **Files to
   touch**, **Acceptance criteria**, and the exact **Verification** commands.
3. **Mirror the goal into frontmatter.** Put the one-line measurable condition in
   the `goal:` field — identical to the Completion condition in the body — and
   keep `title`, `summary`, `tags`, `owner`, dates accurate (the board UI reads
   them). Append a dated line to the `## Progress log`.
4. **Print the hand-off** so the user can drive it:

   ```
   /board-goal <item-ref>          # resolve, build + verify, move across columns
   /goal <paste the completion condition>   # or flip on the cross-turn loop directly
   ```

Writing the spec is this skill's job; **driving it to done is [[board-goal]]'s**.
Don't start building here unless the user asks — hand off a spec another agent
could build without asking a single question.

---

## The whole method, condensed

1. **Uncover the goal** — interview until you have the decision the work drives,
   not the task. (Task ≠ goal.)
2. **Make it measurable** — one completion condition = end state + proof
   (command + expected result) + constraints. If nothing can prove it, it isn't a
   goal yet.
3. **Slice it agile** — tight scope, one checkpoint; carve big specs into small
   ones that each reach `done/`.
4. **Be precise & verify decisions** — make the user confirm load-bearing choices
   explicitly; name what's out of scope.
5. **Seed the verifier** — write the Acceptance criteria up front, each provable
   from the transcript.
6. **Ship the spec** — write the aven-board `plan/` item, mirror the goal into
   frontmatter, print the `/board-goal` / `/goal` hand-off.

You can outsource the thinking, but not the understanding. The whole spec is just
your understanding, made precise enough that a model can act on it and you can
prove it's done.
