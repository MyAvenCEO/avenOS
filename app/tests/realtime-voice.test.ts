import { describe, expect, test } from 'bun:test'
import {
	chunkSentences,
	fetchRealtimeConfig,
	floatToPcm16,
	synthesizeSpeech
} from '../src/lib/voice/realtime-voice'

describe('floatToPcm16', () => {
	test('scales and clamps float32 to signed PCM16', () => {
		const out = floatToPcm16(new Float32Array([0, 1, -1, 2, -2, 0.5]))
		expect(out[0]).toBe(0)
		expect(out[1]).toBe(0x7fff) // +1 → max positive
		expect(out[2]).toBe(-0x8000) // -1 → max negative
		expect(out[3]).toBe(0x7fff) // clamped
		expect(out[4]).toBe(-0x8000) // clamped
		expect(out[5]).toBe(Math.trunc(0.5 * 0x7fff))
		expect(out.length).toBe(6)
	})
})

describe('chunkSentences', () => {
	test('emits complete sentences and keeps the trailing remainder', () => {
		const { sentences, rest } = chunkSentences('Hello there. How are you? I am fi')
		expect(sentences).toEqual(['Hello there.', 'How are you?'])
		expect(rest).toBe('I am fi')
	})

	test('no terminator yet → nothing to speak, whole buffer is rest', () => {
		const { sentences, rest } = chunkSentences('still typing')
		expect(sentences).toEqual([])
		expect(rest).toBe('still typing')
	})

	test('keeps a closing quote with its sentence', () => {
		const { sentences, rest } = chunkSentences('She said "go!" and left. Then')
		expect(sentences).toEqual(['She said "go!"', 'and left.'])
		expect(rest).toBe('Then')
	})
})

describe('fetchRealtimeConfig', () => {
	test('sends the bearer token and returns parsed config', async () => {
		let seenUrl = ''
		let seenAuth: string | undefined
		const cfg = await fetchRealtimeConfig({
			baseUrl: 'https://api.test',
			token: 'tok123',
			fetchImpl: async (url, init) => {
				seenUrl = url
				seenAuth = (init?.headers as Record<string, string>)?.Authorization
				return new Response(
					JSON.stringify({
						sttModel: 'voxtral-mini-4b-realtime',
						llmModel: 'gpt-oss-120b',
						ttsModel: 'voxtral-tts',
						sampleRate: 16000,
						delayMs: 480,
						intent: 'transcription'
					}),
					{ status: 200 }
				)
			}
		})
		expect(seenUrl).toBe('https://api.test/api/ai/voice/realtime')
		expect(seenAuth).toBe('Bearer tok123')
		expect(cfg.sttModel).toBe('voxtral-mini-4b-realtime')
		expect(cfg.sampleRate).toBe(16000)
	})

	test('throws on a non-2xx (caller falls back to on-device)', async () => {
		await expect(
			fetchRealtimeConfig({
				baseUrl: 'https://api.test',
				fetchImpl: async () => new Response('nope', { status: 401 })
			})
		).rejects.toThrow('401')
	})
})

describe('synthesizeSpeech', () => {
	test('POSTs the text and returns the audio bytes', async () => {
		let seenBody: unknown
		const buf = await synthesizeSpeech({
			baseUrl: 'https://api.test',
			text: 'hello',
			token: 'tok',
			fetchImpl: async (_url, init) => {
				seenBody = JSON.parse(String(init?.body))
				return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 })
			}
		})
		expect((seenBody as { text: string }).text).toBe('hello')
		expect(new Uint8Array(buf)).toEqual(new Uint8Array([1, 2, 3, 4]))
	})
})
