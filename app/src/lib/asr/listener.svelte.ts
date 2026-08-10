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
	/** Times the capture graph was rebuilt by the watchdog — drift made visible. */
	restarts = $state(0)
	failure = $state<string | null>(null)

	#hooks: ListenerHooks
	#context: AudioContext | null = null
	#stream: MediaStream | null = null
	#node: AudioWorkletNode | null = null
	/** Batches waiting to go to the recognizer, in order. */
	#queue: Float32Array[] = []
	#draining = false
	/** The models are loaded once per app run; rebuilds must not re-download. */
	#prepared = false
	/** Re-entry latch — `status` is for the UI, not for concurrency control. */
	#starting = false
	#rebuilding = false
	/** True between start() and stop(): the watchdog only heals wanted audio. */
	#wantListening = false
	/** When the worklet last delivered audio; the watchdog's heartbeat. */
	#lastFrameAt = 0
	#watchdog: ReturnType<typeof setInterval> | null = null
	/** Last value sent to the echo gate, re-synced by the watchdog. */
	#outputActive = false
	#onDeviceChange = () => {
		// The default input just changed (AirPods on/off, dock, …). The old track
		// often keeps "capturing" the vanished device — eternal silence that
		// looks exactly like a broken recognizer. Take the new default.
		if (this.#wantListening) void this.#rebuild('devicechange')
	}
	/** asr_push failures in a row; a streak means the engine needs a reset. */
	#errorStreak = 0
	/** Utterances that ended with no text in a row — a deaf recognizer's tell. */
	#emptyEnds = 0

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
	 *
	 * Reentrant by design: stop()/start() across route changes must always end
	 * with a live graph. The old guard compared against `status === 'preparing'`
	 * — which stop() itself set — so one visit to the settings page killed the
	 * microphone until the next app launch while the UI kept looking fine.
	 */
	async start(): Promise<void> {
		if (this.#starting || this.status === 'listening') return
		if (!this.available) {
			this.status = 'unavailable'
			return
		}

		this.#starting = true
		this.#wantListening = true
		this.status = 'preparing'
		this.failure = null

		try {
			if (!this.#prepared) {
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
					this.#prepared = true
				} finally {
					unlisten()
					unstage()
				}
			}

			await this.#capture()
			this.status = 'listening'
			navigator.mediaDevices.addEventListener?.('devicechange', this.#onDeviceChange)
			this.#watch()
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err)
			this.status = /permission|denied|NotAllowed/i.test(message) ? 'denied' : 'error'
			this.failure = message
			this.#teardownCapture()
		} finally {
			this.#starting = false
		}
	}

	/** Open the microphone graph: stream → context → worklet tap. */
	async #capture(): Promise<void> {
		this.#teardownCapture()

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

		// Device rate, deliberately — never ask for 16 kHz here. WebKit has one
		// audio pipeline for the whole webview, and whichever context is created
		// first sets its rate: this one exists before the speaker's, so a 16 kHz
		// request left the speaker's 44.1 kHz context with a clock that reported
		// "running" and never advanced — six sentences synthesized, scheduled,
		// and silent, with "Spricht" stuck on screen. `#toSixteenK` resamples on
		// the way to the recognizer instead, which it had to be able to do
		// anyway, because the 16 kHz request was only ever a hint.
		this.#context = new AudioContext()
		// The worklet reports its true rate in its first message, but that message
		// is not guaranteed to win the race against the first audio batch — and a
		// rate of 0 would send device-rate audio to a 16 kHz recognizer, which the
		// VAD hears as nothing at all. The context knows its rate right now.
		this.rate = this.#context.sampleRate
		await this.#context.resume()
		await this.#context.audioWorklet.addModule('/asr-worklet.js')

		this.#node = new AudioWorkletNode(this.#context, 'asr-tap')
		this.#node.port.onmessage = (event) => {
			// The worklet's first message is its real sample rate, not audio.
			if (!(event.data instanceof Float32Array)) {
				this.rate = (event.data as { rate: number }).rate
				return
			}
			this.#lastFrameAt = Date.now()
			void this.#push(event.data)
		}
		this.#context.createMediaStreamSource(this.#stream).connect(this.#node)
		// Not connected to the destination on purpose — this is a tap, and
		// routing the mic to the speakers would be a feedback loop.

		// A track that mutes or ends (device unplugged, input route stolen) is
		// silence that reports itself — take the signal instead of waiting for
		// the frame watchdog to infer it.
		for (const track of this.#stream.getTracks()) {
			track.onended = () => {
				if (this.#wantListening) void this.#rebuild('track ended')
			}
			track.onmute = () => {
				// Mutes flicker during route changes; only a mute that HOLDS is real.
				setTimeout(() => {
					if (this.#wantListening && this.#stream?.getTracks().some((t) => t.muted)) {
						void this.#rebuild('track muted')
					}
				}, 1200)
			}
		}
		this.#context.onstatechange = () => {
			if (this.#context?.state === 'suspended' && this.#wantListening) {
				void this.#context.resume()
			}
		}

		this.#lastFrameAt = Date.now()
	}

	#teardownCapture(): void {
		this.#node?.port.close()
		this.#node?.disconnect()
		this.#node = null
		for (const track of this.#stream?.getTracks() ?? []) {
			track.onended = null
			track.onmute = null
			track.stop()
		}
		this.#stream = null
		if (this.#context) this.#context.onstatechange = null
		void this.#context?.close()
		this.#context = null
	}

	/**
	 * Tear the graph down and open it again, models untouched. This is the one
	 * answer to every way the capture side dies quietly — frozen worklet,
	 * vanished device, suspended context — because a fresh graph on the current
	 * default device is correct in all of them.
	 */
	async #rebuild(reason: string): Promise<void> {
		if (this.#rebuilding || !this.#wantListening) return
		this.#rebuilding = true
		console.warn(`[listener] rebuilding capture: ${reason}`)
		try {
			await this.#capture()
			this.restarts++
			if (this.status !== 'listening') this.status = 'listening'
			this.failure = null
		} catch (err) {
			// getUserMedia can fail transiently mid route-change; the watchdog
			// keeps retrying as long as listening is wanted.
			this.failure = err instanceof Error ? err.message : String(err)
			this.status = 'error'
		} finally {
			this.#rebuilding = false
		}
	}

	/**
	 * The heartbeat. "Bereit" on screen while nothing reaches the recognizer is
	 * the one failure the UI cannot show on its own — so the watchdog measures
	 * the actual audio flow and heals instead of hoping:
	 * - no worklet frames for 3 s while listening → rebuild the graph
	 * - a failed rebuild (status error) → try again
	 * - the echo gate is re-synced every tick, because one lost IPC otherwise
	 *   leaves the 0.92 barge-in threshold on FOREVER — the mic looks alive,
	 *   the level meter moves, and ordinary speech never counts again.
	 */
	#watch(): void {
		if (this.#watchdog) return
		this.#watchdog = setInterval(() => {
			if (!this.#wantListening) return
			void invoke('asr_output_active', { active: this.#outputActive }).catch(() => {})
			if (this.status === 'error') {
				void this.#rebuild('retry after error')
				return
			}
			if (this.status !== 'listening') return
			if (this.#context?.state === 'suspended') void this.#context.resume()
			if (Date.now() - this.#lastFrameAt > 3000) {
				void this.#rebuild(`no audio frames for ${Date.now() - this.#lastFrameAt}ms`)
			}
		}, 1500)
	}

	stop(): void {
		this.#wantListening = false
		if (this.#watchdog) {
			clearInterval(this.#watchdog)
			this.#watchdog = null
		}
		navigator.mediaDevices.removeEventListener?.('devicechange', this.#onDeviceChange)
		this.#teardownCapture()
		this.speech = false
		this.partial = ''
		if (this.status === 'listening') this.status = 'preparing'
	}

	/**
	 * Tell the recognizer whether the assistant is audible right now.
	 *
	 * While it is, speech has to clear a much higher bar before it counts —
	 * otherwise the microphone hears the assistant through the speakers and
	 * barge-in kills every reply the moment it starts. The value is remembered
	 * and re-sent by the watchdog: this flag silently stuck on `true` was one
	 * of the ways the mic "listened" without ever transcribing.
	 */
	setOutputActive(active: boolean): void {
		this.#outputActive = active
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
			this.#errorStreak = 0

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
				if (text !== '') {
					this.#emptyEnds = 0
					this.#hooks.onUtterance?.(text)
				} else {
					// "Hört zu" happened, then… nothing: the VAD opened an utterance
					// the recognizer heard nothing in. Once is a cough. Twice in a
					// row is a wedged model or corrupt audio — reset the engine and
					// rebuild the graph rather than staying quietly deaf.
					this.#emptyEnds++
					console.warn(
						`[listener] utterance ended EMPTY (#${this.#emptyEnds}, ` +
							`prob ${this.probability.toFixed(2)}, level ${this.level.toFixed(3)}, ` +
							`rate ${this.rate}, pushes ${this.pushes})`
					)
					if (this.#emptyEnds >= 2) {
						this.#emptyEnds = 0
						await invoke('asr_reset').catch(() => {})
						void this.#rebuild('two empty utterances in a row')
					}
				}
			}
		} catch (err) {
			this.failure = err instanceof Error ? err.message : String(err)
			// One failed push is noise; a streak is a wedged engine. Resetting it
			// costs a half-heard utterance and buys back the microphone — audio
			// silently erroring forever WAS "Bereit" with no transcription.
			if (++this.#errorStreak >= 3) {
				this.#errorStreak = 0
				console.warn(`[listener] asr_push failing repeatedly, resetting engine: ${this.failure}`)
				await invoke('asr_reset').catch(() => {})
			}
		}
	}
}
