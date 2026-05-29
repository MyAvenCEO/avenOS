# iOS Simulator — local inventory (future dev only)

**Current QA policy:** AvenOS iOS is validated on **physical devices via TestFlight**, not the simulator (Secure Enclave / store signing differ). This doc records **what is installed locally** for possible future UI or Jazz smoke runs — not for release sign-off.

Refresh this section after installing runtimes in **Xcode → Settings → Components**.

## Check what is installed

```bash
xcrun simctl list runtimes available
xcrun simctl list devices available | rg '^-- iOS'
```

## Samuel’s Mac (last checked 2026-05-22)

| Runtime | Status | Notes |
|---------|--------|--------|
| **iOS 18.4** (22E238) | **Active** | Default sim runtime on this machine |
| iOS 17.5 | Orphaned | Listed under Xcode **Other Installed Platforms**; `simctl` shows unavailable — safe to remove or reinstall if needed |
| **iOS 26.2 + 26.3.1 Simulator** | Pending | Install via Components **Get** (~10 GB) — required for **device IPA builds** today; simulator half of bundle is unused for TestFlight QA |

**Devices under iOS 18.4** (examples): iPhone 16 Pro, iPhone 16, iPhone 16e, iPad Pro 11/13-inch (M4), iPad Air 11/13-inch (M3).

## Local simulator dev

**Tauri v2:** `tauri ios dev` takes an optional **simulator device name** as a positional argument. There is **no** `--target` on `dev` (use `--target aarch64-sim` only on `tauri ios build`).

From the **repo root** (starts embedded P2P signal + Vite like desktop dev):

```bash
bun run dev:app:ios
```

One-time scaffold if `app/src-tauri/gen/apple` is missing:

```bash
cd app && CI=true bunx tauri ios init --ci
```

Optional: force a simulator by name (must match `xcrun simctl list devices available`):

```bash
AVEN_IOS_SIM_DEVICE="iPhone 16 Pro" bun run dev:app:ios
```

From `app` directly:

```bash
bun run tauri:ios:dev:sim
# or with device: bunx tauri ios dev "iPhone 16 Pro"
```

Desktop Tauri on your current OS: `bun run dev:app:all` (macOS → `dev:app:mac`, Linux → `dev:app:linux`).

Open Xcode for manual sim debugging:

```bash
cd app && bunx tauri ios build --open --target aarch64-sim
```

**Identity on Simulator:** Same **dev insecure** path as Linux (`peer-id-{slot}.dev-root-secret` on disk) — the Simulator cannot replace TestFlight Secure Enclave QA. `dev:app:ios` sets `AVENOS_DEV_INSECURE_IDENTITY=1`; physical iOS / App Store builds still use the Swift Secure Enclave bridge.

**Limits:** Passkey / Face ID / real Secure Enclave behaviour needs a physical device or TestFlight build.

## Simulator shows no avenOS icon / Spotlight empty

Usually the **Simulator is booted but the app was never installed** — common if you opened the Simulator yourself or stopped `dev:app:ios` before Xcode finished.

1. Keep `bun run dev:app:ios` running until **avenOS launches on its own** (first build: often 10–20+ minutes).
2. Do not rely on Spotlight mid-build; the home-screen name is **avenOS** (`ceo.aven.os`).
3. If the terminal shows an Xcode/Rust error, fix that and re-run.
4. Stale empty build? From `app`:

```bash
rm -rf src-tauri/gen/apple/build
rm -rf ~/Library/Developer/Xcode/DerivedData/aven-os-app-*
bun run dev:app:ios
```

Check install (booted sim only):

```bash
xcrun simctl get_app_container booted ceo.aven.os
```

## Related

- TestFlight pipeline: [ios-testflight-upload-transporter.md](ios-testflight-upload-transporter.md)
