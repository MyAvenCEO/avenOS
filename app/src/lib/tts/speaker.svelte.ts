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

/** Anything WebKit counts as the gesture that unblocks audio output. */
const GESTURES = ['pointerdown', 'keydown', 'touchstart'] as const

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
	/**
	 * What the output device is doing, and how much work is in flight.
	 *
	 * A voice that goes quiet has two very different causes that look identical
	 * from the outside — synthesis that never comes back, and audio scheduled
	 * into a context that is not running — and no error is raised for either.
	 * These three make the difference visible: sentences out at Rust, buffers
	 * that came back, and whether the speakers are actually awake.
	 */
	output = $state<AudioContextState | 'none'>('none')
	inflight = $state(0)
	decoded = $state(0)
	/** Seconds between now and where the last sentence was placed on the timeline. */
	lead = $state(0)

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
	/** Everything scheduled and not yet finished, so `silence()` can stop it. */
	#sources = new Set<AudioBufferSourceNode>()
	/**
	 * Context time at which the last scheduled sentence ends.
	 *
	 * Playback is scheduled on the audio clock rather than started when the
	 * previous sentence's `onended` fires. Waiting for that callback and only
	 * then calling `start()` costs an event-loop turn plus the audio callback's
	 * own latency between every pair of sentences — audible as a stutter even
	 * when the audio itself is ready.
	 */
	#playhead = 0
	/** Whether a gesture listener is already waiting to wake the output. */
	#armed = false

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
	 * Open (or wake) the output device.
	 *
	 * An AudioContext created outside a user gesture starts suspended, and WebKit
	 * will not honour `resume()` until a gesture has happened at least once. In a
	 * conversation that is entirely spoken there is no gesture — the app opens,
	 * the mic is already listening, and nobody ever clicks anything. Everything
	 * then behaves as though it were speaking (sources scheduled, `speaking` set,
	 * the panel reading "Spricht") while the output device is quietly asleep.
	 *
	 * So this is called on every send *and* armed to fire on the first click or
	 * keypress whenever it happens, whichever comes first.
	 */
	resumeAudio(): void {
		if (!this.on) return
		this.#audio()
	}

	/** The output context, woken if it can be and unblocked when it cannot. */
	#audio(): AudioContext {
		if (!this.#context) {
			this.#context = new AudioContext()
			this.#context.onstatechange = () => {
				this.output = this.#context?.state ?? 'none'
			}
		}
		const context = this.#context
		this.output = context.state
		if (context.state === 'suspended') {
			void context.resume().then(() => {
				this.output = context.state
			})
			this.#arm()
		}
		return context
	}

	/** Resume on the next gesture of any kind, once. */
	#arm(): void {
		if (this.#armed) return
		this.#armed = true
		const wake = () => {
			void this.#context?.resume()
			for (const event of GESTURES) window.removeEventListener(event, wake)
			this.#armed = false
		}
		for (const event of GESTURES) window.addEventListener(event, wake, { passive: true })
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
		for (const source of this.#sources) source.stop()
		this.#sources.clear()
		this.#playhead = 0
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
		// Nothing without a letter is worth saying. When the model degenerates it
		// streams bare punctuation — `}` upon `}` — and the synthesizer would
		// earnestly try to pronounce it.
		if (trimmed === '' || !/\p{L}/u.test(trimmed)) return
		this.#queue.push(trimmed)
		void this.#drain()
	}

	/**
	 * Speak the queue, one sentence at a time — but synthesize ahead.
	 *
	 * Synthesizing and playing in strict sequence put a synthesis-shaped hole
	 * between every pair of sentences, because the next one was not even started
	 * until the previous had finished playing. Since a sentence takes less time
	 * to make than to say, starting the next one immediately hides that work
	 * entirely behind the current sentence's audio.
	 */
	async #drain(): Promise<void> {
		if (this.#draining) return
		this.#draining = true
		this.speaking = true
		// Last turn's failure, if any, has been on screen until now. One bad
		// sentence should not label the voice broken forever.
		this.failure = null

		try {
			// Always one sentence in flight beyond the one being handled.
			let ahead: Promise<AudioBuffer | null> | null = null

			// No generation check in the condition. `silence()` empties the queue,
			// so the loop ends on its own — whereas exiting early left anything
			// queued afterwards stranded, because `#enqueue` sees `#draining` still
			// true and returns without starting a new drain. That is how the voice
			// went silent after the first interruption: the sentences were made and
			// then never spoken.
			while (this.#queue.length > 0 || ahead) {
				const current = ahead ?? this.#synthesize(this.#queue.shift() ?? '')
				ahead = this.#queue.length > 0 ? this.#synthesize(this.#queue.shift() ?? '') : null

				// Null when it was interrupted mid-synthesis; nothing to play.
				const buffer = await current
				// Scheduled, not awaited: the next sentence is synthesized while this
				// one plays, and lands on the timeline exactly where it ends.
				if (buffer) this.#schedule(buffer)
			}
		} catch (err) {
			this.failure = err instanceof Error ? err.message : String(err)
		} finally {
			this.#draining = false
			// Anything queued while this was unwinding would otherwise sit there
			// forever, since `#enqueue` declines to start a second drain.
			if (this.#queue.length > 0) void this.#drain()
			// `speaking` is otherwise cleared by the last source ending — audio is
			// still on the timeline after the loop stops queueing it.
			else if (this.#sources.size === 0) this.speaking = false
		}
	}

	/** Turn one sentence into audio, or nothing if it was interrupted meanwhile. */
	async #synthesize(text: string): Promise<AudioBuffer | null> {
		if (text.trim() === '') return null

		// `resumeAudio()` normally opened this already; a reply that somehow
		// arrives first still gets a context rather than being dropped.
		const context = this.#audio()
		const generation = this.#generation

		// The command answers with a WAV as raw bytes rather than a JSON array of
		// a few hundred thousand floats, so decoding is the browser's own job.
		this.inflight++
		let wav: ArrayBuffer
		try {
			wav = await invoke<ArrayBuffer>('tts_speak', { text, lang: 'de' })
		} finally {
			this.inflight--
		}
		if (generation !== this.#generation) return null

		const buffer = await context.decodeAudioData(wav)
		this.decoded++
		// Interrupted while this was being made. Play it and the user would hear
		// the sentence they just talked over.
		return generation === this.#generation ? buffer : null
	}

	/** Put one buffer on the timeline, immediately after whatever precedes it. */
	#schedule(buffer: AudioBuffer): void {
		// Checked here too: a context can be suspended again between sentences (the
		// window losing focus is enough), and scheduling into a stopped clock plays
		// nothing while looking exactly like success.
		const context = this.#audio()

		// A hair in the future when starting fresh, so the first sentence is not
		// scheduled in the past while the graph spins up.
		const at = Math.max(context.currentTime + 0.02, this.#playhead)
		const source = context.createBufferSource()
		source.buffer = buffer
		source.connect(context.destination)
		source.onended = () => {
			this.#sources.delete(source)
			if (this.#sources.size === 0 && !this.#draining) this.speaking = false
		}

		this.#sources.add(source)
		source.start(at)
		this.#playhead = at + buffer.duration
		this.lead = Math.round((at - context.currentTime) * 10) / 10
	}
}
