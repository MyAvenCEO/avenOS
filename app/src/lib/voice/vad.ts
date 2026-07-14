/**
 * Tiny energy-based Voice Activity Detector for the hands-free realtime conversation (board 0120
 * slice B). No model — just RMS energy with a hangover timer, which is enough to auto-endpoint
 * utterances (commit on a pause) and detect barge-in. Pure + clock-injected, so the state machine
 * is unit-testable without audio.
 */

/** RMS energy of a mono PCM frame in [0, ~1]. */
export function rms(frame: Float32Array): number {
	if (frame.length === 0) return 0
	let sum = 0
	for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i]
	return Math.sqrt(sum / frame.length)
}

/** VAD transitions: speech onset, or end-of-utterance after `hangoverMs` of silence. */
export type VadEvent = 'start' | 'end' | null

export type Vad = {
	/** Feed one frame's RMS at time `nowMs`; returns a transition or null. */
	push(energy: number, nowMs: number): VadEvent
	/** True while inside a speech run. */
	readonly speaking: boolean
	reset(): void
}

/**
 * Create an energy VAD. `threshold` is the RMS above which a frame counts as speech; a run ends
 * once `hangoverMs` elapse with no voiced frame (so short intra-word pauses don't cut the turn).
 */
export function createVad(opts?: { threshold?: number; hangoverMs?: number }): Vad {
	const threshold = opts?.threshold ?? 0.015
	const hangoverMs = opts?.hangoverMs ?? 700
	let speaking = false
	let lastVoiceMs = 0

	return {
		push(energy: number, nowMs: number): VadEvent {
			const voiced = energy >= threshold
			if (voiced) {
				lastVoiceMs = nowMs
				if (!speaking) {
					speaking = true
					return 'start'
				}
				return null
			}
			if (speaking && nowMs - lastVoiceMs >= hangoverMs) {
				speaking = false
				return 'end'
			}
			return null
		},
		get speaking() {
			return speaking
		},
		reset() {
			speaking = false
			lastVoiceMs = 0
		}
	}
}
