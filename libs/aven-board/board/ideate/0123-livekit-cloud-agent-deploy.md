---
title: Deploy the voice agent worker to LiveKit Cloud
summary: Take the local agent worker from 0122 and deploy it with `lk agent create` / `lk agent deploy` — the other half of the "is LiveKit Cloud our stack?" question.
owner: unassigned
created: 2026-08-09
updated: 2026-08-09
tags: [voice, livekit, deploy]
goal:
---

# Deploy the voice agent worker to LiveKit Cloud

## Context

Carved out of [[0122]], which deliberately runs the agent worker **locally** so
the voice → tool → UI loop could be proven without a deploy pipeline in the way.
Once that loop is green, the remaining half of goal 2 ("do we adopt LiveKit
Cloud?") is whether the hosted deploy path is any good.

The CLI flow, from the dashboard modal and the docs:

```sh
lk cloud auth
lk agent create          # registers the agent, writes livekit.toml, generates a Dockerfile if absent
lk agent deploy          # uploads source, builds the image in LiveKit's build service, deploys
lk agent logs            # monitoring
```

Node/TypeScript is supported alongside Python, so `libs/aven-voice-agent` should
be deployable as-is. Open questions worth answering while doing it: how bun
workspaces interact with the generated Dockerfile (the starter assumes pnpm and a
standalone repo, ours is a workspace member), how secrets are supplied to the
container, cold-start latency, and cost per session.

`livekit.toml` should be committed once it exists.

## Goal

The dashboard talks to an agent running in LiveKit Cloud, not on the laptop —
with a recorded verdict on build time, cold start, latency delta vs. local, and
cost.

## Progress log

- `2026-08-09` — Created in ideate; carved out of 0122 during its discovery.
