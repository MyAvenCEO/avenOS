# ARCHIVE

Legacy or optional packages not on the main app path.

**Reference packages** (parked by card 0121, when avenOS was stripped back to the
avenCITY seed) are *deliberately* outside the Cargo and bun workspaces and are
**not expected to compile where they sit**. Each carries a README explaining what
it does and what must be fixed before bringing it back. They are kept as
understanding, not as dependencies.

| Path | Notes |
|------|--------|
| `tauri-plugin-biometric/` | **Reference.** Secure-Enclave P-256 device keys + vault secrets (was `libs/tauri-plugin-self` + `libs/tauri-plugin-vault`). The network seed is hardcoded to a network that no longer exists — read the README before reuse. |
| `tauri-plugin-passkey/` | **Reference — documentation only.** RP ID, associated domains, and the `apple-app-site-association` contract a deployed domain must serve for passkeys to work in a native Tauri app. No plugin source ever existed here; the 115 MB of Swift build output that did is gone. |
| `ocr-example/` | Python OCR CLI (`bun run dev:ocr-example`) |
| `aven-mail/` | Empty stub |
