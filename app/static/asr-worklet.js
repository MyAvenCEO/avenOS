/**
 * Microphone tap for the German recognizer.
 *
 * Runs on the audio thread, which is the whole point: the render quantum is
 * 128 frames and nothing on the main thread should be woken 125 times a second.
 * Samples are accumulated into ~128 ms batches (2048 frames at 16 kHz, four
 * whole Silero windows) and posted as one message, which keeps the IPC to about
 * eight calls a second while still detecting speech fast enough to interrupt.
 *
 * The AudioContext is created at 16 kHz, so no resampling happens here — the
 * browser has already done it on the way in.
 */
const BATCH = 2048

class AsrTap extends AudioWorkletProcessor {
	constructor() {
		super()
		this.buffer = new Float32Array(BATCH)
		this.filled = 0
		// `sampleRate` is a global in here and is the rate the context ACTUALLY
		// runs at, which is not always the one that was asked for — Safari has a
		// history of ignoring the constructor hint. Everything downstream assumes
		// 16 kHz, so the real figure has to be reported rather than trusted.
		this.port.postMessage({ rate: sampleRate })
	}

	process(inputs) {
		const channel = inputs[0]?.[0]
		// No input connected yet, or the track ended. Staying alive is correct:
		// returning false would tear the node down permanently.
		if (!channel) return true

		for (let i = 0; i < channel.length; i++) {
			this.buffer[this.filled++] = channel[i]
			if (this.filled === BATCH) {
				// Transfer a copy — the buffer is reused for the next batch.
				const batch = this.buffer.slice()
				this.port.postMessage(batch, [batch.buffer])
				this.filled = 0
			}
		}
		return true
	}
}

registerProcessor('asr-tap', AsrTap)
