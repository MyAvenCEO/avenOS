import type { Context } from 'hono'

/**
 * Session-gated proxy broker for the REALTIME LIVE VOICE mode (board 0120): the three
 * remote stages all run inside the Tinfoil enclave —
 *   STT  : `voxtral-mini-4b-realtime` over the `/v1/realtime` WebSocket
 *   LLM  : `gpt-oss-120b` (fastest TTFT) over `/v1/chat/completions` (reuses {@link aiChat})
 *   TTS  : `voxtral-tts` over `/v1/audio/speech` ({@link aiVoiceSpeech})
 *
 * Like the chat proxy ({@link ./ai.ts}) the `TINFOIL_API_KEY` never leaves the server and
 * every route requires a valid Better Auth session. This module owns the TTS broker and the
 * realtime STT session config the client needs to open its stream; the LLM turn reuses the
 * existing `/api/ai/chat` streaming path.
 *
 * The pure helpers (`resolveVoiceModels`, `voiceAuthError`, `buildSpeechRequest`) hold the
 * testable logic and import NOTHING — the handlers lazy-import `auth`/`credits` so a unit test
 * of the helpers never drags in the DB/auth graph (which throws on missing env at import).
 */
const TINFOIL_BASE_URL = process.env.TINFOIL_BASE_URL ?? 'https://inference.tinfoil.sh/v1'

/** Default Tinfoil model ids for the realtime voice pipeline (board 0120 research). */
export const DEFAULT_STT_MODEL = 'voxtral-mini-4b-realtime'
export const DEFAULT_LLM_MODEL = 'gpt-oss-120b'
export const DEFAULT_TTS_MODEL = 'voxtral-tts'
/** Tinfoil `/v1/realtime` passes 16 kHz PCM through (our capture rate); it resamples otherwise. */
export const REALTIME_SAMPLE_RATE = 16_000
/** Voxtral realtime decode delay — 480 ms is the accuracy/latency sweet spot (floor < 200 ms). */
export const REALTIME_DELAY_MS = 480

export type VoiceModels = { stt: string; llm: string; tts: string }

/**
 * Resolve the three stage model ids from the environment, falling back to the board-0120
 * defaults. Empty/whitespace overrides are ignored so a blank env var can't select "".
 */
export function resolveVoiceModels(
	env: Record<string, string | undefined> = process.env
): VoiceModels {
	const pick = (v: string | undefined, fallback: string) => {
		const t = v?.trim()
		return t ? t : fallback
	}
	return {
		stt: pick(env.TINFOIL_REALTIME_STT_MODEL, DEFAULT_STT_MODEL),
		llm: pick(env.TINFOIL_LLM_MODEL, DEFAULT_LLM_MODEL),
		tts: pick(env.TINFOIL_TTS_MODEL, DEFAULT_TTS_MODEL)
	}
}

/**
 * The 401 decision, factored out of the handlers so session gating is unit-testable without a
 * DB. Returns the error to send when there's no session, or `null` to proceed.
 */
export function voiceAuthError(session: unknown): { status: 401; error: string } | null {
	return session ? null : { status: 401, error: 'unauthorized' }
}

/** The OpenAI-style `/v1/audio/speech` request body. */
export type SpeechRequest = {
	model: string
	input: string
	voice: string
	response_format: string
}

/**
 * Build the `/v1/audio/speech` body; throws on empty text so the handler can 400 rather than
 * bill an empty synthesis. Defaults: `voice: 'default'`, `response_format: 'pcm'` (raw PCM so
 * the webview can play it through Web Audio like the on-device TTS path).
 */
export function buildSpeechRequest(opts: {
	text: string
	model: string
	voice?: string
	format?: string
}): SpeechRequest {
	const text = opts.text?.trim() ?? ''
	if (!text) throw new Error('text required')
	return {
		model: opts.model,
		input: text,
		voice: opts.voice?.trim() || 'default',
		response_format: opts.format?.trim() || 'pcm'
	}
}

/**
 * `POST /api/ai/voice/speech` — session-gated TTS: forwards `{ text, voice?, format?, model? }`
 * to Tinfoil `/v1/audio/speech` (default model `voxtral-tts`) and streams the audio bytes back.
 */
