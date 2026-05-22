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

## Future simulator dev (when we use it again)

From `lib/app` after `gen/apple/` exists:

```bash
# Simulator target — NOT used for TestFlight / App Store export
bunx tauri ios dev --target aarch64-sim

# Or open Xcode project for sim debugging
bunx tauri ios build --open --target aarch64-sim
```

**Limits:** Face ID / Touch ID / Secure Enclave flows need a real device or TestFlight build.

## Related

- TestFlight pipeline: [ios-testflight-upload-transporter.md](ios-testflight-upload-transporter.md)
