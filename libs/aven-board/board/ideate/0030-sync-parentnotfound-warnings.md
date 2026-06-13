---
title: Sync ParentNotFound — synced batches rejected on causal-ordering gaps
summary: aven_db::sync_manager::inbox repeatedly logs `failed to apply synced row batch ... ParentNotFound(BatchId(...))` — a synced batch references a parent version not present locally on that branch. Benign-looking (a WARN, no local corruption) but the row never lands on that peer until/unless the parent arrives.
owner: unassigned
created: 2026-06-13
updated: 2026-06-13
tags: [aven-db, sync, bug]
goal:
---

# Sync ParentNotFound — synced batches rejected on causal-ordering gaps

## Context

Recurring during dev (both single + 2× instances, and against the Sprite relay):

```
WARN aven_db::sync_manager::inbox: failed to apply synced row batch
  row_id=019ec0bb-… branch_name=client-0ad1740af78b-main
  err=ParentNotFound(BatchId([1, 158, 192, …]))
```

`row_histories/mutations.rs` raises `ParentNotFound` when an inbound batch's `parents` aren't yet in
local history for that branch (`mutations.rs:~228`). The inbox declines to apply it — a `WARN`, not
corruption; local data is fine, but that **remote** batch isn't applied on this peer until the parent
shows up.

Two cases: **transient** (child arrived before parent over WS → self-heals when the parent lands) vs
**persistent** (a peer has a real gap — e.g. the relay was deployed/wiped after some writes, so it
never received the parent; or local rows were rebuilt while the peer kept its own history). The
recurring, steady stream of these in the logs suggests it isn't fully self-healing — likely the relay
missing parents, or a request-missing-parents path that isn't firing/converging.

Relates to the frontier work ([[0036-frontier-as-peer-memory-cache]] / [[0027-frontier-change-feed]])
only tangentially — that's local read freshness; this is peer→peer batch application.

## Goal

Synced batches converge: a peer that's missing a parent **requests + receives** it (or the ordering
is fixed so children never arrive before parents), and the `ParentNotFound` WARN stream stops in
steady state — no permanently-unapplied rows on any peer.

When moved to discover, make measurable: e.g. a sync test that delivers batches out of causal order
and asserts they all eventually apply (no permanent ParentNotFound); and/or a metric that the WARN
count returns to zero after a sync settles.

## Acceptance criteria

- [ ] A test reproduces out-of-order batch delivery and asserts eventual convergence (0 unapplied).
- [ ] The dev/relay logs no longer show a steady ParentNotFound stream in steady state.

## Progress log

Newest entry first.

- `2026-06-13` — Captured from dev logs while working memory/frontier cards (0027–0036). Pre-existing;
  not caused by that work. Needs its own investigation (sync inbox + missing-parent request path / relay history gaps).