export async function aiVoiceSpeech(c: Context): Promise<Response> {
	const { auth } = await import('./auth')
	const { creditStatus } = await import('./credits')
	const session = await auth.api.getSession({ headers: c.req.raw.headers })
	if (!session) return c.json({ error: 'unauthorized' }, 401)

	const key = process.env.TINFOIL_API_KEY
	if (!key) return c.json({ error: 'TINFOIL_API_KEY not configured' }, 503)

	const body = (await c.req.json().catch(() => null)) as {
		text?: string
		voice?: string
		format?: string
		model?: string
	} | null
	const models = resolveVoiceModels()
	let payload: SpeechRequest
	try {
		payload = buildSpeechRequest({
			text: body?.text ?? '',
			model: body?.model ?? models.tts,
			voice: body?.voice,
			format: body?.format
		})
	} catch {
		return c.json({ error: 'text required' }, 400)
	}

	// Hard credit cap, same gate as chat (board 0052): block synthesis once the allowance is spent.
	const credit = await creditStatus(session.user.id)
	if (credit.remainingUsd <= 0) {
		return c.json(
			{
				error: 'out_of_credits',
				tier: credit.tier,
				allowanceUsd: credit.allowanceUsd,
				spentUsd: credit.spentUsd
			},
			402
		)
	}

	const upstream = await fetch(`${TINFOIL_BASE_URL}/audio/speech`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
		body: JSON.stringify(payload)
	}).catch((e) => {
		throw new Error(`tinfoil speech fetch failed: ${e instanceof Error ? e.message : String(e)}`)
	})
	if (!upstream.ok || !upstream.body) {
		const detail = await upstream.text().catch(() => '')
		return c.json({ error: `tinfoil_error_${upstream.status}`, detail: detail.slice(0, 500) }, 502)
	}
	return new Response(upstream.body, {
		status: 200,
		headers: {
			'Content-Type': upstream.headers.get('Content-Type') ?? 'audio/pcm',
			'Cache-Control': 'no-store'
		}
	})
}

/**
 * `GET /api/ai/voice/realtime` — session-gated config the client needs to open its realtime STT
 * session: the resolved stage model ids, the PCM sample rate, the decode delay, and the
 * `intent=transcription` flag (which selects Tinfoil's OpenAI-Realtime-compatible layer). The
 * live WebSocket relay itself is wired at runtime; this hands the client its parameters.
 */
export async function aiVoiceRealtimeConfig(c: Context): Promise<Response> {
	const { auth } = await import('./auth')
	const session = await auth.api.getSession({ headers: c.req.raw.headers })
	if (!session) return c.json({ error: 'unauthorized' }, 401)
	const models = resolveVoiceModels()
	return c.json({
		sttModel: models.stt,
		llmModel: models.llm,
		ttsModel: models.tts,
		sampleRate: REALTIME_SAMPLE_RATE,
		delayMs: REALTIME_DELAY_MS,
		intent: 'transcription'
	})
}

// ───────────────────────── server-side voice orchestration ─────────────────────────
//
// Lowest-latency topology (board 0120): the client streams mic audio over ONE duplex WebSocket and
// the SERVER runs the whole STT→LLM→TTS turn against the colocated Tinfoil enclaves, so the
// intermediate transcript + reply text never round-trip back to the phone. Everything below is the
// server orchestrator that the `/api/ai/voice/realtime/ws` route drives.

/** Default upstream STT WebSocket (OpenAI-Realtime-compatible) on the Tinfoil enclave. */
const TINFOIL_REALTIME_WS =
	process.env.TINFOIL_REALTIME_WS_URL ?? 'wss://inference.tinfoil.sh/v1/realtime'
/** Sample rate of the TTS PCM we forward down to the client (voxtral-tts default). */
export const TTS_SAMPLE_RATE = 24_000

/** Build the upstream STT WebSocket URL — `?intent=transcription` selects Tinfoil's OpenAI-Realtime
 *  translation layer; `model` pins the realtime STT model. */
export function realtimeUpstreamUrl(
	models: VoiceModels = resolveVoiceModels(),
	base: string = TINFOIL_REALTIME_WS
): string {
	const u = new URL(base)
	u.searchParams.set('intent', 'transcription')
	u.searchParams.set('model', models.stt)
	return u.toString()
}

