import { invoke, isTauri } from '@tauri-apps/api/core'

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
			await invoke('asr_prepare')

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
		if (this.#busy || this.status !== 'listening') return
		this.#busy = true

		try {
			const event = await invoke<AsrEvent>('asr_push', { pcm: Array.from(pcm) })

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
