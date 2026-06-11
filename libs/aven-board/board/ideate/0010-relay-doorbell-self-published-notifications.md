---
title: Relay-doorbell self-published native notifications (iOS + macOS)
summary: A push from the relay is just a contentless doorbell — it wakes the app, the app runs a short bounded aven-db sync, and then self-publishes a local notification from the synced+decrypted data. Privacy-aligned (no message text in the payload) and the only viable iOS background path, since iOS suspends the local-first sync loop. macOS can self-publish directly off the live sync loop with no push at all.
owner: unassigned
created: 2026-06-11
updated: 2026-06-11
tags: [notifications, ios, macos, sync, relay, push, apns]
goal:
---

# Relay-doorbell self-published native notifications (iOS + macOS)

## Context

Sync is local-first: in-process `tokio` loops hold a persistent WebSocket to the
aven-node relay (TLS) plus Hyperswarm peer discovery (`app/src-tauri/src/jazz/conn.rs`,
`.../jazz/mod.rs` `spawn_dev_peer_sync`). New rows landing fire `run_table_change_drain`
→ `snapshot_broadcast` (`app/src-tauri/src/jazz/drain.rs:235`) — that drain is the
natural "new data arrived" hook to fire a notification from.

The problem isn't aven-db, it's the OS: **iOS suspends a backgrounded app within
seconds**, freezing the process — the WebSocket dies and the sync loop stops. So a
suspended iOS app can never "notice" peer/relay data on its own. (This is why
background data sync "doesn't work right" on iOS.) macOS does **not** suspend a
running app, so its sync loop stays live.

Plumbing already in place but **not activated**: `Info.ios.plist` declares the
`remote-notification` background mode; `ios-template/aven-os-app_iOS.entitlements`
sets `aps-environment=production`; App ID `ceo.aven.os` has Push Notifications +
Associated Domains enabled (see `docs/deploy/ios-associated-domains-and-push.md`).
What's missing entirely: APNs registration / device-token handling, the background
remote-notification delegate, any local-notification capability, and
`tauri-plugin-notification` (not installed). macOS `Entitlements-appstore.plist` has
no notification capability at all.

## The idea — relay doorbell, app authors the notification

```
relay has new data for device
  → relay sends APNs SILENT push (content-available:1, no visible alert)
  → iOS wakes app ~30s in background  (remote-notification mode, already in plist)
  → app runs a SHORT bounded sync (frontier catch-up against the relay)
  → new rows land → snapshot_broadcast drain fires (drain.rs:235)
  → app self-publishes a local notification from the synced+decrypted data
  → app calls the fetch completion handler → iOS suspends again
```

The push payload is **contentless** — just "wake up, something changed (maybe for
spark X)." The device syncs, decrypts locally, and writes the human-readable
notification itself. For an E2E / local-first system that's a privacy win, not a
compromise.

**macOS:** no push needed. While the app (or a LaunchAgent/login-item) is running,
the same `snapshot_broadcast` drain hook posts a local notification the moment new
rows of interest arrive.

## Known caveat (must design around)

Silent pushes are **best-effort and rate-limited by iOS** (a few/hour, throttled
harder on Low Power Mode / low battery). If iOS withholds background time, the app
never wakes and no notification appears. So this is "good enough" for
eventually-delivered, non-critical notifications — **not** guaranteed instant
delivery. For must-never-miss alerts, the relay should instead send a visible alert
push (text in payload), optionally with a Notification Service Extension
(`mutable-content:1`) to decrypt/enrich before display — but the NSE is a separate
~24 MB process and **cannot** run the full Groove/aven-db sync stack, only a light
fetch. Do **not** send both `alert` and `content-available` for one event or you
get a duplicate (system alert + app's self-published one).

## Goal

iOS: a relay silent push wakes the app, which runs a bounded sync and self-publishes
a local notification derived from the synced data (contentless payload). macOS: the
live sync loop self-publishes local notifications off the drain with no push.

## Plan

_To be sharpened in `plan/`. Suggested sequencing — each independently testable:_

1. **Drain → local-notification publisher.** Hook `snapshot_broadcast`
   (`drain.rs:235`) to post a `UNNotificationRequest`. Works immediately for macOS +
   iOS-foreground. Needs `tauri-plugin-notification` (or `UNUserNotificationCenter`
   directly) + `notification:default` capability + a macOS notification entitlement
   in `Entitlements-appstore.plist`.
2. **Bounded one-shot sync.** A "sync once, signal when converged or ~20s timeout"
   wrapper around frontier catch-up (vs. the persistent `spawn_dev_peer_sync` loop),
   using the `converged_peers` / "Up to date" state as the done condition — for the
   ~30s iOS background window.
3. **iOS APNs registration + background-wake handler.** `registerForRemoteNotifications`,
   token capture, and `didReceiveRemoteNotification:fetchCompletionHandler:` (a small
   Swift shim bridging into Rust — Tauri's notification plugin does local only, not
   remote-push registration or the background-fetch delegate).
4. **Relay push sender.** When the relay accepts a batch destined for a device, send
   that device a contentless silent push. Needs the APNs key (per the deploy doc) +
   a device-token → device registry on the relay.

## Acceptance criteria

Each must be checkable from a transcript (command + output).

- [ ] macOS: a new synced row of interest posts a native notification (drain hook),
      proven by a test / log line.
- [ ] iOS: a relay silent push wakes the app, a bounded sync runs to convergence (or
      timeout), and a local notification is posted from the synced data.
- [ ] Bounded one-shot sync returns on convergence or ~20s timeout (test).
- [ ] No duplicate notifications; contentless payload carries no message text.
- [ ] `bun run check` and `bun run lint` exit 0; relevant `cargo test` exits 0.

## Progress log

- `2026-06-11` — Created in idea. Captured from a design discussion: relay push =
  contentless doorbell → bounded sync → app self-publishes local notification.
  iOS background sync can't run while suspended, so the doorbell is the only viable
  path; macOS self-publishes off the live drain. Branch
  `claude/native-notifications-ios-mac-sa3n1x`.