/** Validate the bearer passed as the ws `?token=` (browsers can't set WebSocket headers). */
export async function sessionFromBearer(token: string | null | undefined): Promise<unknown> {
	if (!token) return null
	const { auth } = await import('./auth')
	return auth.api.getSession({ headers: new Headers({ Authorization: `Bearer ${token}` }) })
}

/**
 * Parse one upstream STT event (OpenAI-Realtime-compatible) into a transcript delta or final.
 * Tolerant of the exact event id: `…transcription.delta` (partial), `…transcription.completed` /
 * `…done` (final), reading `delta` or `transcript`.
 */
export function parseTranscriptEvent(raw: unknown): { delta?: string; final?: string } {
	if (typeof raw !== 'string') return {}
	let msg: Record<string, unknown>
	try {
		msg = JSON.parse(raw) as Record<string, unknown>
	} catch {
		return {}
	}
	const type = String(msg.type ?? '')
	const text =
		typeof msg.delta === 'string'
			? msg.delta
			: typeof msg.transcript === 'string'
				? msg.transcript
				: ''
	if (type.endsWith('.delta')) return { delta: text }
	if (type.endsWith('.completed') || type.endsWith('.done')) return { final: text }
	return {}
}

/**
 * Incrementally split a growing reply buffer into COMPLETE sentences for sentence-chunked TTS:
 * returns each sentence terminated by `.`/`!`/`?` (plus a trailing closing quote/bracket) and the
 * `rest` to keep buffering — so the first sentence starts synthesizing while the LLM is still
 * generating the next.
 */
