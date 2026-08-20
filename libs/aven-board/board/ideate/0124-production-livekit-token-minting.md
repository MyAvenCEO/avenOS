---
title: Production LiveKit token minting (Tauri command, not a dev endpoint)
summary: Replace 0122's dev-only SvelteKit token route with a Rust `#[tauri::command]` that signs the JWT in the binary, so voice works in the shipped app instead of only under `vite dev`.
owner: unassigned
created: 2026-08-09
updated: 2026-08-09
tags: [voice, livekit, tauri, security]
goal:
---

# Production LiveKit token minting

## Context

[[0122]] mints LiveKit access tokens from `app/src/routes/api/livekit-token/+server.ts`.
That route exists **only under `vite dev`** — the app builds with
`adapter-static` and `ssr = false`, so there is no server in the shipped Tauri
bundle and the route simply vanishes. Voice therefore works in the browser
preview and nowhere else.

The shape that fits avenOS: a `#[tauri::command]` that signs the JWT in Rust,
with `LIVEKIT_API_SECRET` living in the Tauri binary's env rather than anything
reachable from JS — the same pattern `google_oauth_config` already uses for the
desktop OAuth secret.

Open questions: whether tokens should instead be minted by the aven-node relay
(so iOS/web share one path and grants can be tied to identity/caps), and how room
naming and per-user grants should work once there is more than one participant.

## Goal

Connecting to a voice room works in the built Mac/iOS app, with the API secret
provably absent from the JS bundle.

## Progress log

- `2026-08-09` — Created in ideate; carved out of 0122 during its discovery.
