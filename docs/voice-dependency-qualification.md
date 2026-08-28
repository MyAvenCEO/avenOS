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
  are started only after both ports and DSP state exist. Linux enables CPAL's
  PulseAudio backend so PipeWire/Pulse desktop routes are used when available,
  with ALSA retained as CPAL's fallback. Direct ALSA through the Pulse plugin is
  not qualified: on the reference XPS it produced an unpaced output loop and a
  backend-error storm.
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

The current two-user tester deployment accepts the XPS laptop calibration below
as sufficient representative hardware evidence, so automatic full-duplex
barge-in is enabled by default on every route. This deployment decision does not
bypass continuous AEC convergence or lexical-ASR confirmation.

## Known qualification boundary

Automated synthetic fixtures validate API contracts, delay, continuity,
generations, cancellation, and fixed memory. Acoustic corpus, CPU, deployment
floor, and device-route release gates require the physical qualification phase
and are not represented as passing merely because software tests pass.

## Tester deployment policy

Full-duplex barge-in is enabled without an environment setting for the current
tester deployment. A tester can temporarily force guarded turn-taking while
diagnosing a device by setting:

```sh
AVEN_VOICE_FULL_DUPLEX_BARGE_IN=0 bun run dev:app:linux
```

The route still reports full-duplex barge-in as unavailable until software AEC
reaches `converged`. Default-on deployment does not bypass echo health,
generation, or lexical-ASR confirmation gates.

The initial reference calibration on the built-in PulseAudio microphone and
speaker passed at -18 dBFS with a 5.39 dB probe-to-ambient ratio, 0.4199
correlation, 30.60 ms estimated echo delay, zero clipping, and zero callback
faults. For this limited tester population, that result authorizes testing on
other devices without a per-device qualification gate. Each device's runtime
diagnostics and tester feedback remain evidence for later production criteria.

Before launching the app, run the standalone host probe from the repository
root. It opens the real default microphone and speaker, renders silence, and
prints one machine-readable JSON record. It does not load Tauri, ASR, TTS, or
the AEC model.

```sh
cargo run --locked \
  --manifest-path libs/aven-voice-host-cpal/Cargo.toml \
  --features cpal-host \
  --bin aven-voice-duplex-probe
```

The default run is 15 seconds. `route_usable: true` requires capture and render
pacing within 20 percent of wall time after the backend's startup prebuffer and
zero route-fatal callback faults. `strict_pass: true` additionally
requires zero callback warnings, including xruns. The report includes the host
backend, device names, formats, callback/frame counts, pacing ratio, and every
coalesced CPAL error category so a failing machine can be diagnosed without GUI
logs. A duration in seconds may be passed after `--` for investigation; the
15-second default is the minimum comparable result.

For an active acoustic calibration, place the laptop in its normal speaking
position, set a comfortable system volume, keep the room quiet, and run:

```sh
cargo run --locked \
  --manifest-path libs/aven-voice-host-cpal/Cargo.toml \
  --features cpal-host \
  --bin aven-voice-duplex-probe -- \
  --calibrate --level-dbfs -24
```

Start at `-24` dBFS. If the result reports less than 3 dB
`probe_signal_to_ambient_db` and capture is not clipping, repeat at `-18` dBFS.
The verifier never permits a digital level above `-18` dBFS. Lower the system
speaker volume and repeat if `clipped_fraction` reaches one percent.

This is opt-in because it audibly plays three click-free deterministic streams:
a pseudo-random probe, a logarithmic chirp, and a multitone signal. The digital
level is clamped to the safe test range from -36 to -18 dBFS. The verifier uses
the exact post-render reference and simultaneous microphone capture to estimate
the route's acoustic echo delay, correlation, ambient floor, capture peak,
clipping, and per-stream signal-to-ambient ratio. `calibrated: true` requires a
usable duplex route, a detected probe with correlation at least 0.15 and signal
energy at least 3 dB above ambient, a delay within the supported 500 ms reference
history, and less than one percent clipped capture. The JSON result is the
route-specific calibration record. `recommended_delay_hint_ms` is the measured
starting point for diagnosing that route; it is not a permanent global override.
Changing the microphone, speaker, system route, or acoustic layout invalidates
the result. The application continues to align clocks and assess AEC convergence
while it runs, so calibration never weakens the continuous echo-safety gate.
