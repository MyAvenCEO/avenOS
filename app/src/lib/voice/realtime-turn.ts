/**
 * One realtime voice turn (board 0120): opens the duplex socket to the server orchestrator, streams
 * mic PCM16 up, shows captions, and plays the TTS audio the SERVER streams down (STT→LLM→TTS all
 * run server-side). Thin glue over {@link openRealtimeVoice} + Web Audio; the pure conversions it
 * relies on ({@link floatToPcm16}, {@link pcm16ToFloat32}) are unit-tested in `realtime-voice.ts`.
 */
import {
	floatToPcm16,
	openRealtimeVoice,
	pcm16ToFloat32,
	type RealtimeVoiceClient,
	realtimeWsUrl
} from './realtime-voice'

export type RealtimeTurn = {
	/** Feed one chunk of mic audio (float32 @ 16 kHz). */
	feed(pcm16k: Float32Array): void
	/** End the user's turn — the server runs the LLM + streams TTS back. */
	commit(): void
	/** Abort the turn and stop playback. */
	cancel(): void
}

export type RealtimeTurnHandlers = {
	onCaption?: (text: string) => void
	onReplyText?: (full: string) => void
	onDone?: (assistantText: string) => void
	onError?: (message: string) => void
}

/** Start a realtime voice turn against the proxy orchestrator. */
export function startRealtimeTurn(opts: {
	baseUrl: string
	token: string
	handlers?: RealtimeTurnHandlers
	audioContextFactory?: () => AudioContext
}): RealtimeTurn {
	const h = opts.handlers ?? {}
	let ctx: AudioContext | null = null
	let sampleRate = 24_000
	let nextStart = 0
	let reply = ''

	const audioContext = (): AudioContext => {
		if (!ctx) {
			const Ctx: typeof AudioContext =
				window.AudioContext ??
				(window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
			ctx = new Ctx()
		}
		return ctx
	}

	/** Schedule one PCM audio frame back-to-back after the previous one (gap-free streaming). */
	const playFrame = (bytes: ArrayBuffer) => {
		const samples = pcm16ToFloat32(bytes)
		if (samples.length === 0) return
		const c = audioContext()
		if (c.state === 'suspended') void c.resume()
		const buffer = c.createBuffer(1, samples.length, sampleRate)
		buffer.getChannelData(0).set(samples)
		const src = c.createBufferSource()
		src.buffer = buffer
		src.connect(c.destination)
		const now = c.currentTime
		const at = Math.max(now, nextStart)
		src.start(at)
		nextStart = at + buffer.duration
	}

	const client: RealtimeVoiceClient = openRealtimeVoice({
		url: realtimeWsUrl(opts.baseUrl, opts.token),
		handlers: {
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
			onAudio: (bytes) => playFrame(bytes),
			onTurnDone: () => h.onDone?.(reply),
			onError: (m) => h.onError?.(m)
		}
	})

	return {
		feed(pcm16k: Float32Array) {
			client.feed(floatToPcm16(pcm16k))
		},
		commit() {
			client.commit()
		},
		cancel() {
			client.cancel()
			try {
				void ctx?.close()
			} catch {
				/* already closed */
			}
			ctx = null
		}
	}
}
