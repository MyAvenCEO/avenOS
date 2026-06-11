---
name: ship
description: Ship — archive a human-approved aven-board item as the shipped record (the terminal done/archive state). After a person has verified the review verdict, git mv the card from review/ into ship/, check the final Acceptance boxes, append a dated Progress-log line, and bump updated. Use when someone says "ship NNNN", "archive this", "mark it done/shipped", "it's approved, close it out", "move it to ship". Requires the item to have passed [[review]] and been verified by a human (HITL) — ship does not re-judge the work, it records that it shipped. Never deletes a shipped item.
---

# Ship — archive the verified item (the `ship/` state)

This is the terminal state of the spec-driven flow:
`idea → discovery → goal → review → ship`. Read `libs/aven-board/AGENTS.md` once
before working the board. The folder a card lives in is its state; `ship/` is the
permanent **shipped/archived record** of what landed.

Ship is deliberately thin. The judging already happened in [[review]] (run the
proof, measure against the metric) and the **human verified it** (HITL). Ship does
not re-litigate that — it records the outcome and moves the card to its resting
place.

**Precondition:** the card is in `libs/aven-board/board/review/`, its metric
passed, and a human has approved it. If it hasn't been reviewed, run [[review]]
first. If review failed, ship does nothing — the card goes back to [[goal]] or
[[discovery]], not here.

## What to do

1. **Confirm the sign-off.** The [[review]] verdict is Pass and a human has
   approved shipping. If any Acceptance box is still unproven, stop — back to
   [[review]].
2. **Finalize the doc.** Check the last Acceptance boxes (each annotated with the
   proof from review), append a dated `## Progress log` line (newest first)
   recording that it shipped, and bump `updated:` in frontmatter.
3. **Archive it.** `git mv` the card from `review/` into `ship/`, keeping the
   `NNNN-` prefix so the id is stable:
   ```sh
   git mv libs/aven-board/board/review/NNNN-slug.md libs/aven-board/board/ship/NNNN-slug.md
   ```
4. **Leave it.** A `ship/` item is the shipped record — **never delete it** to tidy
   up. Archive, don't erase.

## Condensed

1. Confirm review passed and a human approved (HITL) — else don't ship.
2. Check final boxes, log the ship, bump `updated`.
3. `git mv` review → ship (keep the `NNNN-` prefix).
4. Never delete a shipped item.
