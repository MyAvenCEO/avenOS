---
title: Make spark un-share / revoke reactive (catalogue removals)
summary: Granting a spark is now live across all tables, but un-sharing (revoke) doesn't reactively REMOVE the spark from a grantee's list — it needs a reload. The sparks catalogue store merges by key (never removes); switch it to replace once we confirm the backend never emits a transient-empty sparks snapshot.
owner: unassigned
created: 2026-06-02
updated: 2026-06-02
tags: [sync, reactivity, sparks]
goal:
---

# Make spark un-share / revoke reactive (catalogue removals)

> Follow-up to the generic table-reactivity refactor (commit `d3aa11f`) and the
> sparks force-publish fix (`a64908d`).

## Context

Admin grants are now fully reactive for every table: a vault-shell re-hydrate
force-publishes the spark catalogue plus whatever page the user is viewing, so a
newly granted spark and its data appear instantly without restart.

The one remaining gap is **removal**. The frontend sparks store uses the
`catalogue` snapshot policy (`TABLE_POLICY` in
`app/src/lib/jazz/store.svelte.ts`), which **merges by key** and ignores empty
snapshots. That was a deliberate guard against a transient-empty / partial
`sparks` snapshot during a vault-shell re-hydrate (access flicker). The
trade-off: a spark that is **un-shared / revoked** never disappears from the
grantee's list reactively — it only clears on a full reload / restart.

Data tables (todos, messages, files) already handle revoke correctly because
they use the default `replace` policy (the snapshot is the complete authoritative
visible set, so a removed row vanishes).

## Goal

Un-sharing a spark removes it from the grantee's spark list **live**, with no
restart — while keeping the spark list stable during a re-hydrate (no flicker to
empty and back).

The clean fix is to drop the catalogue merge and let `sparks` use the same
`replace` policy as every other table — but only once we've confirmed the backend
never emits a transient-empty `sparks` snapshot mid-hydrate. The drain already
re-hydrates the shell *before* it calls `publish_table_snapshot_force("sparks")`,
so the snapshot *should* always be complete; this needs to be verified on the 2×
dev harness, not assumed.

## Plan

_Filled in when this moves to `plan`._

Likely shape:
- Verify (2× harness, with logging) that `query_table_publish(client, shell, "sparks")`
  is never empty/partial across a grant + revoke cycle once the shell is hydrated.
- If confirmed: remove `sparks` (and `keyshares`) from `TABLE_POLICY` so they fall
  through to `replace`; delete the now-dead `catalogue` branch + `rowKey` merge if
  nothing else uses it.
- If a real transient-empty window exists: fix it backend-side (don't emit a
  `sparks` snapshot until the shell has rows) rather than papering over it in the
  store.

## Acceptance criteria

Each must be checkable from the transcript (a command + its output proves it).

- [ ] On the 2× harness: device A revokes a spark shared with B → the spark
      disappears from B's list within the sync window, no restart — shown via
      screenshot or logged store state.
- [ ] Granting still works live (no regression) and the spark list never flickers
      to empty during a re-hydrate — shown by drain/snapshot logs.
- [ ] No per-table special case remains for `sparks` unless a transient-empty
      window is proven to exist (in which case it's fixed backend-side and noted).

## Progress log

Newest entry first.

- `2026-06-02` — Created in idea. Spun out of the generic table-reactivity
  refactor (`d3aa11f`): grants are reactive across all tables; catalogue-row
  *removal* (revoke) is the remaining non-reactive case by deliberate choice.
