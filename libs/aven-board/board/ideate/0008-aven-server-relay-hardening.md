---
title: aven-server relay hardening — durable store across restart + WS registry pruning
summary: Two robustness follow-ups surfaced shipping the hosted aven-ceo relay on Sprites (M1/M2). (1) The blind-replica RocksDB store self-heal-wipes on every restart instead of reopening cleanly. (2) The WS peer registry never prunes peers that disconnect and never return (a deliberate fix for the network-switch race left a minor leak).
owner: unassigned
created: 2026-06-04
updated: 2026-06-04
tags: [aven-server, transport, websocket, rocksdb, durability, sprites]
goal:
---

# aven-server relay hardening — durable store across restart + WS registry pruning

> **Why now:** the hosted aven-ceo relay (WebSocket sync over the Sprite's public
> URL) now works end-to-end on TestFlight (see [`0004-aven-server-mini`](../test/0004-aven-server-mini.md)
> and `docs/AvenTestflightSyncPlan.md`). Two robustness gaps were knowingly deferred
> while getting the round-trip green; capture them before they bite in real use.

## Context

`aven-server` is the blind-replica relay (`libs/aven-server/src/main.rs`,
`libs/aven-server/src/ws_server.rs`). During the Sprites M1/M2 work two issues were
left as follow-ups:

1. **RocksDB self-heal-wipe on restart.** On a Sprite hibernate/stop/redeploy the
   process is signalled; on the next boot RocksDB fails to reopen with
   `Corruption: While creating a new Db, wal_dir contains existing log file: …`, so
   the self-heal path (added intentionally) resets the data dir and re-pulls from
   peers. That keeps sync correct (the store is a re-pullable ciphertext cache) but
   means the durable backup never survives a restart — the relay is effectively
   ephemeral. A graceful `SIGTERM` flush + clean RocksDB `Close` was added in
   `main.rs`, but it does **not** reliably finalize the store (suspected: axum's
   `with_graceful_shutdown` waits on the long-lived `/sync` WS connections to drain,
   so `Close` is interrupted by the platform's hard kill). Confirm the real cause
   and make a normal stop finalize the DB so reopen is clean.

2. **WS registry never prunes.** `ws_server.rs` deliberately stopped removing a
   peer's registry entry on its reader-task exit, because on a network switch the
   client reconnects with a fresh connection that overwrites the entry, and a
   long-lived half-open reader removing late would clobber the newer connection
   (the network-switch race). The trade-off: a peer that disconnects and never
   returns leaves a dead `mpsc::Sender` in the registry forever (`send_to` to it
   fails harmlessly). Over a long-lived relay with churn this is a slow leak.

## Goal

The relay survives a normal restart with its store intact, and the WS registry
prunes peers that disconnect without reconnecting — without reintroducing the
network-switch clobber race.

**Completion condition** (the hand-off line for `/goal`):

> A test/log run shows: (a) after `sprite-env services restart aven-server` the log
> contains the clean-shutdown finalize line and **no** `store unreadable — resetting`
> on the next boot (store preserved across restart); and (b) a peer that connects,
> drops, and does not reconnect is removed from the registry, while a peer that
> drops-then-reconnects keeps a live entry (race-free) — proven by a `ws_server`
> test. `cargo test -p aven-server` exits 0.

## Approach

- **Durability:** finalize RocksDB on shutdown independent of axum's connection
  drain — e.g. catch `SIGTERM` directly, stop accepting, then `Arc::try_unwrap` the
  engine + `shutdown()` (run `Close`) on a bounded timer before exit, rather than
  relying on `with_graceful_shutdown` (which blocks on open `/sync` sockets). Verify
  the resulting data dir reopens without the `wal_dir contains existing log file`
  error. Once clean, the deploy script's wipe-on-redeploy can default off.
- **Registry pruning:** generation-tag each connection — `registry: HashMap<PeerId,
  (u64 gen, Sender)>` + an `AtomicU64`; `accept` inserts with a fresh `gen`; the
  reader removes only if the current entry's `gen` still matches its own. Prunes
  never-returning peers and is race-free (a reconnect bumps the `gen`, so the old
  reader's compare fails and it won't remove the newer entry).
- Out of scope: the auth/invite/ACC model (separate work) and server↔server mesh.

## Acceptance criteria

- [ ] `aven-server` finalizes RocksDB on a normal stop; next boot reopens the same
      store with no `store unreadable — resetting` (verified in the Sprite log across
      a `services restart`).
- [ ] Deploy redeploys without wiping the data dir by default (durable backup
      persists across redeploys).
- [ ] `ws_server` test: drop-without-reconnect prunes the registry entry;
      drop-then-reconnect keeps a live entry (no clobber).
- [ ] `cargo test -p aven-server` exits 0.

## Progress log

- `2026-06-04` — Created in idea. Deferred while landing the WebSocket sync transport
  + TestFlight round-trip (build 86): client auto-reconnect supervisor + server
  race-fix (no-remove-on-reader-exit) shipped; this item tracks the two robustness
  debts that left behind (durable store across restart, registry pruning).
