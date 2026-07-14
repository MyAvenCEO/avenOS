import { describe, expect, test } from 'bun:test'
import {
	classifyVoiceServerEvent,
	floatToPcm16,
	openRealtimeVoice,
	pcm16ToFloat32,
	realtimeWsUrl,
	type WebSocketLike
} from '../src/lib/voice/realtime-voice'

/** A controllable fake socket for driving the client state machine. */
function fakeSocket() {
	const sent: (ArrayBuffer | string)[] = []
	const ws: WebSocketLike = {
		readyState: 0,
		binaryType: '',
		send: (d) => void sent.push(d as ArrayBuffer | string),
		close: () => {
			ws.readyState = 3
		},
		onopen: null,
		onmessage: null,
		onerror: null,
		onclose: null
	}
	return {
		ws,
		sent,
		open: () => {
			ws.readyState = 1
			ws.onopen?.(null)
		},
		emit: (data: unknown) => ws.onmessage?.({ data })
	}
}

describe('floatToPcm16', () => {
	test('scales and clamps float32 to signed PCM16', () => {
		const out = floatToPcm16(new Float32Array([0, 1, -1, 2, -2, 0.5]))
		expect(out[0]).toBe(0)
		expect(out[1]).toBe(0x7fff)
		expect(out[2]).toBe(-0x8000)
		expect(out[3]).toBe(0x7fff) // clamped
		expect(out[4]).toBe(-0x8000) // clamped
		expect(out[5]).toBe(Math.trunc(0.5 * 0x7fff))
	})
})

describe('pcm16ToFloat32', () => {
	test('round-trips through floatToPcm16 within quantization error', () => {
		const floats = new Float32Array([0, 0.5, -0.5, 1, -1])
		const back = pcm16ToFloat32(floatToPcm16(floats).buffer as ArrayBuffer)
		for (let i = 0; i < floats.length; i++)
			expect(Math.abs(back[i] - floats[i])).toBeLessThan(0.001)
	})
})

describe('realtimeWsUrl', () => {
	test('upgrades https → wss and attaches the token', () => {
		expect(realtimeWsUrl('https://api.test', 'tok')).toBe(
			'wss://api.test/api/ai/voice/realtime/ws?token=tok'
		)
	})
	test('http → ws; empty token omitted', () => {
		expect(realtimeWsUrl('http://localhost:8787', '')).toBe(
			'ws://localhost:8787/api/ai/voice/realtime/ws'
		)
	})
})

describe('classifyVoiceServerEvent', () => {
	test('binary → audio', () => {
		const e = classifyVoiceServerEvent(new Uint8Array([1, 2]).buffer)
		expect(e.kind).toBe('audio')
	})
	test('typed-array view → audio (copied slice)', () => {
		const e = classifyVoiceServerEvent(new Uint8Array([1, 2, 3]))
		expect(e).toEqual({ kind: 'audio', bytes: new Uint8Array([1, 2, 3]).buffer })
	})
	test('json events map to typed kinds', () => {
		expect(classifyVoiceServerEvent(JSON.stringify({ t: 'caption', text: 'hi' }))).toEqual({
			kind: 'caption',
			text: 'hi'
		})
		expect(classifyVoiceServerEvent(JSON.stringify({ t: 'reply', text: 'yo' }))).toEqual({
			kind: 'reply',
			text: 'yo'
		})
		expect(
			classifyVoiceServerEvent(JSON.stringify({ t: 'audio_info', sampleRate: 24000 }))
		).toEqual({ kind: 'audio_info', sampleRate: 24000 })
		expect(classifyVoiceServerEvent(JSON.stringify({ t: 'turn_done' }))).toEqual({
			kind: 'turn_done'
		})
	})
	test('garbage / unknown → unknown', () => {
		expect(classifyVoiceServerEvent('not json').kind).toBe('unknown')
		expect(classifyVoiceServerEvent(JSON.stringify({ t: 'bogus' })).kind).toBe('unknown')
		expect(classifyVoiceServerEvent(42).kind).toBe('unknown')
	})
})

describe('openRealtimeVoice', () => {
	test('buffers mic frames until open, then flushes in order', () => {
		const s = fakeSocket()
		const c = openRealtimeVoice({ url: 'ws://x', socketFactory: () => s.ws })
		c.feed(new Int16Array([1, 2]))
		c.feed(new Int16Array([3, 4]))
		expect(s.sent).toHaveLength(0) // queued before open
		s.open()
		expect(s.sent).toHaveLength(2) // flushed
	})

	test('dispatches caption / reply / audio / turn_done to handlers', () => {
		const s = fakeSocket()
		const captions: string[] = []
		const replies: string[] = []
		let audioBytes = 0
		let done = false
		openRealtimeVoice({
			url: 'ws://x',
			socketFactory: () => s.ws,
			handlers: {
				onCaption: (t) => captions.push(t),
				onReply: (t) => replies.push(t),
				onAudio: (b) => {
					audioBytes += b.byteLength
				},
				onTurnDone: () => {
					done = true
				}
			}
		})
		s.open()
		s.emit(JSON.stringify({ t: 'caption', text: 'hello wor' }))
		s.emit(JSON.stringify({ t: 'reply', text: 'Hi there.' }))
		s.emit(new Uint8Array([0, 0, 0, 0]).buffer)
		s.emit(JSON.stringify({ t: 'turn_done' }))
		expect(captions).toEqual(['hello wor'])
		expect(replies).toEqual(['Hi there.'])
		expect(audioBytes).toBe(4)
		expect(done).toBe(true)
	})

	test('commit sends the control frame after open', () => {
		const s = fakeSocket()
		const c = openRealtimeVoice({ url: 'ws://x', socketFactory: () => s.ws })
		s.open()
		c.commit()
		expect(s.sent.at(-1)).toBe(JSON.stringify({ t: 'commit' }))
	})
})
