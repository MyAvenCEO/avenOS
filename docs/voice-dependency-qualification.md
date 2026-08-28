# Voice dependency qualification

Status: implementation record, 2026-08-27

This record freezes the dependency-sensitive choices required by phase 0 of the
software-first duplex voice specification. Versions are exact in the production
crate manifests and are updated only with a new qualification run.

## Qualified components

- `sonora = 0.2.0` (BSD-3-Clause, MSRV 1.91): provides the pure-Rust WebRTC M145
  audio-processing pipeline, mono 48 kHz capture/render configuration, exact
  10 ms calls, AEC3, high-pass filtering, and statistics. Noise suppression and
  AGC2 remain disabled. The dependency is kept behind the runtime `software-aec`
  feature so semantic and fake-host tests remain hardware- and DSP-independent.
- `rubato = 5.0.0` (MIT): its asynchronous sinc resampler accepts a bounded
  adjustable ratio and has a preallocated `process_into_buffer` path. Logging is
  disabled. Runtime drift correction is limited to 1,000 ppm and ramped.
- `crossbeam-queue = 0.3.13` (MIT/Apache-2.0): `ArrayQueue` allocates fixed storage
  at construction, has non-blocking push/pop, and supports replacing the oldest
  complete item with `force_push`.
- `cpal = 0.18.2` (Apache-2.0): supplies the single shared duplex host. Stream
  construction and device enumeration stay on the host-control worker; streams
  are started only after both ports and DSP state exist.
- `ts-rs = 12.0.1` (MIT): Rust protocol types generate the checked TypeScript
  contract. A drift test compares generated text byte-for-byte.
- `ort = 2.0.0-rc.13` with ONNX Runtime `1.28.0`: Linux uses Microsoft's
  official shared CPU/CUDA archives, selected by the existing provisioning
  utility and verified by pinned SHA-256. Tauri bundles the native `.so`,
  provider library, license, and third-party notices as resources. macOS and
  iOS retain the statically linked distribution required by those targets.

## Executed qualification evidence

- Callback allocation tests: zero allocations in steady-state capture and
  render callbacks.
- Deterministic software AEC fixture: at least 15 dB attenuation through the
  delayed echo path; clipping, delay movement, and discontinuity fixtures pass.
- Virtual stress: 180,000 ten-millisecond intervals (30 minutes) complete with
  fixed queue capacities and zero synthetic overruns.
- Real Linux model compatibility with the provisioned ONNX Runtime 1.28:
  Nemotron cold-open 5.61 s; Silero model load 0.10 s; Supertonic produces
  1.72 s of speech in 245 ms at the production two-step setting on this host.
- A Tauri debug application build succeeds with the ONNX resource mapping and
  default CPAL composition enabled.

## Frozen VoiceConfigV1 values

- AEC minimum contiguous adaptation: 300 ms.
- Stable delay interval before convergence: 200 ms.
- Supported aligned delay history: 500 ms.
- Render silence floor: -60 dBFS RMS.
- Saturation boundary: 1% clipped samples in a 10 ms frame; three consecutive
  saturated frames degrade the echo path.
- Maximum drift correction: 1,000 ppm; changes are limited to 50 ppm per second.
- Convergence requires uninterrupted reference/capture continuity, stable delay,
  elapsed adaptation, no saturation streak, and no processor or clock fault.

These values are conservative initial gates. Physical qualification may make
them stricter. It must never make the lexical confirmation or echo-safety policy
weaker without updating the normative specification.

Automatic full-duplex barge-in remains release-gated off by default until the
physical corpus and reference-device gates below pass. The software backend is
therefore conservative even when synthetic AEC convergence succeeds.

## Known qualification boundary

Automated synthetic fixtures validate API contracts, delay, continuity,
generations, cancellation, and fixed memory. Acoustic corpus, CPU, deployment
floor, and device-route release gates require the physical qualification phase
and are not represented as passing merely because software tests pass.

## Laptop qualification opt-in

Full-duplex barge-in can be enabled explicitly for physical testing without
changing the production-safe default:

```sh
AVEN_VOICE_FULL_DUPLEX_BARGE_IN=1 bun run dev:app:linux
```

The setting may instead be added to the local `.env.daniel` file. The route
still reports full-duplex barge-in as unavailable until software AEC reaches
`converged`; the opt-in does not bypass echo health, generation, or lexical-ASR
confirmation gates. Remove the variable or set it to `0` to return to guarded
turn-taking.
