---
name: review
description: Evaluate an aven-board review/ item against its measurable goal, then bubble the result to a human to verify (HITL). Runs the item's Verification commands plus the repo gates, proves the metric from real command output, annotates the Acceptance criteria with evidence, and presents a clear pass/fail verdict for human sign-off — it does not ship on its own. This is the evaluator layer and the build→review state of the spec-driven flow. Use when someone says "review NNNN", "evaluate this", "measure it against the goal", "did the metric hold?", "is this ready to ship?". For observing real app behavior use the [[verify]] skill; on human approval the [[ship]] skill releases + archives it; failures bubble back to [[discover]] or [[build]].
---

# Review — measure against the goal, hand to the human (the `review/` state)

This is the **evaluator** (Layer 2): the gate where built work is measured against
its metric and the verdict is handed to a human to verify. Read
`libs/aven-board/AGENTS.md` once before working the board. The folder a card lives
in is its state; lifecycle is `ideate → discover → build → review → ship`.

The mental model: the agent is a librarian, not a colleague — it can be
confidently wrong, and "make it better" is not a lever. The lever that *works* is
**verification**. So you don't judge by vibes; you **run the proof**. And because
the agent can be confidently wrong about its own proof, review **keeps a human in
the loop** — it measures, then asks a person to verify before anything ships.

**Precondition:** the card is in `libs/aven-board/board/review/` with a Verification
block and a measurable goal. If there's no metric to check against, the spec was
incomplete — bounce it to [[discover]], don't invent a pass.

## What to do

1. **Read the goal + Acceptance criteria.** Note the exact end state, the proof
   each criterion names, and the constraints (e.g. "no other files changed").
2. **Run the proof for real** — the item's `## Verification` commands *plus* the
   repo gates, so the output the metric refers to is in the transcript:
   ```bash
   bun run check   # svelte-kit sync + svelte-check + docs word count
   bun run lint    # biome
   # + the item's own commands, e.g. cargo test -p aven-caps <named-test>
   ```
   Report the output faithfully. If it failed, say so with the output — never
   paper over a red result.
3. **Pull external / second-opinion signal where it helps:** confirm a deploy
   against the system it deployed to, diff a report against a reference format, or
   have a second model critique the output. To watch the change run in the actual
   app, use the [[verify]] skill. Bring in signal that makes "it worked" provable
   rather than asserted.
4. **Annotate the evidence.** Tick each Acceptance box that the output proves,
   noting the command + result beside it. Leave unproven boxes unticked.
5. **Bubble the verdict to the human (HITL).** Summarize for a person: the metric,
   what you ran, the result, and a clear recommendation —
   - **Pass** — every criterion is provable from output and the completion
     condition holds → recommend ship, and ask the human to confirm.
   - **Fail / unprovable in scope** — say exactly what broke and where you're
     stuck. Don't ship on a maybe.
   Append a dated `## Progress log` line with the evaluation result and bump
   `updated:`. The human's verification is the gate — review measures, the human
   decides.

## Hand-off (after the human verifies)

- **Approved →** the [[ship]] skill releases it (deploy server + apps, push to
  main) and `git mv review → ship`.
- **Rejected / failed →** `git mv` the card back to `build/` (re-execute) or
  `discover/` (re-spec) with a Progress-log note on what failed and why. That's a
  valid outcome, not a defeat.

Chained after [[build]] (`/aven-build` then `/aven-review`), this surfaces the
same verdict for your sign-off.

## Condensed

1. Confirm the card is in `review/` with a measurable goal — else bounce to
   [[discover]].
2. Run the item's Verification + `bun run check` / `bun run lint` for real.
3. Pull external/second-model signal where it sharpens the proof.
4. Annotate Acceptance boxes with evidence; log the result; bump `updated`.
5. Bubble a clear pass/fail verdict to the human. On approval → [[ship]]; on
   failure → back to [[build]] / [[discover]] with a note.
