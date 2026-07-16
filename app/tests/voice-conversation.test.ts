import { describe, expect, test } from 'bun:test'
import {
	type AudioSink,
	type ConversationState,
	startRealtimeConversation
} from '../src/lib/voice/realtime-conversation'
import type { RealtimeVoiceClient, RealtimeVoiceHandlers } from '../src/lib/voice/realtime-voice'
import { createVad, rms } from '../src/lib/voice/vad'

const loud = (n = 320) => new Float32Array(n).fill(0.2) // rms 0.2 (> thresholds)
const quiet = (n = 320) => new Float32Array(n) // rms 0

describe('rms + createVad', () => {
	test('rms of a constant frame is its magnitude', () => {
		expect(rms(new Float32Array([0.2, 0.2, 0.2]))).toBeCloseTo(0.2, 5)
		expect(rms(new Float32Array())).toBe(0)
	})

	test('speech onset → start; sustained silence past hangover → end', () => {
		const vad = createVad({ threshold: 0.015, hangoverMs: 700 })
		expect(vad.push(0.2, 0)).toBe('start')
		expect(vad.push(0.2, 100)).toBeNull() // still speaking (last voice = 100)
		expect(vad.push(0, 200)).toBeNull() // silence, within hangover
		expect(vad.push(0, 800)).toBe('end') // 700ms since last voice (100 → 800)
		expect(vad.speaking).toBe(false)
	})

	test('intra-word pause under hangover does not end the turn', () => {
		const vad = createVad({ hangoverMs: 700 })
		vad.push(0.2, 0)
		expect(vad.push(0, 300)).toBeNull()
		expect(vad.push(0.2, 400)).toBeNull() // voice resumes → no end
		expect(vad.push(0, 900)).toBeNull() // only 500ms since t=400
	})
})

/** A fake voice client that records calls and exposes the handlers wired into it. */
function fakeClient() {
	const calls: string[] = []
	let handlers: RealtimeVoiceHandlers = {}
	const factory = (_url: string, h: RealtimeVoiceHandlers): RealtimeVoiceClient => {
		handlers = h
		return {
			feed: () => calls.push('feed'),
			commit: () => calls.push('commit'),
			interrupt: () => calls.push('interrupt'),
			cancel: () => calls.push('cancel')
		}
	}
	return { factory, calls, h: () => handlers }
}

function fakeSink(): AudioSink & { played: number; stops: number } {
	return {
		played: 0,
		stops: 0,
		play() {
			this.played++
		},
		stop() {
			this.stops++
		},
		pendingMs: () => 0
	}
}

