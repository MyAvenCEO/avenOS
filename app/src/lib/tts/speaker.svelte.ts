import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

/**
 * Speaks the assistant's reply out loud, in German, while it is still being
 * written.
 *
 * Synthesis is Supertonic-3 running through ONNX Runtime in the Rust side
 * (`src-tauri/src/tts`) — on-device, no key, nothing leaving the machine. This
 * therefore only works inside the Tauri app; in a plain browser tab there is no
 * `invoke` to call and the speaker reports as unavailable rather than pretending.
 *
 * The trick to making it feel live is not to wait for the reply to finish.
 * Deltas are buffered until a sentence boundary appears and each finished
 * sentence is queued immediately, so the first sentence is usually being spoken
 * while the model is still writing the third. At ~4.4x realtime a sentence
 * synthesizes in a few hundred milliseconds, comfortably inside that gap.
 */

/**
 * A sentence has landed when a terminator is followed by whitespace. Keeping
 * chunks at sentence size matters for more than latency: the synthesizer is
 * given whole clauses, so its prosody has something to work with.
 */
const BOUNDARY = /[.!?:]\s/g

export type SpeakerStatus = 'unavailable' | 'preparing' | 'ready' | 'error'

export class Speaker {
	/**
	 * There is no off switch on purpose. In the app the voice is simply on; in a
	 * browser tab it is simply `unavailable` and the chat stays text-only. A
	 * toggle would only ever be used once, and the wrong way round.
	 */
	status = $state<SpeakerStatus>('unavailable')
	speaking = $state(false)
	failure = $state<string | null>(null)
	/** Weight download, 0..1. Only meaningful while `preparing`. */
	progress = $state(0)

	#context: AudioContext | null = null
	/** Text seen since the last sentence was queued. */
	#pending = ''
	#queue: string[] = []
	#draining = false
	/**
	 * Bumped by every `silence()`.
	 *
	 * Synthesis is a round trip to Rust, so at any moment a sentence may be
	 * half-made. Checking a boolean after the await was not enough — `#draining`
	 * stays true for the whole loop — so an interrupted sentence still arrived
	 * and played a moment later, over the top of whatever was said next. Work
	 * started under an older generation is discarded instead.
	 */
	#generation = 0
	#current: AudioBufferSourceNode | null = null

	constructor() {
		// Synthesis lives in the Rust side, so a plain browser tab has no `invoke`
		// to call. Everything below no-ops in that case and the web build works
		// exactly as before, minus the voice.
		if (isTauri()) void this.#prepare()
	}

	get on(): boolean {
		return this.status === 'preparing' || this.status === 'ready'
	}

	/**
	 * Load the models, downloading them on first ever run (~400 MB).
	 *
	 * Needs no user gesture — it touches no audio device. Playback does, which is
	 * what `resumeAudio()` is for.
	 */
	async #prepare(): Promise<void> {
		this.status = 'preparing'
		this.failure = null
		try {
			const unlisten = await listen<{ feature: string; received: number; total: number }>(
				'model-progress',
				({ payload }) => {
					if (payload.feature !== 'tts' || payload.total === 0) return
					this.progress = payload.received / payload.total
				}
			)
			try {
				await invoke('tts_prepare')
			} finally {
				unlisten()
			}
			this.status = 'ready'
		} catch (err) {
			this.status = 'error'
			this.failure = err instanceof Error ? err.message : String(err)
		}
	}

	/**
	 * Open (or wake) the output device. Call from a user gesture — sending a
	 * message is the natural one — because an AudioContext created outside of one
	 * starts suspended and the first reply would be silent.
	 */
	resumeAudio(): void {
		if (!this.on) return
		this.#context ??= new AudioContext()
		if (this.#context.state === 'suspended') void this.#context.resume()
	}

	/** Feed one streamed delta. Whole sentences are queued as they complete. */
	feed(delta: string): void {
		if (!this.on) return
		this.#pending += delta

		// Everything up to the last boundary is complete; the tail is still being
		// written and has to wait, or the voice stops mid-clause.
		BOUNDARY.lastIndex = 0
		let cut = -1
		for (const match of this.#pending.matchAll(BOUNDARY)) cut = match.index + match[0].length
		if (cut === -1) return

		this.#enqueue(this.#pending.slice(0, cut))
		this.#pending = this.#pending.slice(cut)
	}

	/** Speak whatever is left once the reply has finished streaming. */
	flush(): void {
		if (!this.on) return
		this.#enqueue(this.#pending)
		this.#pending = ''
	}

	/** Stop speaking and drop anything queued. */
	silence(): void {
		this.#queue = []
		this.#pending = ''
		this.#current?.stop()
		this.#current = null
		this.#generation++
		// Nothing is coming out of the speakers now, so say so immediately rather
		// than waiting for the drain loop to unwind. The recognizer raises its
		// threshold while this is true — leaving it set after a barge-in left it
		// demanding 0.92 for eight straight windows, which ordinary speech does
		// not sustain, and it simply stopped hearing anything.
		this.speaking = false
	}

	#enqueue(text: string): void {
		const trimmed = text.trim()
		if (trimmed === '') return
		this.#queue.push(trimmed)
		void this.#drain()
	}

	/** One utterance at a time, so sentences do not overlap. */
	async #drain(): Promise<void> {
		if (this.#draining) return
		this.#draining = true
		this.speaking = true

		try {
			const generation = this.#generation
			while (this.#queue.length > 0 && generation === this.#generation) {
				const next = this.#queue.shift()
				if (next === undefined) break
				await this.#say(next)
			}
		} catch (err) {
			this.failure = err instanceof Error ? err.message : String(err)
		} finally {
			this.#draining = false
			this.speaking = false
		}
	}

	async #say(text: string): Promise<void> {
		// `resumeAudio()` normally created this from the send click; a reply that
		// somehow arrives first still gets a context rather than being dropped.
		this.#context ??= new AudioContext()
		const context = this.#context
		const generation = this.#generation

		// The command answers with a WAV as raw bytes rather than a JSON array of
		// a few hundred thousand floats, so decoding is the browser's own job.
		const wav = await invoke<ArrayBuffer>('tts_speak', { text, lang: 'de' })
		if (generation !== this.#generation) return
		const buffer = await context.decodeAudioData(wav)

		// Interrupted while this was being made. Play it and the user would hear
		// the sentence they just talked over.
		if (generation !== this.#generation) return

		await new Promise<void>((resolve) => {
			const source = context.createBufferSource()
			source.buffer = buffer
			source.connect(context.destination)
			source.onended = () => {
				this.#current = null
				resolve()
			}
			this.#current = source
			source.start()
		})
	}
}
