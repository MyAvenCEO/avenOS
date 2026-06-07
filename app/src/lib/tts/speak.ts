/**
 * Streaming on-device text-to-speech client. Calls the `tts_synthesize` Tauri
 * command and plays the `tts:audio-chunk` events it emits (tagged with our
 * `replyId`) through Web Audio — the reverse of the STT capture path. Resolves
 * once the full clip has been emitted and queued for playback.
 *
 * v1 emits the whole clip in a single chunk; the chunk handler already supports
 * multiple chunks (it schedules them back-to-back), so incremental streaming from
 * the engine will Just Work without changing this client.
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
	if (!sharedCtx) sharedCtx = new AudioContext()
	return sharedCtx
}

/**
 * Synthesize and play `text`. Streams PCM tagged with our `replyId`, scheduling
 * each chunk back-to-back on a shared AudioContext. Resolves when the backend
 * signals end-of-stream. Throws outside Tauri or if the backend errors (e.g.
 * model not downloaded / runtime missing).
 */
export async function speak(text: string, replyId: string, voice?: string): Promise<void> {
	if (!isTauri()) throw new Error('on-device TTS requires the desktop app')
	const [{ invoke }, { listen }] = await Promise.all([
		import('@tauri-apps/api/core'),
		import('@tauri-apps/api/event'),
	])

	const ctx = audioContext()
	if (ctx.state === 'suspended') await ctx.resume()
	// Next start time for gapless back-to-back scheduling of streamed chunks.
	let playhead = ctx.currentTime

	const unlisten = await listen<TtsChunk>('tts:audio-chunk', (e) => {
		const p = e.payload
		if (!p || p.replyId !== replyId) return
		if (p.done || !p.pcm || p.pcm.length === 0) return

		const samples = Float32Array.from(p.pcm)
		const buffer = ctx.createBuffer(1, samples.length, p.sampleRate)
		buffer.copyToChannel(samples, 0)
		const src = ctx.createBufferSource()
		src.buffer = buffer
		src.connect(ctx.destination)
		const startAt = Math.max(playhead, ctx.currentTime)
		src.start(startAt)
		playhead = startAt + buffer.duration
	})
	try {
		await invoke('tts_synthesize', { text, replyId, voice })
	} finally {
		unlisten()
	}
}

/** A selectable on-device voice (see `app/src-tauri/src/tts.rs`). */
export type Voice = { id: string; label: string }

/** Fetch the selectable voices for the picker. Returns `[]` outside Tauri. */
export async function listVoices(): Promise<Voice[]> {
	if (!isTauri()) return []
	const { invoke } = await import('@tauri-apps/api/core')
	try {
		return await invoke<Voice[]>('tts_voices')
	} catch {
		return []
	}
}
