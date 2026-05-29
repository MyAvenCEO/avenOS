# tauri-plugin-self

In-tree Tauri 2 plugin: **Secure-Enclave P-256 key agreement** for `PEER_ID_<device>`, ECDH-derived `device_root_secret` versus the active `GENESIS_NETWORK_ID` (65-byte uncompressed SEC1 public point sourced from `GENESIS_NETWORK_ID` in release builds, `DEV_GENESIS_NETWORK_ID` in debug builds).

- **macOS** — implemented (CryptoKit + Secure Enclave).
- **iOS device / TestFlight** — Secure Enclave + Face ID/Touch ID via the same Swift bridge as macOS (`swift-lib`; `SwiftLinker::with_ios` in `build.rs`).
- **iOS Simulator** — `dev_insecure` (plain root secret on disk, same as Linux debug); `bun run dev:app:ios`.
- **Linux / Windows / Android** — not implemented for production; Rust uses `dev_insecure` in debug or returns explicit errors outside dev mode.

See `.cursor/plans/jazz_p2p_milestones.plan.md`.
