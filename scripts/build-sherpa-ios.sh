#!/usr/bin/env bash
#
# Build the sherpa-onnx static libraries for iOS (arm64 device) and stage the
# loose `lib*.a` files where the `sherpa-onnx-sys` crate expects them.
#
# WHY this exists
# ---------------
# `sherpa-onnx-sys` v1.13.2's build script has no match arm for
# `target_os = "ios"` — `cargo build --target aarch64-apple-ios` fails with
# "Unsupported target for sherpa-onnx prebuilt libs". Its only escape hatch is
# the `SHERPA_ONNX_LIB_DIR` env var, but the directory must contain the 13
# LOOSE archives it links by name (libsherpa-onnx-c-api.a, libsherpa-onnx-core.a,
# … libonnxruntime.a). k2-fsa's official iOS release ships a MERGED
# `sherpa-onnx.xcframework` (one libsherpa-onnx.a) instead, which doesn't satisfy
# those 13 `-l` names. The loose per-arch archives only exist as intermediate
# output of upstream's build-ios.sh — so we build them from source here.
#
# Output: app/src-tauri/vendor/sherpa-ios/lib/  (gitignored; ~hundreds of MB)
# scripts/tauri-ios-asc.ts points SHERPA_ONNX_LIB_DIR at that dir at compile time.
#
# Run once on a Mac with Xcode + CMake before `bun run release:app:ios`.
# Idempotent: re-running with the libs already present is a no-op (pass --force
# to rebuild). Pin matches the `sherpa-onnx = "1.13"` crate dep (1.13.2).
set -euo pipefail

SHERPA_VERSION="1.13.2"          # must match libs/aven-ai Cargo.toml `sherpa-onnx`
ONNXRUNTIME_VERSION="1.17.1"     # the version build-ios.sh pulls for v1.13.2

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR_DIR="${REPO_ROOT}/app/src-tauri/vendor/sherpa-ios"
LIB_DIR="${VENDOR_DIR}/lib"
BUILD_ROOT="${VENDOR_DIR}/build"
SRC_DIR="${BUILD_ROOT}/sherpa-onnx"

# The 12 sherpa archives emitted into build/os64/lib/ + onnxruntime (renamed).
SHERPA_LIBS=(
  libsherpa-onnx-c-api.a libsherpa-onnx-core.a libkaldi-decoder-core.a
  libsherpa-onnx-kaldifst-core.a libsherpa-onnx-fstfar.a libsherpa-onnx-fst.a
  libkaldi-native-fbank-core.a libkissfft-float.a libpiper_phonemize.a
  libespeak-ng.a libucd.a libssentencepiece_core.a
)

force=0
[ "${1:-}" = "--force" ] && force=1

# Fast path: every expected archive already staged → nothing to do.
have_all=1
for lib in "${SHERPA_LIBS[@]}" libonnxruntime.a; do
  [ -f "${LIB_DIR}/${lib}" ] || have_all=0
done
if [ "${have_all}" = 1 ] && [ "${force}" = 0 ]; then
  echo "[build-sherpa-ios] libs already present in ${LIB_DIR} (use --force to rebuild)"
  echo "${LIB_DIR}"
  exit 0
fi

# --- prerequisites ----------------------------------------------------------
for tool in git cmake xcodebuild curl tar; do
  command -v "${tool}" >/dev/null 2>&1 || {
    echo "[build-sherpa-ios] missing required tool: ${tool}" >&2
    exit 1
  }
done

mkdir -p "${BUILD_ROOT}" "${LIB_DIR}"

# --- source -----------------------------------------------------------------
if [ ! -d "${SRC_DIR}/.git" ]; then
  echo "[build-sherpa-ios] cloning sherpa-onnx v${SHERPA_VERSION}"
  git clone --depth 1 --branch "v${SHERPA_VERSION}" \
    https://github.com/k2-fsa/sherpa-onnx "${SRC_DIR}"
fi

cd "${SRC_DIR}"

