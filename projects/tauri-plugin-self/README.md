# tauri-plugin-self

In-tree Tauri 2 plugin: **Secure-Enclave P-256 key agreement** for `PEER_ID_<device>`, ECDH-derived `device_root_secret` versus the active `GENESIS_NETWORK_ID` (65-byte uncompressed SEC1 public point sourced from `GENESIS_NETWORK_ID` in release builds, `DEV_GENESIS_NETWORK_ID` in debug builds).

- **macOS** — implemented (CryptoKit).
- **iOS / Android / others** — not implemented in v1; use `cargo check` stubs.

See `.cursor/plans/jazz_p2p_milestones.plan.md`.
