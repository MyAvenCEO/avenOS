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
// Resilience: an ORDERED list of regions to try. The first is the residency
// preference (EU); the rest are fallbacks for when a region's Live service
// flakes (documented europe-west1 native-audio instability). Override via
// GOOGLE_CLOUD_LOCATIONS (comma-separated) or the single GOOGLE_CLOUD_LOCATION.
const LOCATIONS = (
	process.env.GOOGLE_CLOUD_LOCATIONS ??
	`${process.env.GOOGLE_CLOUD_LOCATION ?? 'europe-west1'},us-central1`
)
	.split(',')
	.map((s) => s.trim())
	.filter(Boolean)
const VERTEX = Boolean(PROJECT)
const MODEL =
	process.env.GEMINI_LIVE_MODEL ??
	(VERTEX ? 'gemini-live-2.5-flash-native-audio' : 'gemini-3.1-flash-live-preview')

const CONNECT_TIMEOUT_MS = Number(process.env.VOICE_CONNECT_TIMEOUT_MS ?? 10_000)
const MAX_ATTEMPTS = Number(process.env.VOICE_CONNECT_ATTEMPTS ?? 4)

const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON

function makeClient(location: string): GoogleGenAI {
	if (VERTEX) {
		return new GoogleGenAI({
			vertexai: true,
			project: PROJECT,
			location,
			// scopes are REQUIRED with explicit SA credentials: without them the
			// token exchange never completes and live.connect hangs silently
			// (ADC carries scopes implicitly, an SA key does not).
			...(saJson
				? {
						googleAuthOptions: {
							credentials: JSON.parse(saJson),
							scopes: ['https://www.googleapis.com/auth/cloud-platform']
						}
					}
				: {})
		})
	}
	const apiKey = process.env.GOOGLE_AI_API_KEY ?? process.env.GEMINI_API_KEY
	return new GoogleGenAI({ apiKey })
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Server-side tool surface: executed in-process (credentials/caps stay server-side). */
export type VoiceServerTools = {
	declarations: import('../protocol').VoiceToolDeclaration[]
	/** Appended to the surface's system instructions (e.g. live schema hints). */
	instructionsSuffix?: string
	execute: (
		name: string,
		args: unknown
	) => Promise<{
		content: unknown
		hitl?: { label: string; action: unknown }
		detail?: string
		vibes?: { schema: string; data?: unknown }[]
	}>
}

export type VoiceBridgeOptions = {
	serverTools?: VoiceServerTools
}

export type VoiceBridge = {
	/** Feed raw text frames from the browser socket here. */
	handleMessage: (raw: string) => void
	/** Call when the browser socket closes. */
	close: () => void
}

/** Human-readable config summary for boot logs. */
export function describeVoiceBackend(): string {
	return `${MODEL} [${VERTEX ? `vertex:${LOCATIONS.join('→')}` : 'developer-api'}]`
}

/**
 * Open a bridge for one client connection. The Gemini session is created
 * lazily on the client's 'setup' message so each surface picks its own
 * instructions/tools/voice.
 */
export function createVoiceBridge(
	send: (msg: ServerMessage) => void,
	opts: VoiceBridgeOptions = {}
): VoiceBridge {
	let session: Session | undefined
	let closed = false
	const serverToolNames = new Set(opts.serverTools?.declarations.map((d) => d.name) ?? [])
	// Vertex re-emits tool calls (sometimes with fresh ids) — answer repeats from
	// cache instead of executing twice (a duplicate `create` would double data).
	const doneById = new Map<string, unknown>()
	const recentByArgs = new Map<string, { out: unknown; ts: number }>()

	// Resilient connect: try each region, per-attempt timeout, backoff between
	// attempts. Resolves once Vertex confirms the WS is open; rejects if an
	// attempt times out / errors so the loop can fall back to the next region.
	function connectOnce(setup: VoiceSetup, location: string): Promise<Session> {
		const voice =
			setup.voice && (VOICE_ALLOWLIST as readonly string[]).includes(setup.voice)
				? setup.voice
				: DEFAULT_VOICE
		const ai = makeClient(location)
		const systemInstruction = opts.serverTools?.instructionsSuffix
			? `${setup.instructions}\n\n${opts.serverTools.instructionsSuffix}`
			: setup.instructions
		return new Promise<Session>((resolve, reject) => {
			// settled = the connect RACE has a winner (open/timeout/error). Only the
			// timeout path discards a late session. `open` no longer flips settled —
			// that was the self-close bug (settled+no-session → .then closed it).
			let settled = false
			let timedOut = false
			let opened = false
			const timer = setTimeout(() => {
				if (!settled) {
					settled = true
					timedOut = true
					reject(new Error(`connect timeout (${location})`))
				}
			}, CONNECT_TIMEOUT_MS)
			ai.live
				.connect({
					model: MODEL,
					config: {
						responseModalities: [Modality.AUDIO],
						systemInstruction,
						speechConfig: {
							voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
							languageCode: setup.languageCode ?? DEFAULT_LANGUAGE
						},
						inputAudioTranscription: {},
						outputAudioTranscription: {},
						...((() => {
							const all = [...(opts.serverTools?.declarations ?? []), ...setup.tools]
							return all.length ? { tools: [{ functionDeclarations: all }] } : {}
						})())
					},
					callbacks: {
						onopen: () => {
							opened = true
							if (!timedOut) send({ type: 'open' })
						},
						onmessage: (m: LiveServerMessage) => onLiveMessage(m),
						onerror: (e: ErrorEvent) => {
							if (!settled) {
								settled = true
								clearTimeout(timer)
								reject(new Error(e.message || 'live error'))
							} else if (!timedOut && !closed) {
								send({ type: 'error', message: e.message })
							}
						},
						onclose: (e: CloseEvent) => {
							if (!settled) {
								settled = true
								clearTimeout(timer)
								reject(new Error(`closed before open: ${e.reason || e.code}`))
							} else if (!timedOut && !closed) {
								send({ type: 'error', message: `Live-Session geschlossen: ${e.reason || e.code}` })
							}
						}
					}
				})
				.then((s) => {
					if (timedOut) {
						// A later attempt owns the client now — discard this stale session.
						void s.close?.()
						return
					}
					settled = true
					clearTimeout(timer)
					session = s
					if (!opened) send({ type: 'open' })
					resolve(s)
				})
				.catch((err) => {
					if (!settled) {
						settled = true
						clearTimeout(timer)
						reject(err instanceof Error ? err : new Error(String(err)))
					}
				})
		})
	}

	async function startSession(setup: VoiceSetup): Promise<void> {
		let lastErr = ''
		for (let attempt = 0; attempt < MAX_ATTEMPTS && !closed; attempt++) {
			const location = VERTEX ? LOCATIONS[attempt % LOCATIONS.length] : 'developer-api'
			send({ type: 'status', phase: 'connecting', attempt: attempt + 1, total: MAX_ATTEMPTS, region: location })
			const t0 = Date.now()
			console.log(`[voice] connect attempt ${attempt + 1}/${MAX_ATTEMPTS} → ${MODEL} @ ${location}`)
			try {
				await connectOnce(setup, location)
				console.log(`[voice] connected @ ${location} in ${Date.now() - t0}ms`)
				return // success — session is live, callbacks stream via onLiveMessage
			} catch (e) {
				lastErr = e instanceof Error ? e.message : String(e)
				console.error(
					`[voice] attempt ${attempt + 1} FAILED @ ${location} after ${Date.now() - t0}ms: ${lastErr}`
				)
				session = undefined
				if (attempt < MAX_ATTEMPTS - 1) await sleep(Math.min(500 * 2 ** attempt, 4000))
			}
		}
		if (!closed) {
			// Distinguish the diagnosed condition: the WS to *.googleapis.com never
			// opens (connect timeout) while normal HTTPS works — typically a mobile
			// carrier proxying/optimising Google traffic and breaking WS upgrades.
			const wsBlocked = /timeout|closed before open/i.test(lastErr)
			send({
				type: 'error',
				message: wsBlocked
					? `Der Echtzeit-Audio-Stream zu Google wird von diesem Netz blockiert (nach ${MAX_ATTEMPTS} Versuchen, ${LOCATIONS.join('/')}). Normales Internet läuft, aber WebSockets zu Google kommen nicht durch — häufig bei Mobilfunk-Hotspots (Carrier-Proxy). Über WLAN erneut versuchen.`
					: `Sprachverbindung fehlgeschlagen (${lastErr}).`
			})
		}
	}

	// Shared live-message handler (used once a session is open).
	function onLiveMessage(m: LiveServerMessage): void {
		{
			{
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
						const calls = m.toolCall.functionCalls.map((c) => ({
							id: c.id ?? '',
							name: c.name ?? '',
							args: c.args
						}))
						const clientCalls = calls.filter((c) => !serverToolNames.has(c.name))
						const serverCalls = calls.filter((c) => serverToolNames.has(c.name))
						if (clientCalls.length) send({ type: 'toolCall', calls: clientCalls })
						for (const c of serverCalls) {
							const argsKey = c.name + JSON.stringify(c.args ?? {})
							const cachedById = c.id ? doneById.get(c.id) : undefined
							const cachedByArgs = recentByArgs.get(argsKey)
							const cached =
								cachedById ??
								(cachedByArgs && Date.now() - cachedByArgs.ts < 10_000
									? cachedByArgs.out
									: undefined)
							if (cached !== undefined) {
								session?.sendToolResponse({
									functionResponses: [
										{ ...(c.id ? { id: c.id } : {}), name: c.name, response: { output: cached } }
									]
								})
								continue
							}
							send({ type: 'toolEvent', id: c.id, name: c.name, args: c.args, status: 'running' })
							void opts.serverTools!
								.execute(c.name, c.args)
								.then((out) => {
									if (c.id) doneById.set(c.id, out.content)
									recentByArgs.set(argsKey, { out: out.content, ts: Date.now() })
									if (out.hitl) {
										send({ type: 'hitl', id: c.id, tool: c.name, label: out.hitl.label, action: out.hitl.action })
									}
									send({
										type: 'toolEvent',
										id: c.id,
										name: c.name,
										args: c.args,
										status: 'done',
										detail: out.detail,
										vibes: out.vibes
									})
									session?.sendToolResponse({
										functionResponses: [
											{ ...(c.id ? { id: c.id } : {}), name: c.name, response: { output: out.content } }
										]
									})
								})
								.catch((err) => {
									const message = err instanceof Error ? err.message : 'tool failed'
									send({ type: 'toolEvent', id: c.id, name: c.name, args: c.args, status: 'error', detail: message })
									session?.sendToolResponse({
										functionResponses: [
											{
												...(c.id ? { id: c.id } : {}),
												name: c.name,
												response: { output: { ok: false, error: message } }
											}
										]
									})
								})
						}
				}
			}
		}
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
						...(r.id ? { id: r.id } : {}),
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
