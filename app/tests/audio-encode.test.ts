import { describe, expect, test } from 'bun:test'
import {
	concatFloat32,
	downsample,
	encodeForModel,
	floatTo16BitPCM,
	TARGET_SAMPLE_RATE
} from '../src/lib/intent-mock/audio-encode'

describe('audio-encode', () => {
	test('concatFloat32 joins chunks in order', () => {
		const out = concatFloat32([new Float32Array([1, 2]), new Float32Array([3])])
		expect(Array.from(out)).toEqual([1, 2, 3])
	})

	test('concatFloat32 of nothing is empty', () => {
		expect(concatFloat32([]).length).toBe(0)
	})

	test('downsample halves length when output rate is half input', () => {
		const input = new Float32Array([0, 0.25, 0.5, 0.75])
		const out = downsample(input, 32_000, 16_000)
		expect(out.length).toBe(2)
	})

	test('downsample passes through when not downsampling', () => {
		const input = new Float32Array([0.1, 0.2])
		expect(downsample(input, 16_000, 16_000)).toBe(input)
		expect(downsample(input, 8_000, 16_000)).toBe(input)
	})

	test('floatTo16BitPCM clamps and scales', () => {
		const out = floatTo16BitPCM(new Float32Array([0, 1, -1, 2, -2]))
		expect(out[0]).toBe(0)
		expect(out[1]).toBe(32767)
		expect(out[2]).toBe(-32768)
		// clamped
		expect(out[3]).toBe(32767)
		expect(out[4]).toBe(-32768)
	})

	test('encodeForModel returns null when no audio captured', () => {
		expect(encodeForModel([], 48_000)).toBeNull()
		expect(encodeForModel([new Float32Array(0)], 48_000)).toBeNull()
	})

	test('encodeForModel downsamples to the target rate', () => {
		const chunk = new Float32Array(4_800).fill(0.1)
		const result = encodeForModel([chunk], 48_000)
		expect(result).not.toBeNull()
		expect(result?.sampleRate).toBe(TARGET_SAMPLE_RATE)
		// 48k -> 16k is a 3x reduction
		expect(result?.pcm.length).toBe(1_600)
	})

	test('encodeForModel keeps rate when already at/below target', () => {
		const chunk = new Float32Array([0.2, 0.3])
		const result = encodeForModel([chunk], 16_000)
		expect(result?.sampleRate).toBe(16_000)
		expect(result?.pcm.length).toBe(2)
	})
})
