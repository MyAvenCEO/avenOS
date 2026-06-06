/**
 * Pure audio helpers for the on-device voice-note path: accumulate Web Audio
 * PCM chunks, downsample to the model's expected rate, and convert between
 * Float32 and Int16. No DOM / no Web Audio objects here so it stays unit-testable.
 *
 * The on-device model (Parakeet-TDT-0.6b-v3 via sherpa-onnx) takes raw PCM + a
 * sample rate; we capture at the `AudioContext` rate (often 44.1/48 kHz) and
 * resample to {@link TARGET_SAMPLE_RATE} before crossing the Tauri IPC boundary.
 */

/** Parakeet expects 16 kHz mono PCM. */
export const TARGET_SAMPLE_RATE = 16_000

/** Concatenate captured Float32 chunks into one contiguous buffer. */
export function concatFloat32(chunks: Float32Array[]): Float32Array {
	let total = 0
	for (const c of chunks) total += c.length
	const out = new Float32Array(total)
	let offset = 0
	for (const c of chunks) {
		out.set(c, offset)
		offset += c.length
	}
	return out
}

/**
 * Linear-interpolation downsample (or passthrough) from `inRate` to `outRate`.
 * Adequate for speech; we never upsample (returns the input if `outRate >= inRate`).
 */
export function downsample(input: Float32Array, inRate: number, outRate: number): Float32Array {
	if (outRate >= inRate || input.length === 0) return input
	const ratio = inRate / outRate
	const outLength = Math.floor(input.length / ratio)
	const out = new Float32Array(outLength)
	for (let i = 0; i < outLength; i++) {
		const pos = i * ratio
		const lo = Math.floor(pos)
		const hi = Math.min(lo + 1, input.length - 1)
		const frac = pos - lo
		out[i] = input[lo] * (1 - frac) + input[hi] * frac
	}
	return out
}

/** Clamp a sample to [-1, 1] and scale to signed 16-bit. */
export function floatTo16BitPCM(input: Float32Array): Int16Array {
	const out = new Int16Array(input.length)
	for (let i = 0; i < input.length; i++) {
		const s = Math.max(-1, Math.min(1, input[i]))
		out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
	}
	return out
}

/**
 * Reduce captured chunks to `{ pcm, sampleRate }` at the model's target rate.
 * Returns `null` when nothing was captured so callers can skip an empty submit.
 */
export function encodeForModel(
	chunks: Float32Array[],
	inputSampleRate: number,
	targetSampleRate: number = TARGET_SAMPLE_RATE
): { pcm: Float32Array; sampleRate: number } | null {
	const merged = concatFloat32(chunks)
	if (merged.length === 0) return null
	const pcm = downsample(merged, inputSampleRate, targetSampleRate)
	const sampleRate = targetSampleRate < inputSampleRate ? targetSampleRate : inputSampleRate
	return { pcm, sampleRate }
}
