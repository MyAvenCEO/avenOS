/**
 * Browser-side client for the on-device transcription command. Sends captured
 * PCM to the Tauri Rust backend (`transcribe_audio`, backed by Parakeet-TDT-0.6b-v3
 * via sherpa-onnx) and returns the transcript plus a derived title (summary empty).
 *
 * The `invoke` is injectable so this stays unit-testable without a Tauri runtime.
 */
import { invoke } from '@tauri-apps/api/core'
import {
	ASR_PROGRESS_EVENT,
	reduceTranscribeProgress,
	type TranscribeProgress,
	type TranscribeProgressEvent
} from '$lib/asr/model-download-store'

export type AudioPayload = { pcm: Float32Array; sampleRate: number }

/** Result of `transcribe_audio` — produced in one constrained-decoding pass. */
export type VoiceNote = { transcript: string; title: string; summary: string }

/** Matches the Rust command signature: `transcribe_audio(pcm: Vec<f32>, sample_rate: u32)`. */
type Invoker = (cmd: string, args: Record<string, unknown>) => Promise<unknown>

/** Called with the cumulative preview each time a segment finishes decoding. */
export type ProgressSink = (p: TranscribeProgress) => void

/**
 * Subscribe to `asr:transcribe-progress` for the duration of one transcription,
 * forwarding each event to `onProgress`. No-op (returns a no-op unsubscriber)
 * outside the Tauri runtime so this stays unit-testable.
 */
async function listenForProgress(onProgress: ProgressSink): Promise<() => void> {
	if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return () => {}
	const { listen } = await import('@tauri-apps/api/event')
	const unlisten = await listen<TranscribeProgressEvent>(ASR_PROGRESS_EVENT, (e) => {
		if (e.payload) onProgress(reduceTranscribeProgress(e.payload))
	})
	return () => unlisten()
}

/**
 * Transcribe a voice note on-device into `{ transcript, title, summary }`. While
 * decoding, `onProgress` (if given) receives the cumulative partial transcript per
 * segment so the composer can show a live preview — that preview is NOT posted to
 * the chat; only the final result returned here is. Throws on backend errors (e.g.
 * model not ready / inference failure) so the caller can surface a message rather
 * than post a bogus transcript.
 */
export async function transcribeAudio(
	audio: AudioPayload,
	invoker: Invoker = invoke,
	onProgress?: ProgressSink
): Promise<VoiceNote> {
	const unlisten = onProgress ? await listenForProgress(onProgress) : () => {}
	try {
		const result = (await invoker('transcribe_audio', {
			// Tauri serializes `Vec<f32>` from a plain number array.
			pcm: Array.from(audio.pcm),
			sampleRate: audio.sampleRate
		})) as Partial<VoiceNote> | null
		return {
			transcript: (result?.transcript ?? '').trim(),
			title: (result?.title ?? '').trim(),
			summary: (result?.summary ?? '').trim()
		}
	} finally {
		unlisten()
	}
}
