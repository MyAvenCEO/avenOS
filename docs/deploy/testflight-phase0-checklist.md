# TestFlight Phase 0 — Apple Developer checklist (manual)

Complete this **once per team/account** before building macOS or iOS store artifacts. Paths and UI labels refer to developer.apple.com and App Store Connect as of May 2026.

The AvenOS bundle ID is **`ceo.aven.os`** (see `app/src-tauri/tauri.conf.json`). Do **not** commit `.p12`, `.p8`, or `.provisionprofile` files—keep them outside the repo (for example under `~/apple-certs/avenos/`).

## 1. Program and team

- [ ] Confirm **paid Apple Developer Program** membership ($99/year) is active.
- [ ] In [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/), note **Team ID** (10 characters).

## 2. App Store Connect apps

In [App Store Connect → Apps](https://appstoreconnect.apple.com/apps):

- [ ] Create **macOS app**: name e.g. `avenOS`, bundle ID `ceo.aven.os`, unique SKU e.g. `avenos-macos`.
- [ ] Create **iOS app** (you may use the same bundle ID across platforms when identifiers are unified): SKU e.g. `avenos-ios`.

## 3. Identifier capabilities

Under **Identifiers**, edit App ID `ceo.aven.os`:

**macOS / Mac App Store (full AvenOS)**

- [ ] App Sandbox (required).
- [ ] Network: **Outbound (Client)**; add **Inbound (Server)** if Hyperswarm listens in the sandboxed build—validate against your entitlements (`Entitlements-appstore.plist`).
- [ ] Keychain / other capabilities only if Xcode or signing validation requires them—enable only what you use.

**iOS (Secure Enclave + Jazz + Hyperswarm foreground parity)**

- [ ] App Sandbox (default for iOS; ensure provisioning matches).
- [ ] Networking: **Outbound (Client)** for relay, HTTPS manifest fetch, Jazz—add **Inbound** only if tooling requires listens on device.
- [ ] **Multicast / Bonjour** (or Associated Domains) only if Hyperswarm’s LAN discovery triggers review requirements—mirror what macOS sandbox entitlements declare.
- [ ] **`NSLocalNetworkUsageDescription`** in `Info.ios.plist` stays accurate when editing discovery copy.

## 4. Certificates

Easiest path: Xcode → **Settings → Accounts** → Select Apple ID → **Manage Certificates**:

- [ ] **Apple Distribution** — App Store builds (macOS + iOS).

For Mac App Store **.pkg**, you also need a **Mac Installer** identity (often **3rd Party Mac Developer Installer** or **Apple Installer Distribution**, depending on what Apple issues to your account). Create or refresh via Xcode / developer portal.

Verify signing identities locally:

```bash
security find-identity -v -p codesigning
```

## 5. Provisioning profiles

In [Profiles](https://developer.apple.com/account/resources/profiles/list):

| Type | Purpose |
|------|---------|
| **Mac App Store Connect** | macOS `.app` — embed `embedded.provisionprofile` in the bundle Contents. |
| **App Store Connect (iOS)** | iOS IPA / Xcode archiving. |

- [ ] Create/download profiles for bundle `ceo.aven.os`; store `.provisionprofile` files **outside git**.
- [ ] Reference them from build scripts/env (see repo docs under `docs/deploy/`).

## 6. App Store Connect API key (optional; CLI uploads)

Under **Users and Access → Integrations → Keys**:

- [ ] Generate an API key (**Developer** access or higher as required by your tooling).
- [ ] Record **Issuer ID**, **Key ID**; download **`.p8`** once to e.g. `~/.appstoreconnect/private_keys/AuthKey_<KEYID>.p8`.

Use environment variables **`APPLE_API_ISSUER`**, **`APPLE_API_KEY_ID`**, **`APPLE_API_KEY`** (path to `.p8`) with `xcrun notarytool` / **Transporter CLI** equivalents if you automate uploads—never commit secrets.

## 7. Compliance (before first submission)

Prepare in App Store Connect:

- [ ] Privacy policy URL.
- [ ] **App Privacy** nutrition labels aligned with AvenOS networking, identity/crypto, Jazz sync.
- [ ] Export compliance aligned with **`ITSAppUsesNonExemptEncryption`** in `Info.plist` / `Info.ios.plist`; complete the encryption questionnaire inside App Store Connect for each uploaded build.

## Environment variables cheat sheet

| Variable | Typical use |
|----------|--------------|
| `APPLE_DEVELOPMENT_TEAM` | iOS Xcode / `tauri ios build`; matches Team ID when not hard-coded. |
| `APPLE_SIGNING_IDENTITY` | macOS Distribution identity passed through `build-appstore-macos.ts` into Tauri merge config. |
| `AVEN_APP_STORE_PROVISIONING_PROFILE_MACOS` | Path to `.provisionprofile` for Mac App Store (script copies beside bundle). |

See also: [macOS TestFlight sandbox smoke](macos-testflight-sandbox-smoke.md), [macOS upload via Transporter](macos-testflight-upload-transporter.md), [iOS upload](ios-testflight-upload-transporter.md).
