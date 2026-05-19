---
title: Two-instance harness
---

# Two-instance harness

Use `scripts/dev-two-instances.ts` (or your usual two-window dev flow). **`bun run dev:two-instances`** launches:

- **`[A]`** — dev server `http://127.0.0.1:1420`
- **`[B]`** — dev server `http://127.0.0.1:1421` (second Tauri bundle id)

Both processes use the normal layout under **`~/Documents/.avenOS/vaults/<slug>/{db,self}`**. Do **not** rely on separate `AVENOS_DATA_DIR_OVERRIDE` trees (`avenAlice` / `avenBob`) for this harness anymore: spawn two windows, then on **each** lock screen **pick or create a persona**. Use **two different vault slugs** when testing cross-person sync so only one process holds the SurrealKV lock for each DB.

Destructive reset of **all** local vaults:

```bash
rm -rf ~/Documents/.avenOS/vaults
```

On **each** instance:

1. Unlock (Touch ID / dev bypass). If both windows should represent different humans, choose different entries at **Who are you?**
2. Wait for Hyperswarm (`hyperswarm_up` in logs).
3. **Self → Connect & trust** — Window A: *Invite*, Window B: *Accept* with the code → both show the peer as active (labels come from onboarding / pairing).
4. **Self → Workspace sharing** — On A, select the default spark → **Grant admin** and pick B's DID from the paired allowlist.
5. Open todos (or any spark-scoped data) on either side; both should merge updates after sync. Non-admin sparks stay private.

If sync seems quiet, watch the dev log for `groove_p2p link up peer=...` (proves the swarm connection landed) and the periodic mesh reconcile (`peer-mesh reconcile`) — the app auto-registers each new peer with Jazz sync as soon as the swarm connects.

## Developer repro: todos in DB vs Spark todo view (offline)

Use this when a row shows in **DB → todos** but **Sparks → …/Todos** stays empty:

1. **Same spark UUID** — the todo page filters by `/sparks/{sparkId}` in the URL. Compare `spark:` in that URL to the `spark_id` column in the explorer. If they differ (e.g. two “My spark” cards), the list is legitimately empty for the route you opened.
2. **Product vs explorer reads** — both use authorized shell reads (`query_table_publish` / `jazz_list`). Open one Mac with the **other peer fully quit** (harness counterpart closed). Unlock only this instance → **Spark todo view** should populate after load if (1) matches. Log watch:  
   `RUST_LOG=debug,avenos::jazz=debug` — expect `table-change drain: republished todos` after remote edits **only after** peers link; baseline display relies on **`jazz_list`** + subscribe seeding (frontend), not inbound sync alone.
