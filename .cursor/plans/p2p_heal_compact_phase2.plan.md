---
name: P2P heal compact phase 2
overview: "Phase 1 landed: unified reconnect_peers ritual, worker-gated transport suppress, compact dedup (peer_util, LiveLinkRegistry removal, path/foreground nudge dedupe). Phase 2–4: smoke QA gate, transport-probe unification, lib.rs splits, then high-risk live-peer truth — only after manual e2e passes."
todos:
  - id: qa-smoke-gate
    content: "Manual e2e on Mac+iPhone before further refactors: LAN pair → 5G → WiFi; kill remote app; airplane toggle; foreground after 5+ min background. Pass = reconnect ≤15s, sync resumes, logs show one reconnect_peers per path change."
    status: pending
  - id: unify-transport-probes
    content: "Merge probe_transport_upgrades, schedule_post_link_upgrade_probe, maybe_probe_transport_upgrades into one internal probe_peers(force, reason) in tauri-plugin-peer; keep policy in transport_rank.rs"
    status: pending
  - id: extract-pairing-module
    content: "Extract pairing + invite flow from lib.rs (~350 lines) into pairing.rs; lib.rs keeps PeerCtl wiring and plugin init only"
    status: pending
  - id: extract-swarm-env
    content: "Move env_truthy_os / build_p2p_diagnostics / relay config from lib.rs into swarm_env.rs (structural, no behavior change)"
    status: pending
  - id: mesh-nudge-predicate
    content: "Centralize 'should nudge discovery' in reconnect_peers / nudge_allowlisted_discovery — skip when all allowlisted DIDs are Live or actively connecting; document in 01-architecture.md"
    status: pending
  - id: remove-bridge-fallback
    content: "Remove snapshot_live_linked_dids cid-map fallback in hyperswarm_groove_bridge.rs once tests assert registry always attached at init"
    status: pending
  - id: shared-did-crate
    content: "Optional: dedupe did.rs (plugin) vs jazz_auth peer_did_from_ed25519 — single crate or re-export; low priority until heal stable"
    status: pending
  - id: coordinator-live-truth
    content: "HIGH RISK — defer: merge active_remote_clients + swarm_workers visibility into PeerLinkCoordinator; requires Groove register timing tests"
    status: pending
isProject: false
---

# P2P transport / pairing / heal — phase 2+ refactoring plan

## Completed (phase 1)

- **`PeerCtl::reconnect_peers`** — single heal ritual (`peer_reconnect.rs`); all triggers funnel here.
- **Worker-gated suppress** — `Handshaking`/`TransportUp` suppress transport only when `worker_active`; phantom rows cleared before nudge.
- **Compact slice** — `peer_util::now_ms`, deleted `live_link.rs`, `PeerLinkCoordinator` everywhere, `emit_mesh_push()`, pairing reset via `ReconnectOpts::pairing_reset()`.
- **Path/foreground dedupe** — plugin heals DHT; Jazz `mesh_reconcile(nudge_discovery: false)` on path/foreground; adaptive tick uses `true`.

## Gate: do not start phase 2 until QA passes

Run on **Mac + iPhone** (TestFlight or dev builds):

| Scenario | Expected |
| -------- | -------- |
| LAN pair → iPhone to 5G | Reconnect ≤15s; `linkedCount` recovers; Jazz sync resumes |
| Kill remote app → reopen | Adaptive tick (8s) or faster notify path recovers without manual retry |
| Airplane toggle (one device) | Mux keepalive tears down ~10s; heal on path satisfied |
| iOS background 5+ min → foreground | `reconnect_peers` + register-only reconcile; no double DHT storm in logs |
| Walk LAN → relay → LAN | Transport mode updates in mesh UI; no manual re-invite |

**Log signatures to verify:**

- `reconnect_peers (network path changed): ...` once per path flip
- No endless `nudge pairing discovery` with `linkedCount: 0` and DHT `peer_count>0`
- `prepare_reconnect` only when `global_reset=true` in reconnect log line

If LAN→5G fails: **stop refactoring** — debug coordinator suppress / stale ClientId / mesh register timing first.

---

## Phase 2 — medium risk (~100–150 lines net)

### 2a. Unify transport probes (do first)

**Problem:** Three probe entry points with overlapping interval maps and spawn logic.

**Files:** `projects/tauri-plugin-peer/src/lib.rs` (`probe_transport_upgrades`, `schedule_post_link_upgrade_probe`, `maybe_probe_transport_upgrades`)

**Target:**

```rust
async fn probe_peer_transports(&self, opts: ProbeOpts) -> Result<(), String>
```

- `ProbeOpts { force: bool, reason: &'static str, did_filter: Option<String> }`
- Policy stays in `transport_rank.rs`
- Call sites: post-link (5s delay), periodic reconcile, path-change reconnect

**Tests:** existing `transport_rank` tests; add one colocated test for interval dedup if needed.

### 2b. Extract `pairing.rs`

Move from `lib.rs`:

- `PairSession`, invite create/accept/cancel
- `reset_transport_for_pairing` callers context
- Pair topic join/flush helpers used only by pairing

Keep in `lib.rs`: `PeerCtl` struct, `start_swarm`, allowlist, `reconnect_peers` wiring, plugin `init`.

### 2c. Extract `swarm_env.rs`

Move env parsing + `P2pDiagnostics` build (~390 lines). No behavior change — enables future deletion of duplicate relay probe logic.

### 2d. Mesh nudge predicate

In `nudge_allowlisted_discovery` / `reconnect_peers`: early return when every allowlisted DID is `Live` or in `snapshot_connecting_dids()`. Reduces adaptive-tick noise.

---

## Phase 3 — low risk cleanup

- Remove `snapshot_live_linked_dids` bridge fallback (registry always attached in `init`).
- Collapse duplicate `#[cfg]` blocks in `jazz/mod.rs` where macOS/non-macOS bodies match.
- Update `01-architecture.md` auto-heal section after probe unification.

---

## Phase 4 — high risk (defer weeks)

| Item | Why defer |
| ---- | --------- |
| Merge `active_remote_clients` into coordinator | Breaks `peer_send_ready`, Groove register timing |
| Single phase model (drop DHT substate OR coordinator phase) | Mesh UI contract in `peer_mesh_state.rs` + TS types |
| Fold `peer_mesh_state` into plugin | Violates layer ownership (`p2p-mesh-compact.mdc`) |
| peeroxide `swarm.rs` heal changes | Vendored fork; only thin hooks |

---

## Must NOT merge

- Bridge **reader/writer split** (`SecretStream::into_split`) — production decrypt fix
- **Sync suppress snapshot** (`suppress_pks`) — peeroxide callback is sync
- **Groove actor** serial `conn` — all mesh reconcile stays on actor mailbox
- **`avenos:runtime`** as sole mesh ingress — no duplicate `peer:mesh-*` payloads

---

## Suggested PR sequence

1. **This commit** — unified heal + compact slice (phase 1)
2. **PR: transport probes** — after QA gate green
3. **PR: pairing.rs + swarm_env.rs** — structural only
4. **PR: nudge predicate + bridge fallback removal** — after 1 week stable TestFlight

---

## Related docs

- [01-architecture.md](../../libs/docs/network/developers/01-architecture.md)
- [p2p-mesh-compact.mdc](../rules/p2p-mesh-compact.mdc)
- [compact-simplify-consoldiate.mdc](../rules/compact-simplify-consoldiate.mdc)
- Prior work: `p2p_link_coordinator` commit, `p2p_mesh_resilience_d3c9fa61.plan.md`
