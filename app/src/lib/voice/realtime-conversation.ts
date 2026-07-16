/**
 * Hands-free realtime CONVERSATION controller (board 0120 slice B): the mic stays open, an energy
 * VAD auto-endpoints each utterance (commit on a pause), the server streams the spoken reply back,
 * and it loops — a continuous voice roundtrip. Barge-in: a loud enough onset while the AI is
 * speaking cancels playback and starts listening again.
 *
 * It does NOT own the mic — the caller (IntentComposer) feeds captured 16 kHz frames via
 * {@link RealtimeConversation.pushFrame}. The WebSocket client and the audio sink are injectable so
 * the state machine is unit-testable without a real socket or Web Audio.
 */
import {
	floatToPcm16,
	openRealtimeVoice,
	type RealtimeVoiceClient,
	type RealtimeVoiceHandlers,
	realtimeWsUrl
} from './realtime-voice'
import { createVad, rms, type Vad } from './vad'

/** `listening` (feeding STT, VAD-endpointing) → `thinking` (turn running) → `speaking` (playing TTS). */
export type ConversationState = 'listening' | 'thinking' | 'speaking'

/** Where decoded TTS audio goes. Abstracted so tests inject a fake and the default uses Web Audio. */
export type AudioSink = {
	play(bytes: ArrayBuffer, sampleRate?: number): void
	stop(): void
	/** ms of audio still scheduled — used to return to listening only once the reply finished. */
	pendingMs(): number
}

export type ConversationHandlers = {
	onCaption?: (text: string) => void
	onReplyText?: (full: string) => void
	onState?: (state: ConversationState) => void
	onError?: (message: string) => void
	onStatus?: (text: string) => void
	onChatEvent?: (json: Record<string, unknown>) => void
}

export type RealtimeConversation = {
	/** Feed one captured mic frame (float32 @ 16 kHz) with its capture time. */
	pushFrame(pcm16k: Float32Array, nowMs: number): void
	/** End the conversation: stop playback + close the socket. */
	stop(): void
	readonly state: ConversationState
}

/**
 * Gap-free Web Audio sink over a (blessed) AudioContext. Each server audio frame is a self-contained
 * clip (WAV) decoded with `decodeAudioData` — format- and sample-rate-agnostic. Decodes are chained
 * so clips play back-to-back in order.
 */
export function webAudioSink(ctx: AudioContext): AudioSink {
	let nextStart = 0
	let chain: Promise<void> = Promise.resolve()
	let stopped = false
	const sources = new Set<AudioBufferSourceNode>()
	return {
		play(bytes) {
			// decodeAudioData detaches its input — copy so the caller's ArrayBuffer stays intact.
			const copy = bytes.slice(0)
			stopped = false
			chain = chain.then(async () => {
				let buffer: AudioBuffer
				try {
					buffer = await ctx.decodeAudioData(copy)
				} catch {
					return // undecodable chunk — skip
				}
				if (stopped) return
				if (ctx.state === 'suspended') await ctx.resume()
				const src = ctx.createBufferSource()
				src.buffer = buffer
				src.connect(ctx.destination)
				const at = Math.max(ctx.currentTime, nextStart)
				src.start(at)
				nextStart = at + buffer.duration
				sources.add(src)
				src.onended = () => sources.delete(src)
			})
		},
		stop() {
			stopped = true
			for (const s of sources) {
				try {
					s.stop()
				} catch {
					/* already stopped */
				}
			}
			sources.clear()
			nextStart = 0
		},
		pendingMs() {
			return Math.max(0, (nextStart - ctx.currentTime) * 1000)
		}
	}
}

/**
 * Start a hands-free conversation. Provide a BLESSED `audioContext` (created inside the tap gesture)
 * so playback isn't stuck suspended on iOS/WKWebView — that off-gesture-suspended context is why the
 * reply "never speaks back". `bargeThreshold` (RMS) is intentionally higher than the VAD threshold so
 * the AI's own voice leaking into the mic doesn't false-trigger a barge-in.
 */
export function startRealtimeConversation(opts: {
	baseUrl: string
	token: string
	audioContext?: AudioContext
	handlers?: ConversationHandlers
	bargeThreshold?: number
	vad?: Vad
	audioSink?: AudioSink
	clientFactory?: (url: string, handlers: RealtimeVoiceHandlers) => RealtimeVoiceClient
	setTimeoutFn?: (fn: () => void, ms: number) => void
}): RealtimeConversation {
	const h = opts.handlers ?? {}
	const vad = opts.vad ?? createVad()
	const bargeThreshold = opts.bargeThreshold ?? 0.05
	const later = opts.setTimeoutFn ?? ((fn, ms) => void setTimeout(fn, ms))
	const sink: AudioSink =
		opts.audioSink ??
		(opts.audioContext
			? webAudioSink(opts.audioContext)
			: { play: () => {}, stop: () => {}, pendingMs: () => 0 })

	let state: ConversationState = 'listening'
	let sampleRate = 24_000
	let reply = ''

	const setState = (s: ConversationState) => {
		if (s === state) return
		state = s
		if (s === 'listening') vad.reset()
		h.onState?.(s)
	}

	const clientHandlers: RealtimeVoiceHandlers = {
		onCaption: (t) => h.onCaption?.(t),
		onReply: (delta) => {
			reply += delta
			h.onReplyText?.(reply)
		},
		onReplyDone: (full) => {
			reply = full
			h.onReplyText?.(reply)
		},
		onAudioInfo: (sr) => {
			sampleRate = sr
		},
		onAudio: (bytes) => {
			// Drop stray audio from an interrupted turn that's still draining after a barge-in put us
			// back in listening — otherwise it would flip us back to speaking and talk over the user.
			if (state === 'listening') return
			setState('speaking')
			sink.play(bytes, sampleRate)
		},
		onTurnDone: () => {
			// Ignore a stale turn_done that lands after a barge-in already returned us to listening
			// (the interrupted turn's finalizer). Only a live thinking/speaking turn ends here.
			if (state === 'listening') return
			// Return to listening only after the queued reply audio has finished playing.
			reply = ''
			const wait = sink.pendingMs()
			if (wait <= 0) setState('listening')
			else later(() => setState('listening'), wait)
		},
		onError: (m) => h.onError?.(m),
		onStatus: (t) => h.onStatus?.(t),
		onChatEvent: (json) => h.onChatEvent?.(json)
	}

	const client = opts.clientFactory
		? opts.clientFactory(realtimeWsUrl(opts.baseUrl, opts.token), clientHandlers)
		: openRealtimeVoice({ url: realtimeWsUrl(opts.baseUrl, opts.token), handlers: clientHandlers })

	return {
		get state() {
			return state
		},
		pushFrame(pcm16k: Float32Array, nowMs: number) {
			const energy = rms(pcm16k)
			if (state === 'listening') {
				client.feed(floatToPcm16(pcm16k))
				if (vad.push(energy, nowMs) === 'end') {
					client.commit()
					setState('thinking')
				}
			} else if (energy >= bargeThreshold) {
				// Barge-in from EITHER `speaking` (AI talking) OR `thinking` (turn still running): a
				// clearly-voiced onset (above the higher-than-VAD threshold) overwrites the current
				// interaction with a fresh request. Stop any playback, tell the server to abort the
				// in-flight turn (keeping the socket), and start listening to the new utterance.
				sink.stop()
				client.interrupt()
				setState('listening')
				client.feed(floatToPcm16(pcm16k))
				vad.push(energy, nowMs)
			}
		},
		stop() {
			sink.stop()
			client.cancel()
		}
	}
}
