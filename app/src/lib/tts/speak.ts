/**
 * On-device text-to-speech client. Calls the `tts_synthesize` Tauri command, which
 * streams `tts:audio-chunk` events (tagged with our `replyId`), and plays the result
 * through Web Audio.
 *
 * Playback model: we **buffer the whole clip, then play it as one continuous
 * AudioBuffer**. Scheduling the streamed 0.5 s chunks back-to-back as they arrived
 * underran whenever generation dipped below real-time (the LLM + webview compete for
 * CPU on an 8 GB Mac) — the playhead passed the gap and you heard start/stop/start/
 * stop. One buffer is gap-free by construction; the short synth wait is covered by the
 * Speak button's "Generating…" spinner.
 */

/** Payload of the `tts:audio-chunk` streaming event (see `app/src-tauri/src/tts.rs`). */
export type TtsChunk = {
	replyId: string
	pcm: number[]
	sampleRate: number
	done: boolean
}

function isTauri(): boolean {
	return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

let sharedCtx: AudioContext | null = null
function audioContext(): AudioContext {
	if (!sharedCtx) {
		// iOS < 14.5 (and some WKWebView builds) only expose the prefixed constructor; bare
		// `new AudioContext()` throws there. Mirror IntentComposer's capture path.
		const Ctx: typeof AudioContext =
			window.AudioContext ??
			(window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
		sharedCtx = new Ctx()
	}
	return sharedCtx
}

/** Playback phase for UI feedback: synthesizing (no audio yet) → audio playing. */
export type SpeakPhase = 'generating' | 'playing'

/**
 * Synthesize `text`, then play the full clip. Resolves when playback finishes (so the
 * caller can hold the "speaking" state for the whole duration). `onPhase` reports the
 * transition from synthesis to playback. Throws outside Tauri or if the backend errors
 * (e.g. model not downloaded / runtime missing).
 */
export async function speak(
	text: string,
	replyId: string,
	onPhase?: (phase: SpeakPhase) => void
): Promise<void> {
	if (!isTauri()) throw new Error('on-device TTS requires the desktop app')
	const [{ invoke }, { listen }] = await Promise.all([
		import('@tauri-apps/api/core'),
		import('@tauri-apps/api/event')
	])

	onPhase?.('generating')

	const ctx = audioContext()
	if (ctx.state === 'suspended') await ctx.resume()

	// Accumulate every streamed PCM chunk; we concatenate + play once generation ends.
	const parts: Float32Array[] = []
	let sampleRate = 48000

	// Resolve when the backend's `done` marker arrives — NOT when `invoke` resolves.
	// Chunk events are delivered async; stopping the moment `invoke` returns can drop
	// the final (or only) chunk.
	let onDone: () => void = () => {}
	const streamDone = new Promise<void>((resolve) => {
		onDone = resolve
	})

	const unlisten = await listen<TtsChunk>('tts:audio-chunk', (e) => {
		const p = e.payload
		if (!p || p.replyId !== replyId) return
		if (p.done) {
			onDone()
			return
		}
		if (!p.pcm || p.pcm.length === 0) return
		sampleRate = p.sampleRate
		parts.push(Float32Array.from(p.pcm))
	})

	try {
		await invoke('tts_synthesize', { text, replyId })
		// Wait for all emitted chunks (the `done` marker follows them). Safety timeout
		// so a lost marker can't hang forever.
		await Promise.race([streamDone, new Promise((r) => setTimeout(r, 3000))])
	} finally {
		unlisten()
	}

	// Concatenate the whole clip into ONE buffer and play it gap-free.
	const total = parts.reduce((n, a) => n + a.length, 0)
	if (total === 0) return
	const all = new Float32Array(total)
	let offset = 0
	for (const part of parts) {
		all.set(part, offset)
		offset += part.length
	}

	const buffer = ctx.createBuffer(1, all.length, sampleRate)
	buffer.copyToChannel(all, 0)
	const src = ctx.createBufferSource()
	src.buffer = buffer
	src.connect(ctx.destination)

	onPhase?.('playing')
	await new Promise<void>((resolve) => {
		src.onended = () => resolve()
		src.start()
	})
}
