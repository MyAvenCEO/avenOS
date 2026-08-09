import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

/**
 * The open microphone.
 *
 * There is no push-to-talk and no record button: the mic is live for as long as
 * the dashboard is, and Silero VAD in the Rust side decides what counts as
 * someone talking. That is what makes interrupting work — the agent can be cut
 * off mid-sentence because speech is detected in ~64 ms, long before anything
 * has been transcribed.
 *
 * Capture happens here rather than in Rust for one reason: `getUserMedia` gives
 * us echo cancellation. Without it the agent hears itself through the speakers
 * and interrupts itself the instant it starts talking.
 */

export type ListenerStatus = 'unavailable' | 'preparing' | 'listening' | 'denied' | 'error'

export interface ListenerHooks {
	/** Someone started talking — the moment to shut the agent up. */
	onSpeechStart?: () => void
	/** Recognized text so far in the current utterance. */
	onPartial?: (text: string) => void
	/** They stopped; this is the finished utterance. */
	onUtterance?: (text: string) => void
}

/** Weight-download progress, emitted by the Rust side while fetching. */
interface ModelProgress {
	feature: string
	received: number
	total: number
	done: boolean
}

interface AsrEvent {
	speech: boolean
	started: boolean
	ended: boolean
	delta: string
	transcript: string
	probability: number
}

export class Listener {
	status = $state<ListenerStatus>('unavailable')
	/** True while the user is talking. */
	speech = $state(false)
	/** What has been heard so far in the utterance being spoken. */
	partial = $state('')
	/** Weight download, 0..1. Only meaningful while `preparing`. */
	progress = $state(0)
	/**
	 * Input level, 0..1, computed here rather than in Rust.
	 *
	 * This exists to answer one question without guessing: a level pinned at
	 * zero while the status says listening means the stream resolved but macOS
	 * is handing us silence — a permission problem — which looks identical from
	 * the outside to a recognizer that is not working.
	 */
	level = $state(0)
	/** What the audio context actually runs at. Should be 16000. */
	rate = $state(0)
	/** Batches sent to the recognizer, so a dead pipeline is visible as zero. */
	pushes = $state(0)
	/** Highest speech probability Silero has reported recently. */
	probability = $state(0)
	/**
	 * Which wait this is: fetching weights, or opening them.
	 *
	 * They are nothing alike. The download has a percentage and happens once
	 * ever; opening is ~8 s of ONNX session creation for 2.45 GB of tensors, on
	 * every single launch. Showing a download bar at 0% through the second is how
	 * "laden 0%" sits on screen looking hung.
	 */
	stage = $state<'download' | 'load' | 'ready'>('download')
	/** Batches thrown away because the recognizer fell too far behind. */
	dropped = $state(0)
	failure = $state<string | null>(null)

	#hooks: ListenerHooks
	#context: AudioContext | null = null
	#stream: MediaStream | null = null
	#node: AudioWorkletNode | null = null
	/** Batches waiting to go to the recognizer, in order. */
	#queue: Float32Array[] = []
	#draining = false

	constructor(hooks: ListenerHooks = {}) {
		this.#hooks = hooks
	}

	get available(): boolean {
		return isTauri()
	}

	/**
	 * Load the models and open the mic.
	 *
	 * Called from a user gesture, because that is what a microphone permission
	 * prompt wants. ~2.6 GB on the very first run.
	 */
	async start(): Promise<void> {
		if (this.status === 'listening' || this.status === 'preparing') return
		if (!this.available) {
			this.status = 'unavailable'
			return
		}

		this.status = 'preparing'
		this.failure = null

		try {
			// The recognizer is a 2.6 GB download the first time. Subscribe before
			// asking for it, or the whole thing finishes before we are listening.
			const unlisten = await listen<ModelProgress>('model-progress', ({ payload }) => {
				if (payload.feature !== 'asr' || payload.total === 0) return
				this.progress = payload.received / payload.total
			})
			const unstage = await listen<[string, string]>('model-stage', ({ payload }) => {
				if (payload[0] === 'asr') this.stage = payload[1] as typeof this.stage
			})
			try {
				await invoke('asr_prepare')
			} finally {
				unlisten()
				unstage()
			}

			this.#stream = await navigator.mediaDevices.getUserMedia({
				audio: {
					// Without AEC the agent's own voice comes back through the mic and
					// trips the barge-in the moment it starts speaking.
					echoCancellation: true,
					noiseSuppression: true,
					autoGainControl: true,
					channelCount: 1
				}
			})

			// 16 kHz here means the browser resamples on the way in and the worklet
			// can hand Rust exactly what Silero and Nemotron both expect.
			this.#context = new AudioContext({ sampleRate: 16_000 })
			await this.#context.resume()
			await this.#context.audioWorklet.addModule('/asr-worklet.js')

