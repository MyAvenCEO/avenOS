# macOS TestFlight upload (Transporter)

This track delivers a signed **installer `.pkg`** to **App Store Connect → macOS TestFlight**, not the `dmg` used for standalone distribution.

## 1. Build the installer

From the repository root.

**Prefer local paths (quotes OK for `"…/Maia City/Apple/…"`):** copy **`scripts/apple-env.local.template`** → **`.env.apple.local`** at repo root, point `AVEN_APP_STORE_PROVISIONING_PROFILE_MACOS=…`. That file stays off Git (`/.gitignore` matches `.env.*`).

Alternatively export once in the shell:

```bash
export AVEN_APP_STORE_PROVISIONING_PROFILE_MACOS=/path/outside/repo/MacAppStore_ceo_aven_os.provisionprofile
export APPLE_SIGNING_IDENTITY="Apple Distribution: Your Org (XXXXXXXXXX)"
export AVEN_PKG_INSTALLER_IDENTITY="3rd Party Mac Developer Installer: Your Org (XXXXXXXXXX)"
export AVEN_OUTPUT_PKG="$PWD/dist/avenOS.pkg"
bun run release:app:mac 14 --no-upload
```

Requirements:

- **`AVEN_APP_STORE_PROVISIONING_PROFILE_MACOS`** — absolute path to a **Mac App Store Connect** provisioning profile (never commit it).
- **`APPLE_SIGNING_IDENTITY`** — matches `security find-identity -v -p codesigning` for **distribution** codesign on the `.app`.
- **`AVEN_PKG_INSTALLER_IDENTITY`** — Installer certificate identity for `productbuild --sign`; override when your issuer string differs (`man productbuild`).
- **`AVEN_OUTPUT_PKG`** optional — defaults to `dist/macos-appstore/avenOS-<version>-build<bundle>.pkg` under repo root.

The script merges an App Store–specific Tauri overlay (`.app`-only bundles, entitlement path, hardened runtime defaults) and emits a reproducible PKG path into stdout/stderr banners.

## 2. Upload to App Store Connect

**One command builds and uploads** — runs the Mac App Store build, then `xcrun altool --upload-app` using the API key in `.env.apple.local`:

```bash
# build macOS .pkg with CFBundleVersion=14 and upload to TestFlight
bun run release:app:mac 14

# do both macOS .pkg AND iOS .ipa with the same build number
bun run release:app:all 14
```

The trailing integer is the **CFBundleVersion / build number**. Apple rejects duplicates inside an app record — bump it for every upload.

Requires `APPLE_API_KEY` / `APPLE_API_ISSUER` / `APPLE_API_KEY_PATH` in `.env.apple.local` (App Store Connect → Users and Access → Keys → "Generate API Key").

Opt-out flags:
- `bun run release:app:mac 14 --no-upload` → build only, keep the `.pkg` for manual upload
- `bun run release:app:mac --no-build` → upload the **newest** existing `.pkg`

**GUI fallback (Transporter)** — drag the produced `.pkg` into the Transporter.app → Deliver. Same outcome, useful for one-offs.

## 3. App Store Connect

1. Open the **macOS** SKU for `ceo.aven.os`.
2. **TestFlight** tab → Select the newest build → complete **Export compliance** questionnaires.
3. Add **internal testers** (immediate) before inviting external testers (requires Beta App Review for first externals).

## 4. Build number hygiene

Increment **`AVEN_BUILD_NUMBER`** (applies to both macOS + iOS) **before every upload**—Apple rejects duplicate **`CFBundleVersion`** pairs for the same app record. Per-target overrides via `AVEN_MAC_CF_BUNDLE_VERSION` / `AVEN_IOS_CF_BUNDLE_VERSION` if the two tracks have diverged on App Store Connect.
