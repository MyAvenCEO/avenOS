---
title: Cross-platform video-edit skill — WASM ffmpeg / Hyperframes Cloud / in-app SFX
summary: Make the video-edit skill runnable without host native binaries (ffmpeg + headless Chrome) so it can run in-browser / in the Tauri app / on edge — by leaning on Hyperframes Cloud render and/or WASM ffmpeg for the audio helpers, and (optionally) moving SFX synthesis into aven-ai via fundsp.
owner: unassigned
created: 2026-06-08
updated: 2026-06-08
tags: [video-edit, hyperframes, ffmpeg, wasm, cross-platform, aven-ai, idea]
goal:
---

# Cross-platform video-edit skill — WASM ffmpeg / Hyperframes Cloud / in-app SFX

## Context

The `video-edit` skill (Hyperframes port) currently depends on **host native
binaries**: `ffmpeg` (audio extract / concat / re-encode / SFX synth / mix) and
headless **Chrome** (Hyperframes' local render). That's fine for local dev but
blocks running the skill in a browser / inside the Tauri app / on edge.

Key realization (why this is an idea, not a quick swap): **switching the skill's
helper ffmpeg calls to `ffmpeg.wasm` does NOT remove the native dependency** —
Hyperframes' *local* render itself requires native ffmpeg + Chrome (`hyperframes
doctor` checks for them). So WASM-ffmpeg alone buys nothing for local render and
is ~3–10× slower.

The real levers for "no local binaries":

1. **Hyperframes Cloud render** — `hyperframes cloud` renders compositions on
   HeyGen's cloud "(no local Chrome/ffmpeg)". This is the cleanest path to run
   the skill cross-platform without bundling binaries. Investigate auth, cost,
   and whether our compile_plan.py → HTML output renders identically in cloud.
2. **WASM ffmpeg for the audio helpers** (`@ffmpeg/ffmpeg`) — only worth it for a
   future **fully in-browser / in-app editor** that does NOT use local
   Hyperframes (e.g. editing inside the avenOS Tauri webview). Then the concat /
   re-encode / mix helpers need to run without a host ffmpeg. ~30 MB core,
   memory-bounded, slower — acceptable for short clips.
3. **SFX synthesis in Rust via `fundsp`** (MIT) — move the procedural SFX
   (whoosh/pop/etc., currently ffmpeg `sine`/`lavfi` recipes in
   `build_sfx_track.py`) into `aven-ai` so they synthesize natively, no ffmpeg,
   reusable in-app. Music stays bring-your-own files (not synthesis).

Relatedly, our on-device STT (Parakeet) + TTS (MOSS) already run natively via
`aven-ai`, reusing models from `~/Documents/.avenOS/models` — so the AI pieces
are already local/offline; the gap is purely the ffmpeg/Chrome render+audio
plumbing.

## Goal

Decide and prototype how the `video-edit` skill runs on a platform with **no
native ffmpeg/Chrome** — most likely Hyperframes Cloud for render + (optionally)
WASM ffmpeg for the audio helpers, with SFX synth moved into `aven-ai`/fundsp.
"Good" = render + score a short clip end-to-end on a machine/runtime without a
host ffmpeg or Chrome install.

## Acceptance criteria

- [ ] A short clip renders via `hyperframes cloud` from our compile_plan.py HTML — proven by the cloud render producing a matching mp4.
- [ ] The audio helpers (concat/mix/re-encode) have a WASM-ffmpeg path that runs without host ffmpeg — proven by running them with native ffmpeg off PATH.
- [ ] (optional) SFX track synthesized via `fundsp` in `aven-ai` instead of ffmpeg — proven by a cargo example emitting a WAV.

## Progress log

- `2026-06-08` — Created in idea. Logged after deciding NOT to swap helper ffmpeg → wasm now (wouldn't remove Hyperframes' native-ffmpeg need); native kept for local, this captures the real cross-platform path (Hyperframes Cloud + optional WASM helpers + fundsp SFX) for later.