# --- onnxruntime prebuilt (device arm64 slice) ------------------------------
ORT_DIR="${SRC_DIR}/build-ios/ios-onnxruntime"
ORT_DEVICE_LIB="${ORT_DIR}/onnxruntime.xcframework/ios-arm64/onnxruntime.a"
if [ ! -f "${ORT_DEVICE_LIB}" ]; then
  echo "[build-sherpa-ios] fetching onnxruntime ${ONNXRUNTIME_VERSION} xcframework"
  mkdir -p "${ORT_DIR}"
  tarball="${ORT_DIR}/onnxruntime.xcframework-${ONNXRUNTIME_VERSION}.tar.bz2"
  curl -fsSL -o "${tarball}" \
    "https://github.com/csukuangfj/onnxruntime-libs/releases/download/v${ONNXRUNTIME_VERSION}/onnxruntime.xcframework-${ONNXRUNTIME_VERSION}.tar.bz2"
  tar xf "${tarball}" -C "${ORT_DIR}"
  rm -f "${tarball}"
fi

# --- build sherpa-onnx for device (arm64 / PLATFORM=OS64) -------------------
# Mirrors the OS64 stanza of upstream build-ios.sh; we skip the simulator slices
# since the TestFlight build only targets physical devices (`--target aarch64`).
BUILD_OS64="${SRC_DIR}/build-ios/build/os64"
export SHERPA_ONNXRUNTIME_LIB_DIR="${ORT_DIR}/onnxruntime.xcframework/ios-arm64"
export SHERPA_ONNXRUNTIME_INCLUDE_DIR="${ORT_DIR}/onnxruntime.xcframework/Headers"

if [ ! -f "${BUILD_OS64}/lib/libsherpa-onnx-c-api.a" ] || [ "${force}" = 1 ]; then
  echo "[build-sherpa-ios] cmake configure + build (arm64 device)"
  cmake \
    -DBUILD_PIPER_PHONMIZE_EXE=OFF -DBUILD_PIPER_PHONMIZE_TESTS=OFF \
    -DBUILD_ESPEAK_NG_EXE=OFF -DBUILD_ESPEAK_NG_TESTS=OFF \
    -S "${SRC_DIR}" \
    -DCMAKE_TOOLCHAIN_FILE="${SRC_DIR}/toolchains/ios.toolchain.cmake" \
    -DPLATFORM=OS64 \
    -DENABLE_BITCODE=0 -DENABLE_ARC=1 -DENABLE_VISIBILITY=0 \
    -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
    -DSHERPA_ONNX_ENABLE_PYTHON=OFF -DSHERPA_ONNX_ENABLE_BINARY=OFF \
    -DSHERPA_ONNX_ENABLE_TESTS=OFF -DSHERPA_ONNX_ENABLE_CHECK=OFF \
    -DSHERPA_ONNX_ENABLE_PORTAUDIO=OFF -DSHERPA_ONNX_ENABLE_JNI=OFF \
    -DSHERPA_ONNX_ENABLE_C_API=ON -DSHERPA_ONNX_ENABLE_WEBSOCKET=OFF \
    -DDEPLOYMENT_TARGET=14.0 \
    -B "${BUILD_OS64}"
  cmake --build "${BUILD_OS64}" -j "$(sysctl -n hw.ncpu)"
fi

# --- stage the loose archives the crate links by name -----------------------
echo "[build-sherpa-ios] staging libs → ${LIB_DIR}"
for lib in "${SHERPA_LIBS[@]}"; do
  src="${BUILD_OS64}/lib/${lib}"
  [ -f "${src}" ] || { echo "[build-sherpa-ios] expected lib missing: ${src}" >&2; exit 1; }
  cp -f "${src}" "${LIB_DIR}/${lib}"
done
# `sherpa-onnx-sys` links `-lonnxruntime` → needs libonnxruntime.a.
cp -f "${ORT_DEVICE_LIB}" "${LIB_DIR}/libonnxruntime.a"

echo "[build-sherpa-ios] done. ${#SHERPA_LIBS[@]} sherpa libs + onnxruntime staged."
echo "${LIB_DIR}"