export function chunkSentences(buffer: string): { sentences: string[]; rest: string } {
	const sentences: string[] = []
	const re = /[^.!?]*[.!?]+["')\]]*\s*/g
	let lastIndex = 0
	for (let m = re.exec(buffer); m !== null; m = re.exec(buffer)) {
		const s = m[0].trim()
		if (s) sentences.push(s)
		lastIndex = re.lastIndex
	}
	return { sentences, rest: buffer.slice(lastIndex) }
}

/** Minimal WebSocket surface (the upstream STT socket), kept abstract so the orchestrator is
 *  testable with a fake socket. */
export type WebSocketLike = {
	readyState: number
	send(data: ArrayBufferLike | ArrayBufferView | string): void
	close(code?: number, reason?: string): void
}

/** Downstream sink the orchestrator writes to (adapted to the hono/Bun ws in `server.ts`). */
export type VoiceDownstream = {
	/** Send a JSON control/text event (caption, reply, reply_done, audio_info, turn_done, error). */
	sendEvent(ev: Record<string, unknown>): void
	/** Send a binary TTS audio frame. */
	sendAudio(bytes: ArrayBuffer): void
}

/** The orchestrator surface the route wires the two sockets into. */
export type VoiceOrchestrator = {
	/** A frame from the client: binary = mic PCM16 (→ STT upstream); string = `{t:'commit'|'cancel'}`. */
	onClientFrame(data: string | ArrayBuffer): void
	/** The STT upstream opened. */
	onUpstreamOpen(): void
	/** A frame from the STT upstream (transcript deltas/finals). */
	onUpstreamFrame(data: unknown): void
	/** Tear down. */
	close(): void
}

/**
 * Create the STT→LLM→TTS orchestrator for one connection. `upstream` is the (already-created) STT
 * WebSocket to Tinfoil; `down` writes to the client. On the client's `commit`, the accumulated
 * transcript drives a streaming LLM turn whose reply is sentence-chunked into TTS and streamed back
 * as audio.
 *
 * The LLM stage runs through the server's own `chatEndpoint` (`/api/ai/chat`) with the caller's
 * bearer `token` when both are given — so the voice turn reuses the FULL chat tool loop (skill
 * routing, `data_crud`/todos, persistence): "add a todo to buy milk" actually writes the todo, and
 * the spoken reply confirms it. Without them it falls back to a plain `/chat/completions` (chat, no
 * tools). `fetchImpl` is injectable for tests; the live loop is HITL-verified (needs the enclave).
 */
export function createVoiceOrchestrator(deps: {
	down: VoiceDownstream
	upstream: WebSocketLike
	apiKey: string
	baseUrl?: string
	models?: VoiceModels
	fetchImpl?: typeof fetch
	/** Internal `/api/ai/chat` URL — routes the LLM turn through the full tool loop (todos/skills). */
	chatEndpoint?: string
	/** Better Auth bearer for the internal chat call (the ws `?token=`). */
	token?: string
}): VoiceOrchestrator {
	const base = deps.baseUrl ?? process.env.TINFOIL_BASE_URL ?? 'https://inference.tinfoil.sh/v1'
	const models = deps.models ?? resolveVoiceModels()
	const f = deps.fetchImpl ?? fetch
	let caption = ''
	let upstreamOpen = false
	let pendingCommit = false
	const upstreamQueue: ArrayBuffer[] = []
	let turnRunning = false

	const COMMIT = JSON.stringify({ type: 'input_audio_buffer.commit' })
	// TEMP diagnostic breadcrumbs → surfaced on the client's -next debug line so we can SEE the
	// pipeline (STT handshake, transcript, LLM). Remove once the roundtrip is confirmed.
	const dbg = (text: string) => deps.down.sendEvent({ t: 'status', text })
	// Tinfoil's /v1/realtime (OpenAI-Realtime-compatible via ?intent=transcription) takes audio as
	// `input_audio_buffer.append` events with base64 PCM16 — NOT raw binary frames. Wrap each chunk.
	const sendAudioUpstream = (buf: ArrayBuffer) => {
		const audio = Buffer.from(buf).toString('base64')
		deps.upstream.send(JSON.stringify({ type: 'input_audio_buffer.append', audio }))
	}
	const flushUpstream = () => {
		for (const b of upstreamQueue.splice(0)) sendAudioUpstream(b)
		if (pendingCommit) {
			pendingCommit = false
			deps.upstream.send(COMMIT)
		}
	}
	// Watchdog: if a commit yields no transcript in time, don't hang in "thinking" forever — run the
	// turn on whatever caption we have, or recover with turn_done.
	let watchdog: ReturnType<typeof setTimeout> | null = null
	const clearWatchdog = () => {
		if (watchdog) {
			clearTimeout(watchdog)
			watchdog = null
		}
	}
	const startWatchdog = () => {
		clearWatchdog()
		watchdog = setTimeout(() => {
			if (turnRunning) return
			dbg('[watchdog] no transcript after commit')
			if (caption.trim()) {
				const t = caption
				caption = ''
				void runTurn(t)
			} else {
				deps.down.sendEvent({ t: 'turn_done' })
			}
		}, 12_000)
	}
	const close = () => {
		clearWatchdog()
		try {
			deps.upstream.close()
		} catch {
			/* already closing */
		}
	}

	async function synthesize(sentence: string, first: boolean): Promise<void> {
		const res = await f(`${base}/audio/speech`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${deps.apiKey}`, 'Content-Type': 'application/json' },
			body: JSON.stringify(buildSpeechRequest({ text: sentence, model: models.tts }))
		})
		if (!res.ok) {
			const detail = await res.text().catch(() => '')
			dbg(`[tts FAIL http ${res.status} ${detail.slice(0, 100)}]`)
			return
		}
		const bytes = await res.arrayBuffer()
		dbg(`[tts ok ${res.headers.get('content-type') ?? '?'} ${bytes.byteLength}b]`)
		if (first) deps.down.sendEvent({ t: 'audio_info', sampleRate: TTS_SAMPLE_RATE })
		deps.down.sendAudio(bytes)
	}

	async function runTurn(transcript: string): Promise<void> {
		if (turnRunning || !transcript.trim()) return
		turnRunning = true
		dbg(`[llm start] "${transcript.slice(0, 60)}"`)
		try {
			// Prefer the internal chat pipeline (tools/todos/skills) when we have the endpoint + bearer;
			// else a plain completion. Both emit OpenAI-style SSE with `choices[].delta.content`.
			const useChat = !!deps.chatEndpoint && !!deps.token
			const url = useChat ? (deps.chatEndpoint as string) : `${base}/chat/completions`
			const headers: Record<string, string> = { 'Content-Type': 'application/json' }
			headers.Authorization = `Bearer ${useChat ? (deps.token as string) : deps.apiKey}`
			const res = await f(url, {
				method: 'POST',
				headers,
				body: JSON.stringify({
					model: models.llm,
					messages: [{ role: 'user', content: transcript }],
					stream: true
				})
			})
			if (!res.ok || !res.body) {
				dbg(`[llm http ${res.status}]`)
				deps.down.sendEvent({ t: 'error', message: `llm ${res.status}` })
				return
			}
			dbg(useChat ? '[llm streaming via chat+tools]' : '[llm streaming via completions]')
			const reader = res.body.getReader()
			const decoder = new TextDecoder()
			let sse = ''
			let reply = ''
			let pending = ''
			let firstAudio = true
			for (;;) {
				const { done, value } = await reader.read()
				if (done) break
				sse += decoder.decode(value, { stream: true })
				const events = sse.split('\n\n')
				sse = events.pop() ?? ''
				for (const ev of events) {
					const line = ev.split('\n').find((l) => l.startsWith('data:'))
					if (!line) continue
					const payload = line.slice(5).trim()
					if (payload === '[DONE]') continue
					let json: {
						choices?: { delta?: { content?: string } }[]
						aven_vibe?: { schema?: string; data?: unknown }
						aven_tool?: { name?: string; status?: string }
					}
					try {
						json = JSON.parse(payload)
					} catch {
						continue
					}
					// Forward tool activity + result cards so the voice turn shows them like the typed
					// chat does (todos, mutation-result, …) — tools run server-side either way.
					if (json.aven_tool) {
						dbg(`[tool ${json.aven_tool.name ?? '?'} ${json.aven_tool.status ?? ''}]`)
					}
					if (json.aven_vibe) {
						dbg(`[vibe ${json.aven_vibe.schema ?? '?'}]`)
						deps.down.sendEvent({
							t: 'vibe',
							schema: json.aven_vibe.schema ?? '',
							data: json.aven_vibe.data
						})
					}
					const delta = json.choices?.[0]?.delta?.content
					if (!delta) continue
					reply += delta
					pending += delta
					deps.down.sendEvent({ t: 'reply', text: delta })
					const { sentences, rest } = chunkSentences(pending)
					pending = rest
					for (const s of sentences) {
						await synthesize(s, firstAudio)
						firstAudio = false
					}
				}
			}
			const tail = pending.trim()
			if (tail) await synthesize(tail, firstAudio)
			dbg(`[llm done] ${reply.length} chars`)
			deps.down.sendEvent({ t: 'reply_done', text: reply })
		} catch (e) {
			const m = e instanceof Error ? e.message : String(e)
			dbg(`[llm error] ${m}`)
			deps.down.sendEvent({ t: 'error', message: m })
		} finally {
			// ALWAYS return the client to listening — never leave it stuck in "thinking".
			deps.down.sendEvent({ t: 'turn_done' })
			turnRunning = false
		}
	}

	return {
		onUpstreamOpen() {
			upstreamOpen = true
			dbg('[stt open]')
			flushUpstream()
		},
		onUpstreamFrame(data) {
			// Surface non-delta upstream events (handshake, errors, completion) so we can see the
			// actual protocol Tinfoil speaks. Deltas are frequent — don't spam those.
			const { delta, final } = parseTranscriptEvent(data)
			if (delta === undefined && final === undefined && typeof data === 'string') {
				dbg(`[up] ${data.slice(0, 140)}`)
			}
			if (delta) {
				caption += delta
				deps.down.sendEvent({ t: 'caption', text: caption })
			}
			if (final !== undefined) {
				clearWatchdog()
				const transcript = final || caption
				caption = ''
				if (transcript.trim()) {
					deps.down.sendEvent({ t: 'caption', text: transcript })
					void runTurn(transcript)
				} else {
					dbg('[empty transcript]')
					deps.down.sendEvent({ t: 'turn_done' })
				}
			}
		},
		onClientFrame(data) {
			if (typeof data !== 'string') {
				if (upstreamOpen && deps.upstream.readyState === 1) sendAudioUpstream(data as ArrayBuffer)
				else upstreamQueue.push(data as ArrayBuffer)
				return
			}
			let msg: { t?: string }
			try {
				msg = JSON.parse(data) as { t?: string }
			} catch {
				return
			}
			if (msg.t === 'commit') {
				dbg('[client commit]')
				if (upstreamOpen && deps.upstream.readyState === 1) deps.upstream.send(COMMIT)
				else pendingCommit = true
				startWatchdog()
			} else if (msg.t === 'cancel') {
				close()
			}
		},
		close
	}
}
