# aven-p2p

Placeholder crate after P2P/relay rip-out. Future sync transport implementations (Hyperswarm, LAN, relay, …) should implement `groove::SyncTransport` here or in a sibling crate.

Previously this directory held the full HyperDHT/Hyperswarm stack. That code was deleted; see git history if you need to revive it.

## Consumers

- None today — the app runs local-only Groove with `NullSyncTransport`.
