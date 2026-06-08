# Every other breath — 30s square short

**Topic:** the ocean (phytoplankton) makes ~50% of Earth's oxygen.
**Format:** 1:1 square (1080×1080), 30.0s. Six Pexels ocean clips + animated
text + MOSS-TTS-Nano voiceover + a music bed.
**Tone:** calm, awe → surprising stat → quiet landing.

## Screenplay (6 beats × ~5s)

| t (s)    | B-roll (Pexels)            | On screen (text)                                        |
| -------- | -------------------------- | ------------------------------------------------------- |
| 0–5      | underwater sun rays        | **Take a deep breath.** → Now another.                  |
| 5–10     | sunlit ocean surface       | Every second breath — the oxygen came from **the ocean.** |
| 10–15    | green plankton / algae     | **Phytoplankton** · tiny · invisible · everywhere       |
| 15–20    | coral reef fish            | Trillions turn sunlight into the air we breathe.        |
| 20–25    | aerial ocean waves         | **~50%** of Earth's oxygen                              |
| 25–30    | glowing jellyfish          | The ocean **breathed first.**                           |

Clips crossfade (0.4s) with a slow push-in; text fades/slides per beat with
hard-kills at clip boundaries.

## Audio

- **Voiceover** — MOSS-TTS-Nano (`assets/vo.wav`, "Bella", 30.0s), full volume.
- **Music bed** — `assets/music.mp3` ("madeira-mountain-trout-farm" by ende.app),
  ducked to 0.16 under the voice.

> "Take a deep breath. Now another. Every second breath you take, the oxygen in
> it came from the ocean. Not from forests, from the sea. Drifting in the sunlit
> water are phytoplankton: tiny, invisible, everywhere. Trillions of them turn
> sunlight into the air we breathe. Half of Earth's oxygen, made by life too
> small to see. So next time you breathe, remember: the ocean breathed first."

## Build

```bash
# voiceover (MOSS-TTS-Nano, CPU by default)
cargo run --release --manifest-path libs/aven-ai/Cargo.toml \
  --example tts_synth --features tts -- "<the narration above>" \
  .claude/skills/video-edit/examples/ocean-breath/assets/vo.wav

# square b-roll (1:1) — repeat per shot
python3 .claude/skills/video-edit/scripts/fetch_stock.py "<query>" \
  .claude/skills/video-edit/examples/ocean-breath/assets --square
# (re-encode each fetched clip to 1080² dense-keyframe before use)

# render + publish
bash .claude/skills/video-edit/scripts/render.sh \
  .claude/skills/video-edit/examples/ocean-breath ocean-breath "Every other breath"
```
