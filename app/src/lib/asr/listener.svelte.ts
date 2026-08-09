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
	failure = $state<string | null>(null)

	#hooks: ListenerHooks
	#context: AudioContext | null = null
	#stream: MediaStream | null = null
	#node: AudioWorkletNode | null = null
	/** Serializes pushes — overlapping invokes would reorder the audio. */
	#busy = false

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
			try {
				await invoke('asr_prepare')
			} finally {
				unlisten()
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
			this.#node.port.onmessage = (event) => void this.#push(event.data as Float32Array)
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

	/** Throw away a half-heard utterance, e.g. when the chat is cleared. */
	async reset(): Promise<void> {
		this.partial = ''
		this.speech = false
		if (this.available) await invoke('asr_reset').catch(() => {})
	}

	async #push(pcm: Float32Array): Promise<void> {
		// Dropping a batch is better than queueing them: if Rust falls behind,
		// a backlog would make every later interrupt progressively later.
		// Cheap enough to do on every batch, and it must run even when a push is
		// dropped, or the meter would read zero exactly when we most want it.
		let sum = 0
		for (const sample of pcm) sum += sample * sample
		const rms = Math.sqrt(sum / pcm.length)
		// Decay slowly so the eye can follow it; rise immediately.
		this.level = Math.max(rms * 4, this.level * 0.8)

		if (this.#busy || this.status !== 'listening') return
		this.#busy = true

		try {
			// Raw bytes, not a JSON array: 8 KB instead of ~40 KB per batch, and no
			// parse of 2048 numbers on either side.
			const event = await invoke<AsrEvent>('asr_push', new Uint8Array(pcm.buffer))

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
		} finally {
			this.#busy = false
		}
	}
}
