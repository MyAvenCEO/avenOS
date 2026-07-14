import { describe, expect, test } from 'bun:test'
import {
	buildSpeechRequest,
	DEFAULT_LLM_MODEL,
	DEFAULT_STT_MODEL,
	DEFAULT_TTS_MODEL,
	resolveVoiceModels,
	voiceAuthError
} from '../src/ai-voice'

describe('resolveVoiceModels', () => {
	test('defaults to the board-0120 Tinfoil model ids', () => {
		expect(resolveVoiceModels({})).toEqual({
			stt: DEFAULT_STT_MODEL,
			llm: DEFAULT_LLM_MODEL,
			tts: DEFAULT_TTS_MODEL
		})
		expect(DEFAULT_STT_MODEL).toBe('voxtral-mini-4b-realtime')
		expect(DEFAULT_LLM_MODEL).toBe('gpt-oss-120b')
		expect(DEFAULT_TTS_MODEL).toBe('voxtral-tts')
	})

	test('env overrides win; blank overrides are ignored', () => {
		expect(
			resolveVoiceModels({
				TINFOIL_REALTIME_STT_MODEL: 'whisper-large-v3-turbo',
				TINFOIL_LLM_MODEL: 'gemma4-31b',
				TINFOIL_TTS_MODEL: '   '
			})
		).toEqual({ stt: 'whisper-large-v3-turbo', llm: 'gemma4-31b', tts: DEFAULT_TTS_MODEL })
	})
})

describe('voiceAuthError', () => {
	test('401 when there is no session', () => {
		expect(voiceAuthError(null)).toEqual({ status: 401, error: 'unauthorized' })
		expect(voiceAuthError(undefined)).toEqual({ status: 401, error: 'unauthorized' })
	})

	test('null (proceed) when a session is present', () => {
		expect(voiceAuthError({ user: { id: 'u1' } })).toBeNull()
	})
})

describe('buildSpeechRequest', () => {
	test('builds the OpenAI-style body with pcm/default fallbacks', () => {
		expect(buildSpeechRequest({ text: '  hi  ', model: 'voxtral-tts' })).toEqual({
			model: 'voxtral-tts',
			input: 'hi',
			voice: 'default',
			response_format: 'pcm'
		})
	})

	test('honours explicit voice + format', () => {
		expect(
			buildSpeechRequest({ text: 'hello', model: 'voxtral-tts', voice: 'nova', format: 'wav' })
		).toEqual({ model: 'voxtral-tts', input: 'hello', voice: 'nova', response_format: 'wav' })
	})

	test('throws on empty/whitespace text so the handler can 400', () => {
		expect(() => buildSpeechRequest({ text: '   ', model: 'voxtral-tts' })).toThrow('text required')
	})
})
