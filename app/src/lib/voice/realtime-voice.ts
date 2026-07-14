/**
 * THIN client for the REALTIME LIVE VOICE mode (board 0120). All STT→LLM→TTS orchestration lives
 * SERVER-SIDE on the Alberobello proxy (aven-node), which sits network-close to the Tinfoil
 * enclaves and holds the API key — so the intermediate transcript + reply text never travel back
 * to the phone. This client does exactly two things over ONE duplex WebSocket:
 *   • stream captured mic PCM16 (16 kHz mono) UP
 *   • receive `caption` / `reply` text events + TTS audio frames DOWN
 *
 * The on-device path (`$lib/intent-mock/transcribe`, `$lib/llm/generate`, `$lib/tts/speak`) is
 * untouched — this is the alternate mode selected via `$lib/settings/voice-mode-store`.
 */

/** Minimal WebSocket surface so the client is unit-testable with a fake socket. */
export type WebSocketLike = {
	readyState: number
	binaryType?: string
	send(data: ArrayBufferLike | ArrayBufferView | string): void
	close(code?: number, reason?: string): void
	onopen: ((ev: unknown) => void) | null
	onmessage: ((ev: { data: unknown }) => void) | null
	onerror: ((ev: unknown) => void) | null
	onclose: ((ev: unknown) => void) | null
}

/**
 * Convert float32 PCM in [-1, 1] to little-endian signed PCM16 — the wire format the realtime STT
 * expects. Samples are clamped before scaling so out-of-range values don't wrap.
 */
export function floatToPcm16(samples: Float32Array): Int16Array {
	const out = new Int16Array(samples.length)
	for (let i = 0; i < samples.length; i++) {
		const s = Math.max(-1, Math.min(1, samples[i]))
		out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
	}
	return out
}

/** Decode little-endian signed PCM16 bytes into float32 [-1, 1] for Web Audio playback. */
export function pcm16ToFloat32(bytes: ArrayBuffer): Float32Array {
	const view = new DataView(bytes)
	const n = Math.floor(bytes.byteLength / 2)
	const out = new Float32Array(n)
	for (let i = 0; i < n; i++) {
		const s = view.getInt16(i * 2, true)
		out[i] = s < 0 ? s / 0x8000 : s / 0x7fff
	}
	return out
}

/** Build the proxy voice WebSocket URL — http(s) → ws(s), bearer as `?token=` (browsers can't set
 *  WebSocket headers). */
export function realtimeWsUrl(baseUrl: string, token: string): string {
	const u = new URL('/api/ai/voice/realtime/ws', baseUrl)
	u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
	if (token) u.searchParams.set('token', token)
	return u.toString()
}

/**
 * The turn events the SERVER streams down: `caption` (running transcript for preview), `reply`
 * (assistant text delta), `reply_done` (full assistant text), `audio_info` (TTS sample rate),
 * `turn_done` (end of the assistant turn), `error`, or a binary `audio` frame (TTS PCM). Pure +
 * total so it's trivially unit-testable.
 */
export type VoiceServerEvent =
	| { kind: 'caption'; text: string }
	| { kind: 'reply'; text: string }
	| { kind: 'reply_done'; text: string }
	| { kind: 'audio_info'; sampleRate: number }
	| { kind: 'audio'; bytes: ArrayBuffer }
	| { kind: 'turn_done' }
	| { kind: 'error'; message: string }
	| { kind: 'unknown' }

/** Classify one inbound WebSocket frame: binary → audio, JSON string → a typed event. */
export function classifyVoiceServerEvent(data: unknown): VoiceServerEvent {
	if (data instanceof ArrayBuffer) return { kind: 'audio', bytes: data }
	if (ArrayBuffer.isView(data)) {
		const v = data as ArrayBufferView
		return {
			kind: 'audio',
			bytes: v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer
		}
	}
	if (typeof data !== 'string') return { kind: 'unknown' }
	let msg: Record<string, unknown>
	try {
		msg = JSON.parse(data) as Record<string, unknown>
	} catch {
		return { kind: 'unknown' }
	}
	const text = typeof msg.text === 'string' ? msg.text : ''
	switch (msg.t) {
		case 'caption':
			return { kind: 'caption', text }
		case 'reply':
			return { kind: 'reply', text }
		case 'reply_done':
			return { kind: 'reply_done', text }
		case 'audio_info':
			return { kind: 'audio_info', sampleRate: Number(msg.sampleRate) || 24_000 }
		case 'turn_done':
			return { kind: 'turn_done' }
		case 'error':
			return { kind: 'error', message: typeof msg.message === 'string' ? msg.message : 'error' }
		default:
			return { kind: 'unknown' }
	}
}

/** Callbacks for a live voice turn. All optional. */
export type RealtimeVoiceHandlers = {
	onCaption?: (text: string) => void
	onReply?: (delta: string) => void
	onReplyDone?: (full: string) => void
	onAudioInfo?: (sampleRate: number) => void
	onAudio?: (bytes: ArrayBuffer) => void
	onTurnDone?: () => void
	onError?: (message: string) => void
}

/** Drives one duplex voice connection. `feed` streams mic PCM16 up; `commit` ends the user turn. */
export type RealtimeVoiceClient = {
	feed(pcm16: Int16Array): void
	commit(): void
	cancel(): void
}

/**
 * Open the duplex voice WebSocket to the proxy orchestrator. Mic PCM16 is streamed up (buffered
 * until the socket opens); server events are dispatched to `handlers`. The socket is injectable so
 * the send/dispatch logic is unit-testable without a real WebSocket.
 */
export function openRealtimeVoice(opts: {
	url: string
	handlers?: RealtimeVoiceHandlers
	socketFactory?: (url: string) => WebSocketLike
}): RealtimeVoiceClient {
	const ws = opts.socketFactory
		? opts.socketFactory(opts.url)
		: (new WebSocket(opts.url) as unknown as WebSocketLike)
	ws.binaryType = 'arraybuffer'
	const h = opts.handlers ?? {}

	const queue: (ArrayBuffer | string)[] = []
	let open = false
	const sendOrQueue = (data: ArrayBuffer | string) => {
		if (open && ws.readyState === 1) ws.send(data)
		else queue.push(data)
	}

	ws.onopen = () => {
		open = true
		for (const item of queue.splice(0)) ws.send(item)
	}
	ws.onmessage = (ev) => {
		const e = classifyVoiceServerEvent(ev.data)
		switch (e.kind) {
			case 'caption':
				h.onCaption?.(e.text)
				break
			case 'reply':
				h.onReply?.(e.text)
				break
			case 'reply_done':
				h.onReplyDone?.(e.text)
				break
			case 'audio_info':
				h.onAudioInfo?.(e.sampleRate)
				break
			case 'audio':
				h.onAudio?.(e.bytes)
				break
			case 'turn_done':
				h.onTurnDone?.()
				break
			case 'error':
				h.onError?.(e.message)
				break
			default:
				break
		}
	}
	ws.onerror = () => h.onError?.('voice socket error')

	return {
		feed(pcm16: Int16Array) {
			const buf = pcm16.buffer.slice(
				pcm16.byteOffset,
				pcm16.byteOffset + pcm16.byteLength
			) as ArrayBuffer
			sendOrQueue(buf)
		},
		commit() {
			sendOrQueue(JSON.stringify({ t: 'commit' }))
		},
		cancel() {
			try {
				if (open && ws.readyState === 1) ws.send(JSON.stringify({ t: 'cancel' }))
			} catch {
				/* closing */
			}
			try {
				ws.close()
			} catch {
				/* already closing */
			}
		}
	}
}
