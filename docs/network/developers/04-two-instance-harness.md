---
title: Two-instance harness
---

# Two-instance harness

User pairing guide: [Pair a device](../founders/02-pairing-a-device.md). Troubleshooting: [Troubleshooting](../founders/06-troubleshooting.md).

Use [`scripts/dev-two-instances.ts`](../../../../scripts/dev-two-instances.ts) (**`bun run dev:app2x:mac`** or **`dev:app2x:linux`**). **Central discovery is on by default** (`AVEN_RELAY`); with central mode **`AVEN_RELAY_URL` is required** (e.g. **`127.0.0.1`** for embedded local signal, or **`relay.aven.ceo`** against Fly — see that doc). Set **`AVEN_RELAY=false`** for public Holepunch HyperDHT. Data sync stays **direct P2P** — see [Central P2P signal](05-p2p-signal.md).

The harness launches:

- **`[A]`** — dev server `http://127.0.0.1:1420`
- **`[B]`** — dev server `http://127.0.0.1:1421` (second Tauri bundle id)

Both processes use the normal layout under **`~/Documents/.avenOS/vaults/<slug>/{db,self}`**. Do **not** rely on separate `AVENOS_DATA_DIR_OVERRIDE` trees (`avenAlice` / `avenBob`) for this harness anymore: spawn two windows, then on **each** lock screen **pick or create a persona**.

### Same slug in both windows breaks local-first UX

Opening the **same vault slug** in instance A **and** B at the same time makes both apps contend for one SurrealKV database file — you can see **empty tables**, **`Share` / `DB` stuck Loading**, or lock errors that look like a \"vault disappeared\" bug. Use **distinct slugs** (e.g. `alice` vs `bob`) whenever both processes are unlocked.

Each process receives **`AVENOS_DEV_INSTANCE` = `A` or `B`** for log-line prefixes only; it does **not** split vault storage.

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

## Session 2+ (cold restart reconnect)

Exercise **native reconnect** — pairing + topics already saved; no new invite code:

1. After the first-session steps above succeed, fully **quit** both Tauri apps (Cmd+Q).
2. Start both harness instances again (`bun run dev:app2x:mac` / `dev:app2x:linux` or equivalent), unlock **both** vaults.
3. In the header / Self → peers, expect **Connecting…** briefly, then **Up to date** (often within **about 30–60 seconds** on the public DHT).

**Logs to confirm** (`RUST_LOG=info,avenos::peeroxide=info,avenos::jazz=info`):

- `reconnect_peers` or capped flush after re-joining pair topics (transport nudge after cold start).
- **`groove_p2p link up`** — swarm stream live; coordinator **Live**.
- **`register_peer_sync_client`** — Groove sync attached for that link.

See [Auto-heal & coordinator](06-auto-heal-and-coordinator.md) for heal log patterns.

Repeat **lock one device → unlock**: the locked side should reconnect without a new pairing code once the swarm restarts post-unlock.

## Developer repro: todos in DB vs Spark todo view (offline)

Use this when a row shows in **DB → todos** but **Sparks → …/Todos** stays empty:

1. **Same spark UUID** — the todo page filters by `/sparks/{sparkId}` in the URL. Compare `spark:` in that URL to the `spark_id` column in the explorer. If they differ (e.g. two “My spark” cards), the list is legitimately empty for the route you opened.
2. **Product vs explorer reads** — both use authorized shell reads (`query_table_publish` / `jazz_list`). Open one Mac with the **other peer fully quit** (harness counterpart closed). Unlock only this instance → **Spark todo view** should populate after load if (1) matches. Log watch:  
   `RUST_LOG=debug,avenos::jazz=debug` — expect `table-change drain: republished todos` after remote edits **only after** peers link; baseline display relies on **`jazz_list`** + subscribe seeding (frontend), not inbound sync alone.
