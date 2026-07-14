/**
 * Client orchestrator for the REALTIME LIVE VOICE mode (board 0120): streams mic PCM to the
 * Alberobello proxy's realtime STT relay, runs the fast Tinfoil LLM turn, and streams sentence-
 * chunked TTS back — all three stages inside the Tinfoil enclave. This module owns the pure,
 * unit-tested pieces (PCM framing, sentence chunking, config/speech fetch); the live capture +
 * WebSocket loop is wired into the voice entry points at runtime.
 *
 * The on-device path (`$lib/intent-mock/transcribe`, `$lib/llm/generate`, `$lib/tts/speak`) is
 * untouched — this is the alternate mode selected via `$lib/settings/voice-mode-store`.
 */

/** Session config returned by `GET /api/ai/voice/realtime` (see `libs/betterauth/src/ai-voice.ts`). */
export type RealtimeVoiceConfig = {
	sttModel: string
	llmModel: string
	ttsModel: string
	sampleRate: number
	delayMs: number
	intent: string
}

/** Minimal fetch signature so callers can inject a stub in tests. */
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>

/**
 * Convert float32 PCM in [-1, 1] to little-endian signed PCM16 — the wire format Tinfoil's
 * `/v1/realtime` expects. Samples are clamped before scaling so out-of-range values don't wrap.
 */
export function floatToPcm16(samples: Float32Array): Int16Array {
	const out = new Int16Array(samples.length)
	for (let i = 0; i < samples.length; i++) {
		const s = Math.max(-1, Math.min(1, samples[i]))
		out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
	}
	return out
}

/**
 * Incrementally split a growing transcript/reply buffer into COMPLETE sentences for TTS
 * streaming: returns every sentence terminated by `.`/`!`/`?` (optionally followed by a closing
 * quote/bracket) and the trailing `rest` to keep buffering until the next terminator arrives.
 * Lets the caller start speaking sentence 1 while the LLM is still generating sentence 2.
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

/** Fetch the realtime session config from the proxy. Throws on a non-2xx so the caller can fall
 *  back to on-device mode. `token` is the Better Auth bearer (mirrors the chat client). */
export async function fetchRealtimeConfig(opts: {
	baseUrl: string
	token?: string
	fetchImpl?: Fetcher
}): Promise<RealtimeVoiceConfig> {
	const f = opts.fetchImpl ?? fetch
	const res = await f(`${opts.baseUrl}/api/ai/voice/realtime`, {
		headers: opts.token ? { Authorization: `Bearer ${opts.token}` } : {}
	})
	if (!res.ok) throw new Error(`realtime config failed: ${res.status}`)
	return (await res.json()) as RealtimeVoiceConfig
}

/**
 * Synthesize one sentence via the proxy TTS broker and return the raw audio bytes (PCM by
 * default) for playback. Sentence-at-a-time so the first clip plays while the LLM keeps going.
 */
export async function synthesizeSpeech(opts: {
	baseUrl: string
	text: string
	token?: string
	voice?: string
	model?: string
	fetchImpl?: Fetcher
}): Promise<ArrayBuffer> {
	const f = opts.fetchImpl ?? fetch
	const res = await f(`${opts.baseUrl}/api/ai/voice/speech`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {})
		},
		body: JSON.stringify({ text: opts.text, voice: opts.voice, model: opts.model })
	})
	if (!res.ok) throw new Error(`speech failed: ${res.status}`)
	return res.arrayBuffer()
}
