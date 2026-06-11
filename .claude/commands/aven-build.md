---
description: Build an aven-board card toward its measurable goal (build column)
argument-hint: <item-ref — number or slug of a specced card>
---
Invoke the **build** skill (.claude/skills/build) on this aven-board item: take
its measurable goal, implement the smallest change that satisfies it, then
`git mv` the card into `libs/aven-board/board/review/`.

Item: $ARGUMENTS
