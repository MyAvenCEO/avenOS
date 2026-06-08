# Hyperframes authoring guide

How to write a composition this skill can render. Hyperframes turns an
**HTML page + a GSAP timeline** into an mp4 by driving the timeline frame by
frame in headless Chrome and capturing each frame.

## Project layout

A project is a directory:

```
my-clip/
  hyperframes.json   # registry + paths config (copy from examples/hello-world)
  meta.json          # { "id": "...", "name": "..." }  (optional but nice)
  index.html         # the composition entry point — this is what renders
  script.md          # human screenplay (optional; render.sh embeds it in manifest)
```

`hyperframes render <dir>` renders `index.html` by default. To render a
non-default file, reference it from index.html via `data-composition-src` and
pass `--composition compositions/foo.html`. For this skill, **keep it simple:
one `index.html` per clip.**

## The root element

```html
<div id="root" data-composition-id="hello-world"
     data-start="0" data-duration="5" data-width="1920" data-height="1080">
```

- `data-composition-id` — the timeline key. The GSAP timeline MUST be registered
  under the exact same string on `window.__timelines`.
- `data-duration` — clip length in seconds. The renderer captures
  `duration × fps` frames (default 30 fps → 150 frames for 5s).
- `data-width` / `data-height` — canvas size. **Default to 1:1 square
  (1080×1080).** Pair with `data-resolution` on `<html>` (`square` = 1080×1080
  — the skill default; `landscape` = 1920×1080, `portrait` = 1080×1920)
  and a matching `<meta name="viewport" width=… height=…>`.

## Clips

Any animated element is a `.clip` with timing data attributes:

```html
<h1 id="title" class="clip" data-start="0.1" data-duration="4.9" data-track-index="1">
  Hello, <span class="accent">avenSKILLS</span>
</h1>
```

- `data-start` / `data-duration` — when the element is on the timeline.
- `data-track-index` — stacking/ordering layer (higher = on top).
- Give every clip a unique `id` so the timeline can target it.

## The timeline

Register a **paused** GSAP timeline keyed by the composition id:

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  tl.from("#title",    { opacity: 0, y: -60, duration: 0.9, ease: "power3.out" }, 0.1);
  tl.from("#subtitle", { opacity: 0, y: 30,  duration: 0.8, ease: "power2.out" }, 0.6);
  tl.to("#title",      { scale: 1.04, duration: 3.0, ease: "sine.inOut" }, 1.0);

  window.__timelines["hello-world"] = tl;   // MUST match data-composition-id
</script>
```

- **Paused** is required — Hyperframes seeks the timeline itself; never call
  `.play()`.
- The third argument to `tl.from/to` is the **absolute start time** in seconds.
- Prefer eased motion (`power2.out`, `power3.out`, `sine.inOut`) over `linear`.
- The timeline's total length should match (or be ≤) `data-duration`.

## Styling

- Inline `<style>` in `index.html` is simplest. Self-host or CDN web fonts; the
  renderer waits for `document.fonts.ready`. System fonts (`Inter`, `system-ui`)
  always work.
- For purely additive Tailwind, scaffold with `--tailwind` (adds the browser
  runtime). Not needed for the hello-world style.
- No external network assets are required for text clips — keep them
  self-contained so renders are deterministic and offline-friendly.

## Render + publish

```bash
# render <dir>, publish to the Editing tab
bash scripts/render.sh my-clip my-clip "My Clip Title"

# render manually to anywhere
npx hyperframes@latest render my-clip -o out.mp4 --quiet

# faster iteration knobs
npx hyperframes@latest render my-clip -o out.mp4 -q draft   # quick preview
npx hyperframes@latest render my-clip -o out.mp4 -f 24      # 24 fps
npx hyperframes@latest preview                              # live studio in browser
```

WebM/MOV with transparency: `--format webm` / `--format mov` for overlays.

## Common mistakes

- Timeline key ≠ `data-composition-id` → nothing animates.
- Timeline not `paused` → frames captured mid-play, jittery output.
- `data-duration` shorter than the animation → the clip cuts off early.
- Linear easing on text → reads cheap; use eased curves.
- Forgetting `class="clip"` on an animated element → timing attributes ignored.
