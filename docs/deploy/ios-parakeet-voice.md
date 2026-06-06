# iOS on-device voice (Parakeet) — build wiring

On-device STT (NVIDIA Parakeet-TDT-0.6b-v3 via the `sherpa-onnx` crate) is the
`local-voice` feature, **on by default**. It works out of the box on macOS and
Linux because `sherpa-onnx-sys` auto-downloads prebuilt static libs for those
targets. **iOS has no such auto-download** — this doc covers the one-time setup
that makes the TestFlight build link.

## Why a manual step is needed

`sherpa-onnx-sys` (v1.13.2) has no match arm for `target_os = "ios"`, so
`tauri ios build` fails at the link step with *"Unsupported target for
sherpa-onnx prebuilt libs"*. Its only escape hatch is the `SHERPA_ONNX_LIB_DIR`
env var, and the directory must hold the **13 loose archives** the crate links by
name (`libsherpa-onnx-c-api.a` … `libonnxruntime.a`). k2-fsa's official iOS
release ships a *merged* `sherpa-onnx.xcframework` instead, which doesn't satisfy
those names — so we build the loose arm64 device archives from source.

Two further gaps are handled in-repo (no action needed):

- `app/src-tauri/build.rs` adds the `c++` + `Foundation` link directives that
  `sherpa-onnx-sys` emits for macOS/Linux but not iOS.
- `scripts/tauri-ios-asc.ts` injects `SHERPA_ONNX_LIB_DIR` into
  `gen/apple/.aven-ios-compile.env` — the only env the in-Xcode cargo compile
  reads.

## One-time: build the iOS static libs

Requires a Mac with Xcode + CMake. Run from the repo root:

```sh
scripts/build-sherpa-ios.sh
```

This clones sherpa-onnx `v1.13.2`, builds it for `arm64` device (`PLATFORM=OS64`),
fetches the matching onnxruntime `1.17.1` xcframework, and stages the archives
into `app/src-tauri/vendor/sherpa-ios/lib/` (gitignored — large, regenerate per
machine; pass `--force` to rebuild). The first build is slow (full CMake compile
of sherpa-onnx + espeak-ng + kaldi); subsequent runs are no-ops.

## Build + upload to TestFlight

Same pipeline as before — the voice wiring is now automatic:

```sh
bun run release:app:ios <CFBundleVersion>
```

`tauri-ios-asc.ts` writes the compile env (incl. `SHERPA_ONNX_LIB_DIR` when the
libs are present; it warns if they're missing), then builds and uploads the
signed `.ipa`. See [ios-testflight-upload-transporter.md](ios-testflight-upload-transporter.md)
for signing/credentials.

To build **without** on-device voice (smaller binary, no manual lib step), use a
`--no-default-features` app build; `asr_status` then reports `unavailable` and
the UI hides the voice path.

## Runtime notes

- The ~640 MB model tarball is **downloaded on first use** into the iOS sandbox
  (`Documents/.avenOS/models/…`), not bundled. Progress surfaces via the
  `asr:model-download` event. Guide testers to Wi-Fi for the first run.
- Mic permission string is already in `app/src-tauri/Info.ios.plist`
  (`NSMicrophoneUsageDescription`).
- Audio capture is webview-based (Web Audio → 16 kHz mono PCM over IPC), so no
  native-audio code is platform-specific.

## Simulator

`build-sherpa-ios.sh` builds the **device** slice only (TestFlight targets
physical devices via `--target aarch64`). Simulator support would need the
`SIMULATOR64` / `SIMULATORARM64` slices from upstream `build-ios.sh` lipo'd in —
add later if simulator voice testing is required.
