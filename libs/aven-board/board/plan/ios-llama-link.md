# iOS on-device LLM (llama.cpp) — link fix

**Status:** deferred / blocked. macOS ships the on-device LLM (LFM2.5-8B-A1B GGUF, llama.cpp ·
Metal) as of build 95. **iOS does not link yet** — `local-llama` is the default feature, so the
iOS release archive currently fails at link until this is resolved. (iOS never had an on-device
LLM before — the ONNX path was stripped — so iOS is at zero regression, just no LLM yet.)

## Symptom
`xcodebuild` iOS archive fails:
```
Undefined symbols for architecture arm64:
  _ggml_compute_forward_mean, _ggml_compute_forward_rms_norm, _ggml_compute_forward_sub, … (many ggml ops)
ld: symbol(s) not found for architecture arm64
clang++: error: linker command failed (xcodebuild exit 65)
```

## Diagnosis (done — ruled things out)
1. **Not a missing lib** — `libggml-cpu.a` builds for iOS (arm64) and *defines* the symbols (`nm` → `T`).
2. **Not (only) a name collision** — cargo bundles native static libs into the `staticlib`
   (`libapp.a`) by object *basename*; the llama archives carry duplicate basenames within a lib
   (`quants.c.o`/`repack.cpp.o` = generic + `arch/arm`) and across libs (`llama.cpp.o` in
   libllama + libcommon). We added a build-script dedupe (see "Done") and confirmed the archives
   become 16/16 unique — **but the link still fails.**
3. **The real blocker is link RESOLUTION.** Verified: the ggml symbols *do* land in the final
   `app/src-tauri/gen/apple/Externals/arm64/release/libapp.a` (`nm` → `_ggml_compute_forward_mean`
   present as `T`, 109 ggml defs). The definitions are in the archive the linker is handed, yet
   `ld` reports them undefined — i.e. ld is **not pulling the defining objects** from `libapp.a`.
4. **macOS is unaffected** because it links the `.a`s directly (cargo-driven link, no
   staticlib bundling); only the iOS path bundles into one `libapp.a` for xcodebuild.

## Done (committed)
- `app/src-tauri/build.rs` (iOS + `local-llama` only): rewrites every `llama-cpp-sys-2` `libggml*.a`
  / `libllama.a` / `libcommon.a` so member names are **globally unique**, then `ranlib`s each —
  runs after the dep builds the archives, before our staticlib link. Idempotent, best-effort.
  (Necessary hygiene, but **insufficient** alone.)

## Remaining work (next attempts, in order)
1. **`-force_load` / `-all_load` on `libapp.a`** in the iOS Xcode project's *Other Linker Flags*
   (`app/src-tauri/gen/apple/…`), so ld includes ALL of `libapp.a`'s objects instead of
   on-demand. **Risk:** duplicate-symbol errors from ggml's generic-vs-arm variants (the two
   `quants.c.o`/`repack.cpp.o`) — may require dropping one variant (a `GGML_*` cmake flag) or
   weak/selective force-load. The dedupe above is a prerequisite for clean force-load.
2. **Capture the exact xcodebuild link command** (`xcodebuild … -v` / inspect the generated
   link step) to see *how* `libapp.a` is passed — confirm whether it's on-demand vs force-loaded,
   and whether the rustc `native-static-libs` search paths reach the linker.
3. **Alternative: link ggml externally** — emit `-bundle` for the ggml libs so they stay separate
   and add them to the Xcode link explicitly (search path + `-l`), bypassing the staticlib bundle.
4. **Verify Metal at runtime on-device** once it links — `GGML_METAL_EMBED_LIBRARY` defaults to
   `${GGML_METAL}` so shaders embed (no `.metallib` needed); should "just work", but confirm tok/s
   on a real device (iPhone 15 Pro / 8 GB+; consider shipping LFM2.5-1.2B on lower-RAM phones).

## Pointers
- App adapter: `app/src-tauri/src/llm.rs` (`local-llama` imp). Engine: `libs/aven-ai/src/llama.rs`.
- Build fix: `app/src-tauri/build.rs` (`uniquify_llama_archives`).
- iOS build entry: `scripts/tauri-ios-asc.ts` → `scripts/release-app.ts ios`.