			this.#node = new AudioWorkletNode(this.#context, 'asr-tap')
			this.#node.port.onmessage = (event) => {
				// The worklet's first message is its real sample rate, not audio.
				if (!(event.data instanceof Float32Array)) {
					this.rate = (event.data as { rate: number }).rate
					return
				}
				void this.#push(event.data)
			}
			this.#context.createMediaStreamSource(this.#stream).connect(this.#node)
			// Not connected to the destination on purpose — this is a tap, and
			// routing the mic to the speakers would be a feedback loop.

			this.status = 'listening'
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err)
			this.status = /permission|denied|NotAllowed/i.test(message) ? 'denied' : 'error'
			this.failure = message
			this.stop()
		}
	}

	stop(): void {
		this.#node?.port.close()
		this.#node?.disconnect()
		this.#node = null
		for (const track of this.#stream?.getTracks() ?? []) track.stop()
		this.#stream = null
		void this.#context?.close()
		this.#context = null
		this.speech = false
		this.partial = ''
		if (this.status === 'listening') this.status = 'preparing'
	}

	/**
	 * Tell the recognizer whether the assistant is audible right now.
	 *
	 * While it is, speech has to clear a much higher bar before it counts —
	 * otherwise the microphone hears the assistant through the speakers and
	 * barge-in kills every reply the moment it starts.
	 */
	setOutputActive(active: boolean): void {
		if (this.available) void invoke('asr_output_active', { active }).catch(() => {})
	}

	/** Throw away a half-heard utterance, e.g. when the chat is cleared. */
	async reset(): Promise<void> {
		this.partial = ''
		this.speech = false
		if (this.available) await invoke('asr_reset').catch(() => {})
	}

	/**
	 * Bring a batch to 16 kHz if the context did not honour the request.
	 *
	 * `new AudioContext({ sampleRate })` is a hint, not a promise — Safari in
	 * particular has a history of running at the device rate regardless. Both
	 * models are built for 16 kHz, and audio at 48 kHz labelled as 16 kHz is
	 * speech played at a third speed as far as they are concerned: the VAD sees
	 * nothing and the recognizer would produce nonsense.
	 */
	#toSixteenK(pcm: Float32Array): Float32Array {
		if (this.rate === 0 || this.rate === 16_000) return pcm

		const ratio = this.rate / 16_000
		const out = new Float32Array(Math.floor(pcm.length / ratio))
		for (let i = 0; i < out.length; i++) {
			// Average the source samples this output sample spans, rather than
			// picking one — plain decimation aliases badly enough to matter.
			const from = Math.floor(i * ratio)
			const to = Math.min(Math.floor((i + 1) * ratio), pcm.length)
			let sum = 0
			for (let j = from; j < to; j++) sum += pcm[j]
			out[i] = to > from ? sum / (to - from) : 0
		}
		return out
	}

	/**
	 * Take one batch from the worklet.
	 *
	 * Queued, never dropped. Discarding a batch because the recognizer was busy
	 * meant audio that simply never happened as far as both models were
	 * concerned: words came out garbled, and the VAD's silence counting was
	 * wrong, which made segmentation ragged too. Transcription runs a little
	 * faster than realtime, so a queue drains rather than grows.
	 */
	#push(raw: Float32Array): void {
		if (this.status !== 'listening') return
		const pcm = this.#toSixteenK(raw)

		let sum = 0
		for (const sample of pcm) sum += sample * sample
		const rms = Math.sqrt(sum / pcm.length)
		// Decay slowly so the eye can follow it; rise immediately.
		this.level = Math.max(rms * 4, this.level * 0.8)

		this.#queue.push(pcm)
		// A bound is still needed, or a stall would grow an unbounded backlog and
		// every later interrupt would arrive progressively later. ~3s of audio.
		while (this.#queue.length > 24) {
			this.#queue.shift()
			this.dropped++
		}
		void this.#drain()
	}

	/** Send queued batches in order, one at a time. */
	async #drain(): Promise<void> {
		if (this.#draining) return
		this.#draining = true

		try {
			while (this.#queue.length > 0 && this.status === 'listening') {
				const pcm = this.#queue.shift()
				if (!pcm) break
				this.pushes++
				await this.#send(pcm)
			}
		} finally {
			this.#draining = false
		}
	}

	async #send(pcm: Float32Array): Promise<void> {
		try {
			// Raw bytes, not a JSON array: 8 KB instead of ~40 KB per batch, and no
			// parse of 2048 numbers on either side.
			const event = await invoke<AsrEvent>('asr_push', new Uint8Array(pcm.buffer))

			// Decays, so the peak of a phrase stays readable for a moment.
			this.probability = Math.max(event.probability, this.probability * 0.9)

			if (event.started) {
				this.partial = ''
				this.#hooks.onSpeechStart?.()
			}
			this.speech = event.speech

			if (event.transcript !== '' && !event.ended) {
				this.partial = event.transcript
				this.#hooks.onPartial?.(event.transcript)
			}

			if (event.ended) {
				const text = event.transcript.trim()
				this.partial = ''
				if (text !== '') this.#hooks.onUtterance?.(text)
			}
		} catch (err) {
			this.failure = err instanceof Error ? err.message : String(err)
		}
	}
}
