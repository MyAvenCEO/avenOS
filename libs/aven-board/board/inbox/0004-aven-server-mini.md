---
title: Aven Server Mini — headless, stateless TCP aven on a remote fly machine
summary: The smallest deployable aven — a headless, stateless TCP-based server pushed to a remote fly machine, ahead of the full stateful blind-mirror binary.
owner: unassigned
created: 2026-06-02
updated: 2026-06-02
tags: [sync, server, deploy, idea]
goal:
---

# Aven Server Mini — headless, stateless TCP aven on a remote fly machine

> **Idea / inbox.** Not specced yet — capture only. The completion condition and
> the full plan get written when this moves to `plan/`.

## Context

The canonical [`docs/AvenServerPlan.md`](../../../../docs/AvenServerPlan.md) lands
the always-on aven as **P3**: one Rust binary that is *stateful* — a RocksDB blind
**mirror** + a SQLite **auth** store on a fly volume (§4.4), serving auth + blind
backup + rendezvous + indexer over authenticated TLS. That's the durable
destination, but it carries the heaviest moving parts (persistence, the
`replicate`/blind-relay capability, the auth port) and a fly **volume**.

**Aven Server Mini** is the *thin slice* that gets a real aven onto a remote box
first: a **headless, stateless, TCP-based** server we can actually push to a
**remote fly machine** and dial from a device. No RocksDB directory, no fly
volume, no durable mirror — just the headless host + the TCP `SyncTransport`
fan-out, holding sync state **in memory only** (rendezvous + relay for peers that
are online together; nothing survives a restart). It de-risks the *deploy +
reachability* axis (containerize, push to fly, dial it over the open internet)
independently of the *persistence + capability* axis the full P3 binary owns.

Relation to the existing plan and board:
- **Subset of P1/P3** of [`AvenServerPlan.md`](../../../../docs/AvenServerPlan.md) —
  reuses the `ServerSyncTransport` / `ServerListener` seam (§2.3), but stays
  *stateless* (no §4.4 stores) and may stay **plain TCP** first (TLS + did:key
  challenge is the hardening that follows — §2.2 #2 / §6).
- **Not** the deferred peeroxide mesh (board
  [`0003`](./0003-p2p-mesh-peeroxide.md)) — this is still the star-topology TCP
  aven, just minimized and shipped to fly early.

## Goal

A headless, stateless `aven-server`-mini process runs on a **remote fly machine**
and a device on the open internet dials it over TCP and converges a spark live —
proving the *deploy + dial* path before the stateful blind-mirror binary exists.
(Sharpen into a single, transcript-verifiable completion condition when this moves
to `plan/`.)

## Open questions (resolve when planning)

- **Stateless boundary** — in-memory rendezvous/relay only, or a thin spill? What
  exactly is acceptable to lose on a fly machine restart?
- **TCP vs TLS for the first push** — ship plain TCP to fly to prove reachability,
  then layer TLS + the did:key challenge (§2.2)? Or TLS from the first deploy?
- **fly shape** — `fly machine` vs `fly app`; region; ports exposed; how the
  device is told the aven's `host:port`.
- **Where the code lives** — a `--stateless`/mini mode of the planned
  `libs/aven-server` bin, or a separate minimal entrypoint that shares
  `aven-p2p`.

## Acceptance criteria

_Filled in when this moves to `plan/`. Each must be provable from command output._

- [ ] A headless stateless aven builds and boots with no persistent store.
- [ ] It deploys to a remote fly machine and is reachable over TCP.
- [ ] A device dials the fly-hosted aven and converges a spark live.

## Progress log

- `2026-06-02` — Created in inbox. Idea: a headless, stateless, TCP-based aven
  pushed to a remote fly machine — the thin deploy-first slice ahead of the full
  stateful blind-mirror binary in `docs/AvenServerPlan.md` (P3).
</content>
</invoke>
