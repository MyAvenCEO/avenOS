---
title: Draw canvas — bounded zoom, reference images, pen colours
summary: Extend the mainnet Draw scratchpad with 0.2×–10× zoom/pan, add-image (system upload) with move/resize handles, finger-paint over images, and a pen colour palette.
owner: unassigned
created: 2026-07-02
updated: 2026-07-02
tags: [app-ui, ipad]
goal: "From app/: `bun run check` exits 0 and `bun test tests` passes incl. the new sketch-model tests (viewport round-trip + clamp≥10× + zoomAround focal-fixed; image add/hit/handle/resize/clamp; move+delete+select across images). Scoped `biome check` over the touched files exits 0. DrawCanvas exposes zoom (pinch/wheel/buttons, clamped 0.2×–10×), an add-image (file-picker) tool with move/resize handles, and a pen colour palette. No persistence/schema changes."
---

# Draw canvas — bounded zoom, reference images, pen colours

## Context

Follow-on to board 0060 (the Draw scratchpad tab in the mainnet/Alberobello shell). The
user asked for three things, to get a "mirror / reference-board" experience:

1. **Scale the canvas** — "not infinitely but 10× at least" (zoom + pan).
2. **Add images** as a tool, movable + scalable with **handles**.
3. **Paint over the image without a pen** (any pointer) and **choose pen colours**.

Still **in-memory only** — strokes and images reset on reload; no avenDB/schema.

## Goal

Zoom into the canvas (bounded), drop reference images you can move/resize with corner
handles, paint over them with pencil/finger/mouse in a chosen colour.

**Completion condition** (identical to frontmatter `goal`):

> From `app/`: `bun run check` exits 0 and `bun test tests` passes incl. the new
> `sketch-model` tests (viewport round-trip + clamp ≥10× + `zoomAround` focal-fixed; image
> add/hit/handle/resize/clamp; move+delete+select across images). Scoped `biome check` over
> the touched files exits 0. `DrawCanvas` exposes zoom (pinch/wheel/buttons, clamped
> 0.2×–10×), an add-image (file-picker) tool with move/resize handles, and a pen colour
> palette. No persistence/schema changes.

Zoom/pinch feel + image drag are inherently visual → **HITL at review**, on device.

## Approach

Keep the pure-model + thin-renderer split so the new geometry stays unit-tested.

- **`sketch-model.ts`** — add a **world coordinate space** + `Viewport {scale,tx,ty}` with
  `screenToWorld` / `worldToScreen` / `clampScale` (`MIN_SCALE 0.2`, `MAX_SCALE 10`) /
  `zoomAround` (focal-point-fixed zoom). Add `SketchImage` + `addImage`, `imageAt`,
  `imageHandles` / `imageHandleAt`, `resizeImageByHandle` (opposite-corner anchor, min-size
  clamp). Extend `selectInRect` / `moveSelection` / `deleteSelection` to cover images too.
- **`DrawCanvas.svelte`** — all pointer input maps screen→world through the viewport.
  Two pointers = **pinch/pan**; one pointer/pencil = draw/erase/select. Wheel + −/％/＋/reset
  buttons zoom. **Add-image** button → hidden `<input type=file>` → read as data URL (system
  upload, in-memory), placed centred + selected. Select tool: corner handles resize the
  selected image, body drag moves; `Delete`/`Backspace` removes. Renders images behind
  strokes (paint/trace on top). A **colour palette** sets the pen colour (any pointer paints).

**Out of scope:** persistence/sync, paste/drag-drop/camera image input, image rotation,
uniform-aspect resize lock, undo/redo, infinite canvas. Follow-on candidates.

## Files to touch

- `app/src/lib/draw/sketch-model.ts` — viewport transforms + image model + selection.
- `app/src/lib/draw/DrawCanvas.svelte` — zoom/pan, image tool + handles, colour palette.
- `app/tests/sketch-model.test.ts` — new suites (viewport, images, cross-type selection).
- `app/languages/{en,de}.json` — `draw.colors/addImage/zoom/zoomIn/zoomOut/resetView`.

## Acceptance criteria

- [x] `cd app && bun run check` exits 0. *(0 errors; 1 pre-existing unrelated `aven-city` warning.)*
- [x] `cd app && bun test tests` passes — **23 pass / 0 fail** incl. new suites:
  - [x] viewport: `screenToWorld∘worldToScreen` identity; `clampScale` bounds (MAX ≥ 10);
        `zoomAround` keeps the focal point fixed + clamps.
  - [x] images: `addImage` + `imageAt` topmost; `imageHandleAt` corners; `resizeImageByHandle`
        se/nw anchors + min-size clamp.
  - [x] cross-type selection: `selectInRect` / `moveSelection` / `deleteSelection` on images.
- [x] Scoped `biome check` over the touched files exits 0 (0 errors / 0 warnings).
- [x] In-memory constraint held — no `libs/aven-schema/**` or `app/src-tauri/**` changes.
- [ ] HITL (review, on device): pinch/wheel/buttons zoom within 0.2×–10×; add a photo, move +
      resize it via handles; paint over it in a chosen colour with finger + pencil.

## Verification

```bash
cd app
bun run check
bun test tests

cd ..
bunx biome check \
  app/src/lib/draw/sketch-model.ts app/src/lib/draw/DrawCanvas.svelte \
  app/tests/sketch-model.test.ts app/languages/en.json app/languages/de.json
git diff --name-only | grep -E '^(libs/aven-schema/|app/src-tauri/)' && echo "VIOLATION" || echo "ok: no schema/backend changes"

# manual (HITL): bun run tauri:dev — zoom, add image, resize handles, paint over in colour
```

## Progress log

- `2026-08-14` — Aus `review/` nach `ship/` archiviert (Sammel-Aktion, Vor-Strip-Ära). Kriterium war die Epoche, nicht eine Einzelprüfung: diese Arbeit ist abgeschlossen — entweder in Produktion gelaufen oder später von 0099/0121 wieder herausgestrippt. Die Karte bleibt hier als historischer Record.
- `2026-07-02` — Built. World-space viewport (zoom 0.2×–10× via pinch/wheel/buttons + pan),
  image model with move/resize handles + system-upload add-image, pen colour palette, and
  paint-any-pointer over images. Pure geometry unit-tested (23/23). `bun run check` exit 0,
  scoped lint clean. Created in review.
