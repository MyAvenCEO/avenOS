// Framework-agnostic browser voice engine — the proven core of the avenVOICE
// prototype (Svelte 5 stores or React can wrap it in a few lines).
//
// Lifecycle: session and mic start/stop TOGETHER (start()/stop()) so no idle
// WebSocket accrues setup-token costs while nobody is talking. Auto-reconnect
// only fires mid-call. Every tool call is answered (repeats get the cached
// response) — silence makes the model assume failure and retry in a loop.

import {
	CAPTURE_SAMPLE_RATE,
	PLAYBACK_SAMPLE_RATE,
	type ServerMessage,
	type VoiceSetup,
	type VoiceToolDeclaration
} from '../protocol'
import { CAPTURE_WORKLET, PLAYBACK_WORKLET, workletUrl } from './worklets'

export type VoiceStatus = 'disconnected' | 'connecting' | 'connected' | 'error'
export type TranscriptLine = { role: 'user' | 'assistant'; text: string }

export type VoiceEngineOptions = {
	/** Relay endpoint, e.g. `${BETTERAUTH_URL.replace('http', 'ws')}/api/voice/live`. */
	url: string
	instructions: string
	tools: VoiceToolDeclaration[]
	/** Executes a tool client-side; return value goes back to the model. */
	executeTool: (name: string, args: unknown) => unknown | Promise<unknown>
	voice?: string
	languageCode?: string
	onStatus?: (status: VoiceStatus) => void
	/** Raw hook for informational messages (toolEvent, hitl, …). */
	onServerMessage?: (msg: ServerMessage) => void
	onTranscript?: (line: TranscriptLine, isDelta: boolean) => void
	onError?: (message: string) => void
}

export class VoiceEngine {
	private opts: VoiceEngineOptions
	private ws: WebSocket | null = null
	private captureCtx: AudioContext | null = null
	private playbackCtx: AudioContext | null = null
	private playbackNode: AudioWorkletNode | null = null
	private micStream: MediaStream | null = null
	private active = false
	private manualClose = false
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null
	private openTimer: ReturnType<typeof setTimeout> | null = null
	private toolResults = new Map<string, unknown>()
	private recentByArgs = new Map<string, { response: unknown; ts: number }>()
	private assistantTurnDone = false

	status: VoiceStatus = 'disconnected'
	transcript: TranscriptLine[] = []

	constructor(opts: VoiceEngineOptions) {
		this.opts = opts
	}

	/** Opens the relay session AND the microphone in one gesture. */
	start(): void {
		this.active = true
		this.connect()
	}

	/** Ends everything: mic, playback, session. */
	stop(): void {
		this.active = false
		this.manualClose = true
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
		if (this.openTimer) clearTimeout(this.openTimer)
		this.ws?.close()
		this.ws = null
		this.teardownAudio()
		this.setStatus('disconnected')
	}

	private setStatus(s: VoiceStatus): void {
		this.status = s
		this.opts.onStatus?.(s)
	}

