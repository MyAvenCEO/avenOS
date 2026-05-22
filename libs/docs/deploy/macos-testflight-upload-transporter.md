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
bun run build:app:mac:appstore
```

Requirements:

- **`AVEN_APP_STORE_PROVISIONING_PROFILE_MACOS`** — absolute path to a **Mac App Store Connect** provisioning profile (never commit it).
- **`APPLE_SIGNING_IDENTITY`** — matches `security find-identity -v -p codesigning` for **distribution** codesign on the `.app`.
- **`AVEN_PKG_INSTALLER_IDENTITY`** — Installer certificate identity for `productbuild --sign`; override when your issuer string differs (`man productbuild`).
- **`AVEN_OUTPUT_PKG`** optional — defaults to `dist/macos-appstore/avenOS-<version>-build<bundle>.pkg` under repo root.

The script merges an App Store–specific Tauri overlay (`.app`-only bundles, entitlement path, hardened runtime defaults) and emits a reproducible PKG path into stdout/stderr banners.

## 2. Deliver with Transporter (GUI)

1. Install **Transporter** from the Mac App Store.
2. Sign in with your App Store Connect team account (or authenticate with an API-backed workflow if configured).
3. Drag **`avenOS…pkg`** into Transporter → **Deliver**.
4. Wait for App Store Connect **processing** (often 10–60 minutes).

## 3. App Store Connect

1. Open the **macOS** SKU for `ceo.aven.os`.
2. **TestFlight** tab → Select the newest build → complete **Export compliance** questionnaires.
3. Add **internal testers** (immediate) before inviting external testers (requires Beta App Review for first externals).

## 4. Build number hygiene

Increment **`bundle.macOS.bundleVersion`** in `tauri.conf.json` (merged overlay or base config) **before every upload**—Apple rejects duplicate **`CFBundleVersion`** pairs for the same app record.

### Optional CLI parity

Prefer Transporter CLI or `notarytool`-era upload flows only if your team standardized them:

```bash
xcrun altool --upload-app --type macos --file ./dist/path/to/avenOS.pkg \
  --apiKey "$APPLE_API_KEY_ID" --apiIssuer "$APPLE_API_ISSUER"
```

Apple has been migrating uploads to Apple-transporter–compatible APIs—verify exact flags against `altool`/Transporter CLI help on your Xcode version before scripting.
