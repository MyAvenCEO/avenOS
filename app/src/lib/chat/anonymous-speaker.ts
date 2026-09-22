/**
 * A diarization label is meaningful only inside the native voice session that
 * produced it. Keeping that scope beside the label prevents a later
 * `speaker-1` from being mistaken for the same person after voice restarts.
 */
import type { AnonymousSpeaker } from '@avenos/chat-engine/speaker'
import type { SessionId, SpeakerAttribution } from '$lib/voice/protocol'

export type { AnonymousSpeaker } from '@avenos/chat-engine/speaker'

export type AnonymousSpeakerTone = 'one' | 'two' | 'three'

export function anonymousSpeaker(
	sessionId: SessionId | null,
	attribution: SpeakerAttribution | null
): AnonymousSpeaker | null {
	if (!sessionId || !attribution) return null
	return {
		session_id: sessionId,
		speaker_id: attribution.speaker_id,
		confidence: attribution.confidence
	}
}

export function anonymousSpeakerTone(speaker: AnonymousSpeaker | undefined): AnonymousSpeakerTone {
	const ordinal = Number(speaker?.speaker_id.match(/\d+$/)?.[0] ?? 1)
	return (ordinal - 1) % 3 === 1 ? 'two' : (ordinal - 1) % 3 === 2 ? 'three' : 'one'
}
