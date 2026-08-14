---
title: Vibe stage + chat overlay — the new chat UI
summary: No continuous card stream — ONE current vibe fills the stage (new replaces old), a minimal right rail scrolls the vibe history, and chat lives in a bottom ~25% overlay card whose history shows minimal vibe badges instead of inline cards.
owner: claude-code
created: 2026-07-05
updated: 2026-07-05
tags: [app, chat, vibes, ui]
goal: "svelte-check exits 0 errors; MainnetChat renders the stage (current vibe full-size, replaced by each new vibe), the right history rail (click restores), and the bottom 25% chat card with vibe badges — confirmed live by Samuel"
---

# Vibe stage + chat overlay

Samuel (2026-07-05): "instead of a continuous chat flow we want 2 areas — the
actual vibe container UI full height and width (each new vibe replaces the old
view) and a right aside history slider, minimalistic, to scroll through older
vibes. And all chat as a modal-like overlay scoped to the bottom 25%, a
scrollable chat card whose history doesn't show the actual vibe — just a
minimal badge naming which vibe/action it loaded."

Implementation (MainnetChat.svelte, client-only — no server/protocol change):
- STAGE: `vibeHistory` + `currentVibeId`; every incoming vibe (stream inserts,
  confirm-path appends, session-marker rehydration) pushes an entry and becomes
  current; the stage renders todos/composer/VibeCard full-size ({#key}-remounted
  per entry). Newest vibe on load = current.
- RAIL: right aside (md+), newest first, click restores any entry to the stage.
- CHAT OVERLAY: bottom card (25vh, min 13rem, backdrop-blur) — scrollable
  history (text bubbles + ◆ vibe badges that select their stage entry; active
  badge highlighted), HITL confirms, GLM edit stream, tool chips, composer.
- Removed: the floating-bar height/spacer machinery (0112) — the card is
  fixed-height; turn-vibe dedup now keys schema+data so a later stepper state
  still lands on the stage.

## Progress log

- `2026-08-14` — Aus `review/` nach `ship/` archiviert (Sammel-Aktion, Vor-Strip-Ära). Kriterium war die Epoche, nicht eine Einzelprüfung: diese Arbeit ist abgeschlossen — entweder in Produktion gelaufen oder später von 0099/0121 wieder herausgestrippt. Die Karte bleibt hier als historischer Record.
- `2026-07-05` — Built; svelte-check 0 errors. Remaining: Samuel's live look
  (HMR applies immediately) + mobile pass if the rail/overlay need tuning.

- `2026-07-05` — 0118b, Samuel's first live look: NO history and NO container
  card in the overlay — just the LATEST exchange bubble (human message or
  assistant reply, whichever is newest; badges skipped) centered directly above
  the AI button, with the live tool/actor chips kept above it ("the user always
  knows where we are") + the GLM edit stream + HITL confirms floating free on
  the stage. Older messages remain in context/persistence; the rail is the
  visual history.
