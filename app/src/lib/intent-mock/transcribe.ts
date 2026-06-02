/**
 * Browser-side client for the on-device transcription command. Sends captured
 * PCM to the Tauri Rust backend (`transcribe_audio`, backed by Voxtral Mini 3B
 * via mistral.rs) and returns the transcript plus an extracted title + summary.
 *
 * The `invoke` is injectable so this stays unit-testable without a Tauri runtime.
 */
import { invoke } from '@tauri-apps/api/core'

export type AudioPayload = { pcm: Float32Array; sampleRate: number }

/** Result of `transcribe_audio` — produced in one constrained-decoding pass. */
export type VoiceNote = { transcript: string; title: string; summary: string }

/** Matches the Rust command signature: `transcribe_audio(pcm: Vec<f32>, sample_rate: u32)`. */
type Invoker = (cmd: string, args: Record<string, unknown>) => Promise<unknown>

/**
 * Transcribe a voice note on-device into `{ transcript, title, summary }`.
 * Throws on backend errors (e.g. model not ready / inference failure) so the
 * caller can surface a message rather than post a bogus transcript.
 */
export async function transcribeAudio(
	audio: AudioPayload,
	invoker: Invoker = invoke
): Promise<VoiceNote> {
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
}
