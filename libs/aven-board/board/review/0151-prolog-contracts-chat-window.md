---
title: Prolog as SSOT across actors + the chat as a config'd window
summary: requires/produces become .pl facts (one file per actor declares machine AND contracts — inter-actor edges unify out of Prolog); full voice-trio machines with failure edges; the chat renders as a universal-engine window over projected state.
owner: claude (Opus 4.8)
created: 2026-08-20
updated: 2026-08-20
tags: [actors, architecture, prolog, chat]
goal: "`bun test` and `bun run check` (from app/) exit 0, including prolog-contracts.test.ts proving: contracts parse from .pl (nested args intact); an Actor with a machine takes requires/produces FROM the machine; the voice-pipeline edges (listener→chat→speaker, barge-in) unify out of .pl contracts alone; and the chat/listener/speaker machines cover the failure edges (denied/error/retry, mute/unmute, interrupt-from-any-busy-state). The chat renders as a WindowActor via the universal engine (verified live: bubbles + streaming status)."
---

# Prolog as SSOT across actors + the chat window

## Context

Samuel spotted the split SSOT: *inside* an actor flow was Prolog (`.pl` machine), but
*across* actors the contracts (`requires`/`produces` — which derive every inter-actor
edge) were TS manifest arrays. Two definition languages for one graph. Also: the chat UI
was a bespoke Svelte tab, outside the actor/window architecture.

## Shipped

**Prolog SSOT inside AND across (abject: the schema is the object, in one language):**
- [x] `machine.ts` — `contractsOf(db)`: `requires(P)`/`produces(P)` facts parsed (regex
  by shape — nested predicate args like `utterance(T)` stay intact); on the `Machine` as
  `contracts`.
- [x] `Actor` — when the manifest carries a machine whose `.pl` declares contracts, they
  ARE the actor-level `requires`/`produces` (parsed once at construction); TS arrays
  remain only for machineless actors.
- [x] Full machines with edge cases: `chat-machine.pl` (idle/thinking/replying;
  interrupt escapes every busy state; tool_round loops), `listener-machine.pl`
  (denied/error states with retry/stop ways back; stop from every live state),
  `speaker-machine.pl` (mute/unmute parks the warm voice; silence/interrupt→ready;
  fail/retry). `todo-machine.pl` gained `produces(todo(T))`. The TS contract arrays for
  chat/listener/speaker/todo are GONE — the `.pl` is the one source; the canvas draws
  chat/listener/speaker as composite statechart boxes automatically.
- [x] `prolog-contracts.test.ts` (7 tests): contracts parse; Actor takes contracts from
  machine; the whole voice pipeline (listener→chat→speaker + barge-in) unifies out of
  `.pl` facts alone; trio machines' edge cases assert.

**Chat as a config'd actor window:**
- [x] `views/chat/view.ts` — the transcript as ViewDef data (bubbles via `$each`,
  streaming status), brand-styled; input stays the voice pill (the one door for words).
- [x] `ChatActor` — reactive `state` projection (`#project` on every sink event +
  new `onTurn` turn-boundary hook in Chat core); `view`/`style`/`machine` in manifest.
- [x] `AvenUiView` — renders any actor WITH a view, sandboxed logic or host code.
- [x] `windows.ts` — `chatWindow` registered; "Chat" appears in the deterministic window
  switcher. Live-verified: send → my bubble right, streamed reply left, "thinking…".

**Also shipped (pill polish, per Samuel):** start-button logo gets inner padding inside
its bordered circle; the hang-up is a real off-hook receiver (rotated handset) on a red
(`status-error`) circle.

Verification: `bun test` 75 pass · `bun run check` 0 errors (459 files) · live screenshots.

Follow-on: the bespoke Chat TAB could now collapse into the window entirely (export/
clear/partial-transcript parity in ViewDef) — then tabs = Views · Actors only.

## Progress log

- `2026-08-20` — Built + verified live; straight to review.
