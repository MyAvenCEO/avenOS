---
name: ship
description: Verify an aven-board test/ item against its measurable goal and close it — run the item's Verification commands plus the repo gates, prove the goal from real command output, then git mv it into done/ (or back to plan/ with a note if it fails). This is the verifier layer and the test→done transition of the spec-driven flow. Use when someone says "verify and ship NNNN", "close this item", "is this done?", "check it against the goal", "move it to done", "did the spec hold?". Requires a card in test/ with a measurable goal + Verification block. For observing real app behavior use the [[verify]] skill; [[board-goal]] runs build → ship end to end.
---

# Ship — verify against the goal, close the card (the `test/` → `done/` verb)

This is the **verifier**: the gate where a built item either proves its measurable
goal or goes back. Read `libs/aven-board/AGENTS.md` once before working the board.
The folder a card lives in is its state.

The mental model: the agent is a librarian, not a colleague — it can be
confidently wrong, and "make it better" is not a lever. The lever that *works* is
**verification**. So you don't judge "done" by vibes; you **run the proof**. The
item's `goal` is one completion condition that must be provable from command
output, and the built-in `/goal` evaluator reads only the **transcript** — so the
proof has to actually appear as output you ran.

**Precondition:** the item is in `libs/aven-board/board/test/` with a Verification
block and a measurable goal. If there's no measurable goal to check against, the
spec was incomplete — fix that with the [[spec]] skill, don't invent a pass.

## What to do

1. **Read the goal + Acceptance criteria.** Note the exact end state, the proof
   each criterion names, and the constraints (e.g. "no other files changed").
2. **Run the proof for real** — the item's `## Verification` commands *plus* the
   repo gates, so the output the goal refers to is in the transcript:
   ```bash
   bun run check   # svelte-kit sync + svelte-check + docs word count
   bun run lint    # biome
   # + the item's own commands, e.g. cargo test -p aven-caps <named-test>
   ```
   Report the output faithfully. If it failed, say so with the output — never
   paper over a red result.
3. **Pull external / second-opinion signal where it helps** (Layer-2 verifier):
   confirm a deploy against the system it deployed to, diff a report against a
   reference format, or have a second model critique the output. Bring in signal
   that makes "it worked" provable rather than asserted. To watch the change run
   in the actual app, use the [[verify]] skill.
4. **Decide against the goal — honestly:**
   - **Pass** — every Acceptance box is provable from the output and the
     completion condition holds. → close it (step 5).
   - **Fail / can't prove it in scope** — `git mv` the card **back to `plan/`** and
     append a Progress-log line saying exactly what failed and why. That's a valid
     outcome, not a defeat.
5. **Close the loop (on pass):**
   - Check the remaining Acceptance boxes, each annotated with the proof.
   - Append a dated `## Progress log` line (newest first) summarizing the
     verification result.
   - Bump `updated:` in frontmatter.
   - `git mv` into `done/`, keeping the `NNNN-` prefix:
     ```sh
     git mv libs/aven-board/board/test/NNNN-slug.md libs/aven-board/board/done/NNNN-slug.md
     ```
6. **Never delete a `done/` item** to tidy up — it's the shipped record.

## Condensed

1. Confirm the item is in `test/` with a measurable goal — else [[spec]] it.
2. Run the item's Verification + `bun run check` / `bun run lint` for real.
3. Pull external/second-model signal where it sharpens the proof.
4. Pass → check boxes, log, bump `updated`, `git mv` test → done.
   Fail → `git mv` back to plan/ with a note on what broke.
