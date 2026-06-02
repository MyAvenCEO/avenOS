---
title: Doublecheck TCP security / encryption handshake & security architecture
summary: Audit the dev/TCP SyncTransport handshake, peer authentication, and the end-to-end encryption/key model (biscuits, DEKs, keyshares) before the TCP/TLS aven-server ships. Confirm there are no plaintext-identity or unauthenticated-sync gaps.
owner: unassigned
created: 2026-06-02
updated: 2026-06-02
tags: [security, transport, tcp, encryption, architecture]
goal:
---

# Doublecheck TCP security / encryption handshake & security architecture

> **Why now:** the TCP/TLS aven-server is the next sync transport to ship (see
> [`0003-p2p-mesh-peeroxide`](./0003-p2p-mesh-peeroxide.md) and
> [`docs/AvenServerPlan.md`](../../../../docs/AvenServerPlan.md)). Before it carries
> real data off-device, the handshake, peer authentication, and key model need a
> deliberate security pass — not just "it syncs".

## Context

Today's `dev` peer transport (`TcpSyncTransport`, `AVENOS_DEV_PEER_SYNC`) does a
**plaintext 32-byte peer-id exchange** with no transport encryption — fine for
loopback dev, dangerous if it ever leaks into a shipped path. The 0003 spike notes
that peeroxide's Noise handshake *removes* that plaintext exchange; the TCP/TLS path
must close the same gap a different way (TLS + biscuit-subject DID binding).

Authorization currently rests on the biscuit sync gate
(`biscuit_resolver::may_sync`, `app/src-tauri/src/biscuit_resolver.rs`) reading the
live vault shell + spark ACL. The shell-catchup path ships `sparks`/`keyshares`
**ungated** as a trust bootstrap (`SHELL_CATCHUP_TABLES` in
`libs/aven-db/src/sync_manager/mod.rs`) — this ungated bootstrap is exactly the kind
of seam worth a second look.

## Goal

A written, reviewed answer to: *can an unauthorized or impersonating peer obtain
plaintext data, a DEK, or a biscuit it shouldn't have, over any TCP path we intend
to ship?* — with each claim backed by a code reference or a reproducible test, not
assertion.

When this moves to **plan**, sharpen into a single completion condition (e.g. a
threat-model doc + a failing-closed test for each identified gap).

## Areas to audit

- **Handshake / peer identity binding** — how the remote peer's DID is established
  on the TCP transport, and whether it is cryptographically authenticated (not just
  asserted). The dev path's plaintext 32-byte exchange is the known weak spot.
- **Transport encryption** — TLS config for the aven-server path; cipher/version
  floor; cert/identity verification; downgrade/MITM resistance.
- **Ungated shell bootstrap** — what `sparks`/`keyshares` rows actually reveal when
  shipped ungated, and whether ciphertext-only guarantees hold (DEK never leaves
  except inside a keyshare wrapped to the recipient).
- **Authorization gate** — confirm `may_sync` fails *closed* (Pending/Deny) under
  every missing-ACL / missing-shell / revoked-peer condition, and that revoke
  (`remove_peer_sync_client` / Forget) actually stops data flow mid-session.
- **Key model** — biscuit attenuation (`owns` facts), DEK wrapping in keyshares, and
  rotation/revocation story end to end.

## Acceptance criteria

Each must be checkable from the transcript / a test run.

- [ ] Threat model written: actors, trust boundaries, and the assets (plaintext, DEK,
      biscuit) each TCP path could expose.
- [ ] Every shipping TCP path has authenticated peer identity (no plaintext-only
      identity assertion) — proven by code reference.
- [ ] A test demonstrates `may_sync` denies an un-granted / revoked peer for gated
      spark data.
- [ ] Each identified gap is either fixed or has a tracked follow-up item.

## Progress log

- `2026-06-02` — Created in inbox. Captured alongside the spark-admin live-sync
  investigation; pairs with the TCP/TLS aven-server work that 0003 is deferred
  behind.
