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
