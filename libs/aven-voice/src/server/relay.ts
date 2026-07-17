// Server-side bridge: one browser WebSocket ⇄ one Gemini Live session.
// Transport-agnostic — the host (betterauth Hono/Bun server) owns the socket
// and hands us a `send` function; we hand back message/close handlers.
//
// Credentials never leave the server. Auth modes, in priority order:
//   1. GOOGLE_CLOUD_PROJECT (+ GOOGLE_CLOUD_LOCATION, default europe-west1)
//      → Gemini Enterprise (Vertex) via ADC, or GOOGLE_SERVICE_ACCOUNT_JSON.
//   2. GOOGLE_AI_API_KEY / GEMINI_API_KEY → Gemini Developer API fallback.

import {
	GoogleGenAI,
	Modality,
	type LiveServerMessage,
	type Session
} from '@google/genai'
import {
	DEFAULT_LANGUAGE,
	DEFAULT_VOICE,
	VOICE_ALLOWLIST,
	type ClientMessage,
	type ServerMessage,
	type VoiceSetup
} from '../protocol'

const PROJECT = process.env.GOOGLE_CLOUD_PROJECT
const LOCATION = process.env.GOOGLE_CLOUD_LOCATION ?? 'europe-west1'
const VERTEX = Boolean(PROJECT)
const MODEL =
	process.env.GEMINI_LIVE_MODEL ??
	(VERTEX ? 'gemini-live-2.5-flash-native-audio' : 'gemini-3.1-flash-live-preview')

const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON

function makeClient(): GoogleGenAI {
	if (VERTEX) {
		return new GoogleGenAI({
			vertexai: true,
			project: PROJECT,
			location: LOCATION,
			...(saJson ? { googleAuthOptions: { credentials: JSON.parse(saJson) } } : {})
		})
	}
	const apiKey = process.env.GOOGLE_AI_API_KEY ?? process.env.GEMINI_API_KEY
	return new GoogleGenAI({ apiKey })
}

export type VoiceBridge = {
	/** Feed raw text frames from the browser socket here. */
	handleMessage: (raw: string) => void
	/** Call when the browser socket closes. */
	close: () => void
}

/** Human-readable config summary for boot logs. */
export function describeVoiceBackend(): string {
	return `${MODEL} [${VERTEX ? `vertex:${LOCATION}` : 'developer-api'}]`
}

/**
 * Open a bridge for one client connection. The Gemini session is created
 * lazily on the client's 'setup' message so each surface picks its own
 * instructions/tools/voice.
 */
export function createVoiceBridge(send: (msg: ServerMessage) => void): VoiceBridge {
	let session: Session | undefined
	let closed = false

	async function startSession(setup: VoiceSetup): Promise<void> {
		const voice =
			setup.voice && (VOICE_ALLOWLIST as readonly string[]).includes(setup.voice)
				? setup.voice
				: DEFAULT_VOICE
		const ai = makeClient()
		session = await ai.live.connect({
			model: MODEL,
			config: {
				responseModalities: [Modality.AUDIO],
				systemInstruction: setup.instructions,
				speechConfig: {
					voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
					languageCode: setup.languageCode ?? DEFAULT_LANGUAGE
				},
				inputAudioTranscription: {},
				outputAudioTranscription: {},
				...(setup.tools.length ? { tools: [{ functionDeclarations: setup.tools }] } : {})
			},
			callbacks: {
				onopen: () => send({ type: 'open' }),
				onmessage: (m: LiveServerMessage) => {
					// Forward EVERY audio part — the final flush of a turn bundles
					// several parts in one message; dropping any clips the last word.
					for (const part of m.serverContent?.modelTurn?.parts ?? []) {
						if (part.inlineData?.data) send({ type: 'audio', data: part.inlineData.data })
					}
					if (m.serverContent?.interrupted) send({ type: 'interrupted' })
					if (m.serverContent?.turnComplete) send({ type: 'turnComplete' })
					const inT = m.serverContent?.inputTranscription?.text
					if (inT) send({ type: 'transcript', role: 'user', text: inT })
					const outT = m.serverContent?.outputTranscription?.text
					if (outT) send({ type: 'transcript', role: 'assistant', text: outT })
					if (m.toolCall?.functionCalls?.length) {
						send({
							type: 'toolCall',
							calls: m.toolCall.functionCalls.map((c) => ({
								id: c.id ?? '',
								name: c.name ?? '',
								args: c.args
							}))
						})
					}
				},
				onerror: (e: ErrorEvent) => send({ type: 'error', message: e.message }),
				onclose: (e: CloseEvent) => {
					if (!closed) send({ type: 'error', message: `Live-Session geschlossen: ${e.reason || e.code}` })
				}
			}
		})
	}

	return {
		handleMessage(raw: string) {
			let msg: ClientMessage
			try {
				msg = JSON.parse(raw) as ClientMessage
			} catch {
				return
			}
			if (msg.type === 'setup') {
				void startSession(msg).catch((err) =>
					send({
						type: 'error',
						message: err instanceof Error ? err.message : 'Live-Verbindung fehlgeschlagen'
					})
				)
				return
			}
			if (!session) return
			if (msg.type === 'audio' && typeof msg.data === 'string') {
				session.sendRealtimeInput({ audio: { data: msg.data, mimeType: 'audio/pcm;rate=16000' } })
			} else if (msg.type === 'toolResponse' && Array.isArray(msg.responses)) {
				session.sendToolResponse({
					functionResponses: msg.responses.map((r) => ({
						id: r.id,
						name: r.name,
						response: { output: r.response }
					}))
				})
			}
		},
		close() {
			closed = true
			session?.close()
			session = undefined
		}
	}
}
