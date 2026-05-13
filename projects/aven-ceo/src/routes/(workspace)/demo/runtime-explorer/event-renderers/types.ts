export type ActorLogRecord = {
	seq: number
	id: string
	scope: string
	actorId: string | null
	envelopeId: string | null
	type: string
	payload: unknown
	createdAt: string
	logView: 'chat' | 'deep-dive'
}

export function payloadRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export function nestedRecord(value: unknown, key: string): Record<string, unknown> {
	return payloadRecord(payloadRecord(value)[key])
}

export function readString(value: unknown): string | null {
	return typeof value === 'string' && value.trim().length > 0 ? value : null
}

export function readNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null
}