---
title: Troubleshooting
---

# Troubleshooting

Most mesh issues resolve within **15–30 seconds** if both devices are unlocked and online. Prefer waiting over re-pairing.

## Quick checks

1. **Both unlocked** — swarm starts after identity unlock.
2. **Same beta / build era** — mismatched TestFlight versions can break discovery.
3. **Local Network** (iOS) — Settings → AvenOS → Local Network enabled.
4. **Not revoked** — peer row status should be **active**, not revoked.
5. **Spark admin** — chip **Up to date** but spark empty → check **Grant admin**, not pairing.

## Symptom guide

| Symptom | Likely cause | Try |
| -------- | ------------- | ----- |
| Stuck **Pairing…** | Code expired or typo | Cancel invite; new code; same relay/build on both sides |
| **Connecting…** for minutes | Relay/firewall/NAT | Wait; move both to same Wi‑Fi; then **Retry swarm** |
| **Up to date** but no spark data | No admin grant | Spark settings → Grant admin for that device |
| Worked on Wi‑Fi, failed on 5G | Normal path change | Wait ~15s; should show Relay/Punched then sync |
| **Offline** after revoke | Expected | Pair again if you want trust back |
| Mac empty tables with two dev windows | Same vault slug open twice | Use distinct personas/slugs in dev harness |

## When to re-invite

Re-pair only if:

- You **revoked** the device intentionally
- Trust row missing after restore/migration
- Both sides **Retry swarm** and still **Offline** after several minutes on good networks

Re-inviting while a half-dead link exists can sometimes help, but AvenOS now clears phantom “handshaking” state automatically — try waiting first.

## Beta diagnostics

On TestFlight builds, **Self → Connect & trust** may include:

- DHT bootstrap host and HTTPS relay probe
- **`linkedCount`** — must be ≥1 on both sides for sync (mux-ready links only)
- Recent Rust log excerpt for support

Hosted relay and env details: [Central P2P signal](../developers/05-p2p-signal.md) (developers).

Lab reproduction with two Mac windows: [Two-instance harness](../developers/04-two-instance-harness.md).

iOS physical device checklist: [iOS TestFlight P2P smoke](../../deploy/ios-testflight-p2p-smoke.md).