describe('startRealtimeConversation', () => {
	test('auto-endpoints an utterance: feeds while speaking, commits on the pause', () => {
		const client = fakeClient()
		const states: ConversationState[] = []
		const conv = startRealtimeConversation({
			baseUrl: 'https://api.test',
			token: 't',
			clientFactory: client.factory,
			audioSink: fakeSink(),
			handlers: { onState: (s) => states.push(s) },
			vad: createVad({ threshold: 0.015, hangoverMs: 700 })
		})
		conv.pushFrame(loud(), 0) // speech onset
		conv.pushFrame(loud(), 100)
		conv.pushFrame(quiet(), 800) // 800ms since last voice → end → commit
		expect(client.calls.filter((c) => c === 'feed').length).toBeGreaterThanOrEqual(2)
		expect(client.calls).toContain('commit')
		expect(conv.state).toBe('thinking')
		expect(states).toContain('thinking')
	})

	test('server audio → speaking, then turn_done → back to listening (playback drained)', () => {
		const client = fakeClient()
		const sink = fakeSink()
		const conv = startRealtimeConversation({
			baseUrl: 'https://api.test',
			token: 't',
			clientFactory: client.factory,
			audioSink: sink,
			vad: createVad({ threshold: 0.015, hangoverMs: 700 })
		})
		conv.pushFrame(loud(), 0) // speak
		conv.pushFrame(quiet(), 800) // pause → commit → thinking
		expect(conv.state).toBe('thinking')
		client.h().onAudio?.(new Uint8Array([0, 0, 0, 0]).buffer) // reply audio → speaking
		expect(conv.state).toBe('speaking')
		expect(sink.played).toBe(1)
		client.h().onTurnDone?.()
		expect(conv.state).toBe('listening') // pendingMs 0 → immediate
	})

	test('barge-in: a loud onset while speaking stops playback, interrupts the turn, resumes listening', () => {
		const client = fakeClient()
		const sink = fakeSink()
		const conv = startRealtimeConversation({
			baseUrl: 'https://api.test',
			token: 't',
			clientFactory: client.factory,
			audioSink: sink,
			bargeThreshold: 0.05,
			vad: createVad({ threshold: 0.015, hangoverMs: 700 })
		})
		conv.pushFrame(loud(), 0) // speak
		conv.pushFrame(quiet(), 800) // pause → thinking
		client.h().onAudio?.(new Uint8Array([1, 2]).buffer) // → speaking
		expect(conv.state).toBe('speaking')
		conv.pushFrame(loud(), 2000) // rms 0.2 > barge threshold
		expect(sink.stops).toBeGreaterThanOrEqual(1)
		expect(client.calls).toContain('interrupt')
		expect(conv.state).toBe('listening')
	})

	test('barge-in while THINKING interrupts the in-flight turn and starts a fresh utterance', () => {
		const client = fakeClient()
		const sink = fakeSink()
		const conv = startRealtimeConversation({
			baseUrl: 'https://api.test',
			token: 't',
			clientFactory: client.factory,
			audioSink: sink,
			bargeThreshold: 0.05,
			vad: createVad({ threshold: 0.015, hangoverMs: 700 })
		})
		// Drive to thinking: speak, then pause → commit.
		conv.pushFrame(loud(), 0)
		conv.pushFrame(quiet(), 800)
		expect(conv.state).toBe('thinking')
		client.calls.length = 0
		// Talk again while the server is still thinking → interrupt + back to listening + feed the new frame.
		conv.pushFrame(loud(), 2000)
		expect(client.calls).toContain('interrupt')
		expect(client.calls).toContain('feed')
		expect(conv.state).toBe('listening')
	})

	test('a stale turn_done after a barge-in does not yank the new utterance out of listening', () => {
		const client = fakeClient()
		const sink = fakeSink()
		const conv = startRealtimeConversation({
			baseUrl: 'https://api.test',
			token: 't',
			clientFactory: client.factory,
			audioSink: sink,
			bargeThreshold: 0.05,
			vad: createVad({ threshold: 0.015, hangoverMs: 700 })
		})
		conv.pushFrame(loud(), 0) // speak
		conv.pushFrame(quiet(), 800) // pause → thinking
		client.h().onAudio?.(new Uint8Array([1, 2]).buffer) // → speaking
		conv.pushFrame(loud(), 2000) // barge-in → listening
		expect(conv.state).toBe('listening')
		client.h().onTurnDone?.() // the interrupted turn's late finalizer — must be ignored
		expect(conv.state).toBe('listening')
	})

	test('caption + reply text surface; stop cancels the client', () => {
		const client = fakeClient()
		let caption = ''
		let reply = ''
		const conv = startRealtimeConversation({
			baseUrl: 'https://api.test',
			token: 't',
			clientFactory: client.factory,
			audioSink: fakeSink(),
			handlers: { onCaption: (t) => (caption = t), onReplyText: (t) => (reply = t) }
		})
		client.h().onCaption?.('add a todo')
		client.h().onReply?.('Added ')
		client.h().onReply?.('it.')
		expect(caption).toBe('add a todo')
		expect(reply).toBe('Added it.')
		conv.stop()
		expect(client.calls).toContain('cancel')
	})
})
