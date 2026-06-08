# Every other breath — story-driven square short

Built with the [[storytelling]] Story Finder, then edited with [[video-edit]].

**Compass (want · but · until):**
> I wanted to take a breath without thinking, **but** I forgot it comes from
> something invisible we're losing, **until** I saw the ocean is breathing for me.

**Why this beats the first cut:** v1 was a *topic* — it just stated the 50% stat.
This version adds the missing **tension** (the source is invisible, taken for
granted, and disappearing) and a real **change** (you can't unsee it → protect
it), so it lands as a story instead of a fact.

**Format:** 1:1 square (1080×1080), ~length driven by the voiceover. Six Pexels
ocean clips + captions aligned to the spoken words + MOSS-TTS-Nano voiceover +
music bed (1.5× under the voice, 8s into the track, faded out). Black intro:
music from t=0, voiceover at t=2, first clip fades up from black at ~3s, +4s
music tail after the voiceover.

## Story beats

| arc        | voiceover                                                        | on-screen |
| ---------- | --------------------------------------------------------------- | --------- |
| **want**   | Take a deep breath. You don't even think about it.              | Take a deep breath. |
| **but**    | But that breath didn't come from a forest.                      | Not a forest. |
| (reveal)   | Half of it came from the ocean — from specks too small to see.  | Half came from **the ocean.** |
| (name it)  | Phytoplankton. Trillions, turning sunlight into the air in your lungs. | **Phytoplankton** · turning sunlight into air |
| (tension)  | We barely notice them — and we're losing them.                  | **We're losing them.** |
| **until**  | But once you see them, you can't unsee them. Every other breath is theirs. | Every other breath is theirs. |
| (land)     | So protect the water, and it keeps breathing for you.           | Protect the water. **It breathes for you.** |

## Voiceover (MOSS-TTS-Nano)

> "Take a deep breath. You don't even think about it. But that breath didn't come
> from a forest. Half of it came from the ocean, from specks too small to see.
> Phytoplankton. Trillions of them, turning sunlight into the air in your lungs.
> We barely notice them, and we're losing them. But once you see them, you can't
> unsee them. Every other breath is theirs. So protect the water, and it keeps
> breathing for you."

## Build

```bash
# 1) voiceover (raise the frame cap so the full script renders)
AVENOS_TTS_MAX_FRAMES=800 cargo run --release --manifest-path libs/aven-ai/Cargo.toml \
  --example tts_synth --features tts -- "<the narration above>" \
  .claude/skills/video-edit/examples/ocean-breath/assets/vo.wav

# 2) word-level timing, to align captions to the voice
npx hyperframes transcribe .claude/skills/video-edit/examples/ocean-breath/assets/vo.wav --json

# 3) render + publish
bash .claude/skills/video-edit/scripts/render.sh \
  .claude/skills/video-edit/examples/ocean-breath ocean-breath "Every other breath"
```
