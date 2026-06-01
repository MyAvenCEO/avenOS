# macOS TestFlight — App Sandbox smoke checklist

Run on a **physical Mac** against a release build produced for the **Mac App Store** path (sandbox entitlements embedded, hardened runtime signing). Typical flow: install the packaged `.app` from your signed `.pkg` or run the archived `.app` after `codesign ---verify`.

**Goal:** Confirm Secure Enclave identity, Jazz/UI, and WebView behave under **`com.apple.security.app-sandbox`**.

## Prerequisites

- Build artifact from `bun run release:app:mac <N> --no-upload` at repo root (drop `--no-upload` to also push to TestFlight via altool; see `scripts/release-app.ts`).
- Provision profile and signing identities matched to **Mac App Store** (not Developer ID-only).

## Smoke steps

1. **Launch**

   - [ ] Cold start completes with no trap on hardened runtime (`codesign --verify --deep --strict`).
   - [ ] No blank WKWebView: if blank, revisit sandbox/JIT entitlement discussion in the TestFlight plan and Tauri macOS WebView troubleshooting.

2. **Identity (Secure Enclave)**

   - [ ] Complete onboarding / vault flow and **unlock** via Touch ID once.
   - [ ] Quit and reopen; Touch ID prompts again where expected—no stray passcode loops.

3. **Jazz + Sparks**

   - [ ] After unlock, open `/sparks` (or your primary subscriber surface); confirm subscriptions complete without habitual ~30 s timeouts.
   - [ ] Sanity-check local persistence after restart (documents still visible).

4. **Demo mesh UI**

   - [ ] Open Settings → Peers; confirm hardcoded demo peers show Connecting / Syncing / OK states (no live transport).

## If something fails

| Symptom | Next check |
|---------|-------------|
| `codesign`/notary validation says sandbox missing | `--entitlements` not embedded → re-sign `.app` before `productbuild`. |
| Blank WebView post-install | Add JIT entitlement only after App Review risk assessment; reproduce with logging from Tauri/WebKit console. |

When this checklist passes reliably, proceed to upload via Transporter (`macos-testflight-upload-transporter.md`).
