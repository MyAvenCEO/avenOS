import { describe, expect, test } from 'bun:test'
import {
	buildSpeechRequest,
	chunkSentences,
	createVoiceOrchestrator,
	DEFAULT_LLM_MODEL,
	DEFAULT_STT_MODEL,
	DEFAULT_TTS_MODEL,
	parseTranscriptEvent,
	realtimeUpstreamUrl,
	resolveVoiceModels,
	type VoiceDownstream,
	voiceAuthError,
	type WebSocketLike
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

describe('realtimeUpstreamUrl', () => {
	test('adds intent=transcription and the stt model', () => {
		const url = new URL(realtimeUpstreamUrl(resolveVoiceModels({}), 'wss://enclave/v1/realtime'))
		expect(url.searchParams.get('intent')).toBe('transcription')
		expect(url.searchParams.get('model')).toBe(DEFAULT_STT_MODEL)
	})
})

describe('parseTranscriptEvent', () => {
	test('delta / final / ignore', () => {
		expect(
			parseTranscriptEvent(
				JSON.stringify({ type: 'conversation.item.input_audio_transcription.delta', delta: 'he' })
			)
		).toEqual({ delta: 'he' })
		expect(
			parseTranscriptEvent(
				JSON.stringify({
					type: 'conversation.item.input_audio_transcription.completed',
					transcript: 'hello there'
				})
			)
		).toEqual({ final: 'hello there' })
		expect(parseTranscriptEvent(JSON.stringify({ type: 'session.created' }))).toEqual({})
		expect(parseTranscriptEvent('not json')).toEqual({})
	})
})

describe('chunkSentences', () => {
	test('emits complete sentences and keeps the remainder', () => {
		const { sentences, rest } = chunkSentences('Hello there. How are you? I am fi')
		expect(sentences).toEqual(['Hello there.', 'How are you?'])
		expect(rest).toBe('I am fi')
	})
})

// ── orchestrator: STT deltas → caption; final → LLM stream → sentence-chunked TTS → audio ──
describe('createVoiceOrchestrator', () => {
	function fakeUpstream() {
		const sent: (string | ArrayBufferLike | ArrayBufferView)[] = []
		const ws: WebSocketLike = {
			readyState: 1,
			send: (d) => void sent.push(d),
			close: () => {}
		}
		return { ws, sent }
	}
	function sseResponse(deltas: string[]): Response {
		const enc = new TextEncoder()
		const stream = new ReadableStream<Uint8Array>({
			start(c) {
				for (const d of deltas) {
					c.enqueue(
						enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: d } }] })}\n\n`)
					)
				}
				c.enqueue(enc.encode('data: [DONE]\n\n'))
				c.close()
			}
		})
		return new Response(stream, { status: 200 })
	}

	test('drives a full turn: caption, reply deltas, TTS audio, reply_done, turn_done', async () => {
		const up = fakeUpstream()
		const events: Record<string, unknown>[] = []
		let audioFrames = 0
		const down: VoiceDownstream = {
			sendEvent: (e) => void events.push(e),
			sendAudio: () => {
				audioFrames++
			}
		}
		let speechCalls = 0
		const fetchImpl = (async (url: string) => {
			if (String(url).endsWith('/chat/completions')) return sseResponse(['Hi there.', ' All good?'])
			if (String(url).endsWith('/audio/speech')) {
				speechCalls++
				return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 })
			}
			return new Response('nope', { status: 404 })
		}) as unknown as typeof fetch

		const orch = createVoiceOrchestrator({
			down,
			upstream: up.ws,
			apiKey: 'k',
			baseUrl: 'https://enclave/v1',
			fetchImpl
		})
		orch.onUpstreamOpen()
		// mic PCM forwards to upstream
		orch.onClientFrame(new Uint8Array([9, 9]).buffer)
		expect(up.sent).toHaveLength(1)
		// partial transcript → caption
		orch.onUpstreamFrame(JSON.stringify({ type: 'x.transcription.delta', delta: 'turn on' }))
		expect(events.find((e) => e.t === 'caption')).toEqual({ t: 'caption', text: 'turn on' })
		// final transcript → runs the LLM/TTS turn
		orch.onUpstreamFrame(
			JSON.stringify({ type: 'x.transcription.completed', transcript: 'turn on the lights' })
		)
		// let the async turn complete
		for (let i = 0; i < 50 && !events.some((e) => e.t === 'turn_done'); i++) {
			await new Promise((r) => setTimeout(r, 0))
		}
		const kinds = events.map((e) => e.t)
		expect(kinds).toContain('reply')
		expect(kinds).toContain('reply_done')
		expect(kinds).toContain('turn_done')
		expect(events.find((e) => e.t === 'reply_done')?.text).toBe('Hi there. All good?')
		// two sentences → two TTS syntheses + two audio frames
		expect(speechCalls).toBe(2)
		expect(audioFrames).toBe(2)
	})

	test('routes the LLM turn through /api/ai/chat with the bearer (tool loop → todos)', async () => {
		const up = fakeUpstream()
		const events: Record<string, unknown>[] = []
		const down: VoiceDownstream = { sendEvent: (e) => void events.push(e), sendAudio: () => {} }
		let chatUrl = ''
		let chatAuth: string | undefined
		let chatBody: { messages?: { content?: string }[] } = {}
		const fetchImpl = (async (url: string, init?: RequestInit) => {
			if (String(url).endsWith('/api/ai/chat')) {
				chatUrl = String(url)
				chatAuth = (init?.headers as Record<string, string>)?.Authorization
				chatBody = JSON.parse(String(init?.body))
				// full chat pipeline emits an aven_tool event (a todo write) + content deltas
				const enc = new TextEncoder()
				const stream = new ReadableStream<Uint8Array>({
					start(ctrl) {
						ctrl.enqueue(
							enc.encode(`data: ${JSON.stringify({ aven_tool: { name: 'data_crud' } })}\n\n`)
						)
						ctrl.enqueue(
							enc.encode(
								`data: ${JSON.stringify({ choices: [{ delta: { content: 'Added it.' } }] })}\n\n`
							)
						)
						ctrl.enqueue(enc.encode('data: [DONE]\n\n'))
						ctrl.close()
					}
				})
				return new Response(stream, { status: 200 })
			}
			if (String(url).endsWith('/audio/speech'))
				return new Response(new Uint8Array([1]), { status: 200 })
			return new Response('nope', { status: 404 })
		}) as unknown as typeof fetch

		const orch = createVoiceOrchestrator({
			down,
			upstream: up.ws,
			apiKey: 'k',
			baseUrl: 'https://enclave/v1',
			chatEndpoint: 'http://127.0.0.1:8787/api/ai/chat',
			token: 'bearer-xyz',
			fetchImpl
		})
		orch.onUpstreamOpen()
		orch.onUpstreamFrame(
			JSON.stringify({ type: 'x.transcription.completed', transcript: 'add a todo to buy milk' })
		)
		for (let i = 0; i < 50 && !events.some((e) => e.t === 'turn_done'); i++) {
			await new Promise((r) => setTimeout(r, 0))
		}
		expect(chatUrl).toBe('http://127.0.0.1:8787/api/ai/chat')
		expect(chatAuth).toBe('Bearer bearer-xyz') // caller's session, so the tool loop runs as the user
		expect(chatBody.messages?.[0]?.content).toBe('add a todo to buy milk')
		expect(events.find((e) => e.t === 'reply_done')?.text).toBe('Added it.') // aven_tool event tolerated
	})

	test('commit before upstream-open is deferred, then flushed as the STT commit control', () => {
		const up = fakeUpstream()
		up.ws.readyState = 0 // not open yet
		const orch = createVoiceOrchestrator({
			down: { sendEvent: () => {}, sendAudio: () => {} },
			upstream: up.ws,
			apiKey: 'k'
		})
		orch.onClientFrame(JSON.stringify({ t: 'commit' }))
		expect(up.sent).toHaveLength(0) // deferred
		up.ws.readyState = 1
		orch.onUpstreamOpen()
		expect(up.sent).toContain(JSON.stringify({ type: 'input_audio_buffer.commit' }))
	})
})