	private connect(): void {
		if (
			this.ws &&
			(this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
		) {
			return
		}
		this.manualClose = false
		this.setStatus('connecting')
		this.toolResults.clear()
		this.recentByArgs.clear()
		const ws = new WebSocket(this.opts.url)
		this.ws = ws

		// Watchdog: if the Gemini session never confirms open (network/Vertex Live
		// degraded), surface a clear error instead of silently doing nothing.
		if (this.openTimer) clearTimeout(this.openTimer)
		this.openTimer = setTimeout(() => {
			if (this.status !== 'connected') {
				this.opts.onError?.(
					'Sprachverbindung zu Google kam nicht zustande (Netzwerk/VPN). Bitte erneut versuchen.'
				)
				this.setStatus('error')
				this.manualClose = true
				this.ws?.close()
			}
		}, 55_000)

		ws.onopen = () => {
			const setup: VoiceSetup = {
				type: 'setup',
				instructions: this.opts.instructions,
				tools: this.opts.tools,
				voice: this.opts.voice,
				languageCode: this.opts.languageCode
			}
			ws.send(JSON.stringify(setup))
		}
		ws.onmessage = (ev) => {
			const msg = JSON.parse(ev.data) as ServerMessage
			this.opts.onServerMessage?.(msg)
			void this.handleServerMessage(msg)
		}
		ws.onerror = () => {
			this.opts.onError?.('Voice-Relay nicht erreichbar')
			this.setStatus('error')
		}
		ws.onclose = () => {
			if (this.status !== 'error') this.setStatus('disconnected')
			if (this.active && !this.manualClose) {
				this.reconnectTimer = setTimeout(() => this.connect(), 2000)
			}
		}
	}

	private async handleServerMessage(msg: ServerMessage): Promise<void> {
		switch (msg.type) {
			case 'open':
				if (this.openTimer) { clearTimeout(this.openTimer); this.openTimer = null }
				this.setStatus('connected')
				if (this.active) void this.startCapture()
				break
			case 'audio': {
				if (!this.playbackCtx) {
					const ctx = new AudioContext({ sampleRate: PLAYBACK_SAMPLE_RATE })
					await ctx.audioWorklet.addModule(workletUrl(PLAYBACK_WORKLET))
					const node = new AudioWorkletNode(ctx, 'aven-voice-playback')
					node.connect(ctx.destination)
					this.playbackCtx = ctx
					this.playbackNode = node
				}
				this.playbackNode?.port.postMessage(b64ToArrayBuffer(msg.data))
				break
			}
			case 'interrupted':
				this.playbackNode?.port.postMessage('clear')
				this.assistantTurnDone = true
				break
			case 'turnComplete':
				this.assistantTurnDone = true
				break
			case 'transcript': {
				const last = this.transcript[this.transcript.length - 1]
				const startNew = msg.role === 'assistant' && this.assistantTurnDone
				if (msg.role === 'assistant') this.assistantTurnDone = false
				if (last?.role === msg.role && !startNew) {
					last.text += msg.text
					this.opts.onTranscript?.(last, true)
				} else {
					const line: TranscriptLine = { role: msg.role, text: msg.text }
					this.transcript = [...this.transcript.slice(-19), line]
					this.opts.onTranscript?.(line, false)
				}
				break
			}
			case 'toolCall': {
				const responses = await Promise.all(
					msg.calls.map(async (c) => {
						const byId = this.toolResults.get(c.id)
						if (byId !== undefined) return { id: c.id, name: c.name, response: byId }
						const argsKey = c.name + JSON.stringify(c.args ?? {})
						const recent = this.recentByArgs.get(argsKey)
						const response =
							recent && Date.now() - recent.ts < 10_000
								? recent.response
								: await this.opts.executeTool(c.name, c.args)
						this.toolResults.set(c.id, response)
						this.recentByArgs.set(argsKey, { response, ts: Date.now() })
						return { id: c.id, name: c.name, response }
					})
				)
				this.ws?.send(JSON.stringify({ type: 'toolResponse', responses }))
				break
			}
			case 'error':
				this.opts.onError?.(msg.message)
				this.setStatus('error')
				break
		}
	}

	private async startCapture(): Promise<void> {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
		await this.playbackCtx?.resume().catch(() => {})
		const stream = await navigator.mediaDevices.getUserMedia({
			audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
		})
		this.micStream = stream
		const ctx = new AudioContext({ sampleRate: CAPTURE_SAMPLE_RATE })
		await ctx.audioWorklet.addModule(workletUrl(CAPTURE_WORKLET))
		const source = ctx.createMediaStreamSource(stream)
		const node = new AudioWorkletNode(ctx, 'aven-voice-capture')
		node.port.onmessage = (e) => {
			this.ws?.send(JSON.stringify({ type: 'audio', data: arrayBufferToB64(e.data) }))
		}
		source.connect(node)
		this.captureCtx = ctx
	}

	private teardownAudio(): void {
		this.micStream?.getTracks().forEach((t) => t.stop())
		this.micStream = null
		void this.captureCtx?.close()
		this.captureCtx = null
		void this.playbackCtx?.close()
		this.playbackCtx = null
		this.playbackNode = null
	}
}

function b64ToArrayBuffer(b64: string): ArrayBuffer {
	const bin = atob(b64)
	const bytes = new Uint8Array(bin.length)
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
	return bytes.buffer
}

function arrayBufferToB64(buf: ArrayBuffer): string {
	const bytes = new Uint8Array(buf)
	let bin = ''
	for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
	return btoa(bin)
}
