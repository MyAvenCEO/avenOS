---
name: video-edit
description: Author and render short text/motion video clips for avenOS using HeyGen Hyperframes (HTML + GSAP timelines rendered locally to mp4). Use when the user wants to make, edit, or enhance a video clip — e.g. "make a clip", "edit this video", "create an intro", "animate this text", "render a hello-world video", "add a title card", "add b-roll", "build a short for avenSKILLS". Renders fully locally (headless Chrome + ffmpeg); no Remotion, no external sound libraries. Optional real stock b-roll via Pexels.
---

# video-edit (Hyperframes)

Make short video clips for avenOS. Compositions are plain **HTML + a GSAP
timeline**; Hyperframes renders them to mp4 locally. Output is published to the
in-app **avenSKILLS → Editing** tab.

This skill is a lean rewrite seeded from a larger Remotion-based YouTube editor.
Remotion, Pexels/stock-footage fetching, and external SFX/music are intentionally
**not** part of it — see "Out of scope" below.

## Requirements (one-time)

- **Node ≥ 22** and **ffmpeg** on PATH (macOS: `brew install ffmpeg`).
- Hyperframes is run on demand via `npx hyperframes@latest …` — no global install.
- First render downloads a headless Chrome (~once). Check with
  `npx hyperframes@latest doctor`.
- Optional: HeyGen ships a low-level Hyperframes authoring skill —
  `npx skills add heygen-com/hyperframes`. This skill is the higher-level avenOS
  wrapper; use the HeyGen one for deep GSAP/composition reference.

## The composition format

A Hyperframes project is a **directory** with an `index.html` entry plus a
`hyperframes.json`. The HTML holds the visible elements; a `paused` GSAP
timeline drives the animation. See [`examples/hello-world/`](./examples/hello-world)
for a complete, working reference, and
[`knowledge/hyperframes_authoring.md`](./knowledge/hyperframes_authoring.md) for
the full authoring guide.

Minimum shape:

```html
<div id="root" data-composition-id="main"
     data-start="0" data-duration="5" data-width="1920" data-height="1080">
  <h1 id="title" class="clip" data-start="0" data-duration="5" data-track-index="1">
    Hello
  </h1>
</div>
<script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });
  tl.from("#title", { opacity: 0, y: -50, duration: 1 }, 0);
  window.__timelines["main"] = tl;   // key MUST match data-composition-id
</script>
```

## Workflow

1. **Scaffold or copy** a project dir. Fastest: copy `examples/hello-world` and
   edit it, or `npx hyperframes@latest init <name> --example blank --non-interactive
   --skip-skills --resolution landscape`.
2. **Author** the composition (HTML + GSAP). Apply the editorial principles in
   [`knowledge/editorial_principles.md`](./knowledge/editorial_principles.md):
   hook in the first frame, every visual earns its place, readable caption
   cadence, a deliberate ending.
3. **Lint** (optional but recommended): `npx hyperframes@latest lint <dir>`.
4. **Render + publish** to the Editing tab:
   ```bash
   bash scripts/render.sh <project_dir> <id> "<Title>"
   ```
   This renders the mp4, copies the source HTML, and upserts an entry into
   `app/static/skills/editing/manifest.json`.
5. **Verify**: `python3 scripts/verify.py app/static/skills/editing/<id>.mp4 <expected_seconds>`.
6. Tell the user to open **avenSKILLS → Editing** and refresh to play it.

## Stock b-roll (Pexels — optional)

For real-world concepts (a desk, a city street, an ocean), real footage beats
generated stills. [`scripts/fetch_stock.py`](./scripts/fetch_stock.py) pulls a
clip or photo from Pexels into a project's `assets/` dir; reference it from the
composition like any local asset.

```bash
# video (default) or photo, into the project's assets/ dir
python3 scripts/fetch_stock.py "person desk working late" examples/my-clip/assets
python3 scripts/fetch_stock.py "city skyline dusk" examples/my-clip/assets --photo --portrait
```

Then in `index.html` (the render file-server is rooted at the project dir, so
relative `assets/...` paths resolve):

```html
<video id="bg" class="clip" data-start="0" data-duration="5" data-track-index="0"
       src="assets/stock_ab12cd34.mp4" muted playsinline
       style="width:1920px;height:1080px;object-fit:cover"></video>
```

**Key:** `fetch_stock.py` reads `PEXELS_API_KEY` from the environment, falling
back to the repo-root `.env` (`PEXELS_API_KEY="..."`). Get a free key at
<https://www.pexels.com/api/>. Without a key it exits with a clear message and
you fall back to text/CSS visuals.

Sourcing priority for any visual: **real screenshot/asset → Pexels stock →
text/CSS or generated metaphor.** Don't reach for stock when a clean text/CSS
treatment says it better.

## Voiceover (MOSS-TTS-Nano — avenOS's own on-device TTS)

Generate narration with the **same** on-device engine the app ships
(`aven_ai::tts`, fixed "Bella" voice) — no Hyperframes/Kokoro, no cloud. A small
CLI example wraps it: [`libs/aven-ai/examples/tts_synth.rs`](../../../libs/aven-ai/examples/tts_synth.rs).

```bash
# one-time: provision the onnxruntime dylib the engine loads
bun scripts/fetch-onnxruntime.ts

# text -> wav (MOSS models auto-download to ~/.avenOS/models on first run)
cargo run --release --manifest-path libs/aven-ai/Cargo.toml \
  --example tts_synth --features tts -- \
  "Your narration line." <project_dir>/assets/vo.wav
```

Output is 48 kHz mono PCM WAV. Add it to the composition as an audio clip and set
the composition `data-duration` to cover the VO length:

```html
<audio id="vo" class="clip" data-start="0" data-duration="10.5"
       data-track-index="5" data-volume="1" src="assets/vo.wav"></audio>
```

`render.sh` then muxes it into the mp4 automatically — the Editing tab's `<video>`
plays it back with sound. The hello-world clip stays silent; **ocean-breath**
carries a MOSS voiceover as the reference.

## Scripts

- [`scripts/render.sh`](./scripts/render.sh) — `render.sh <project_dir> [id] [title]`.
  Renders via `npx hyperframes render`, copies the HTML, upserts the manifest.
  Checks Node ≥ 22 and ffmpeg first.
- [`scripts/fetch_stock.py`](./scripts/fetch_stock.py) — `fetch_stock.py "<query>" <out_dir> [--photo] [--portrait]`.
  Downloads real stock b-roll from Pexels into a project's `assets/` dir.
- [`scripts/verify.py`](./scripts/verify.py) — `verify.py <mp4> [expected_seconds]`.
  ffprobe-based duration/stream sanity check.

## Where output lives (MVP1: disk, not aven-db)

Rendered clips are written to `app/static/skills/editing/` and served by the app
at `/skills/editing/<id>.mp4`. The Editing tab fetches
`/skills/editing/manifest.json` and lists + plays them. There is **no**
groove/aven-db storage in this MVP — files live on disk only.

## Out of scope (deliberately removed)

- **Remotion** — replaced entirely by the Hyperframes CLI.
- **External SFX & music libraries / audio ducking** — not wired. (Hyperframes
  can do voiceover/transcription, but that is not part of this MVP.)
- **groove / aven-db upload** — deferred; output is disk-only for now.

(Pexels stock b-roll *is* wired — see "Stock b-roll" above. Unsplash and other
sources are not.)

If a request needs one of these, say it's out of scope for this skill rather than
improvising it.
