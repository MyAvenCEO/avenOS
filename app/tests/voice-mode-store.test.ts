import { describe, expect, test } from 'bun:test'
import { get } from 'svelte/store'
import {
	DEFAULT_VOICE_MODE,
	isVoiceMode,
	readVoiceMode,
	setVoiceMode,
	voiceMode
} from '../src/lib/settings/voice-mode-store'

/** In-memory Storage-like backend for persistence roundtrip tests. */
function memStorage(seed?: Record<string, string>): Pick<Storage, 'getItem' | 'setItem'> {
	const map = new Map<string, string>(Object.entries(seed ?? {}))
	return {
		getItem: (k) => map.get(k) ?? null,
		setItem: (k, v) => void map.set(k, v)
	}
}

describe('voice-mode store', () => {
	test('default is realtime', () => {
		expect(DEFAULT_VOICE_MODE).toBe('realtime')
		expect(readVoiceMode(null)).toBe('realtime')
		expect(get(voiceMode)).toBe('realtime')
	})

	test('readVoiceMode falls back to realtime on unknown/absent values', () => {
		expect(readVoiceMode(memStorage())).toBe('realtime')
		expect(readVoiceMode(memStorage({ 'avenos.voiceMode': 'bogus' }))).toBe('realtime')
	})

	test('readVoiceMode honours a persisted valid value', () => {
		expect(readVoiceMode(memStorage({ 'avenos.voiceMode': 'on-device' }))).toBe('on-device')
	})

	test('isVoiceMode narrows only the two valid ids', () => {
		expect(isVoiceMode('realtime')).toBe(true)
		expect(isVoiceMode('on-device')).toBe(true)
		expect(isVoiceMode('local')).toBe(false)
		expect(isVoiceMode(null)).toBe(false)
	})

	test('setVoiceMode toggles the store', () => {
		setVoiceMode('on-device')
		expect(get(voiceMode)).toBe('on-device')
		setVoiceMode('realtime')
		expect(get(voiceMode)).toBe('realtime')
	})
})
