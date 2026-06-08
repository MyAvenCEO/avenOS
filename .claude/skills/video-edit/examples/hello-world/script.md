# Hello, avenSKILLS — mini script

A ~5 second, text-only "movie". This is the screenplay the
[`index.html`](./index.html) composition renders.

| t (s) | Element  | Action                                | Text                                  |
| ----- | -------- | ------------------------------------- | ------------------------------------- |
| 0.0   | accent   | neo-lime glow scales up behind title  | —                                     |
| 0.1   | title    | drops in from above                   | **Hello, avenSKILLS**                 |
| 0.6   | subtitle | rises into place                      | Your first Hyperframes clip           |
| 1.0   | title    | gentle breathing scale (1.0 → 1.04)   | —                                     |
| 1.4   | tag      | fades in at the bottom                 | rendered locally · HTML + GSAP → mp4  |
| 5.0   | —        | end                                   | —                                     |

## Render

```bash
bash .claude/skills/video-edit/scripts/render.sh \
  .claude/skills/video-edit/examples/hello-world hello-world "Hello, avenSKILLS"
```

That produces `app/static/skills/editing/hello-world.mp4`, copies the source
HTML next to it, and upserts an entry into `manifest.json` — which the
**avenSKILLS → Editing** tab reads to list and play the clip.
