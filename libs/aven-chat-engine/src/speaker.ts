/** Anonymous attribution within one native voice session, not verified human identity. */
export interface AnonymousSpeaker {
	session_id: string
	speaker_id: string
	confidence: number
}

/** Read untrusted saved attribution without inferring an identity across sessions. */
export function anonymousSpeakerFromPayload(payload: unknown): AnonymousSpeaker | null {
	if (!isRecord(payload) || !isRecord(payload.anonymousSpeaker)) return null
	const value = payload.anonymousSpeaker
	if (
		typeof value.session_id !== 'string' ||
		value.session_id.length === 0 ||
		value.session_id.length > 256 ||
		typeof value.speaker_id !== 'string' ||
		!/^speaker-[1-9]\d*$/.test(value.speaker_id) ||
		typeof value.confidence !== 'number' ||
		!Number.isFinite(value.confidence) ||
		value.confidence < 0 ||
		value.confidence > 1
	)
		return null
	return {
		session_id: value.session_id,
		speaker_id: value.speaker_id,
		confidence: value.confidence
	}
}
export function anonymousSpeakerPayload(
	speaker: AnonymousSpeaker | undefined
): Record<string, unknown> {
	return speaker ? { anonymousSpeaker: speaker } : {}
}
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
