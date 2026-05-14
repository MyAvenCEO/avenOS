function toRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {}
}

function firstString(...values: unknown[]): string | undefined {
	for (const value of values) {
		if (typeof value === 'string' && value.length > 0) {
			return value
		}
	}
	return undefined
}

export function inferIntentId(payload: unknown): string | undefined {
	const record = toRecord(payload)
	return firstString(
		record.intentId,
		toRecord(record.input).intentId,
		toRecord(record.result).intentId
	)
}

export function inferCallId(payload: unknown): string | undefined {
	const record = toRecord(payload)
	return firstString(
		record.parentCallId,
		record.callId,
		toRecord(record.input).parentCallId,
		toRecord(record.input).callId,
		toRecord(record.result).parentCallId,
		toRecord(record.result).callId
	)
}

export function inferRootCallId(payload: unknown): string | undefined {
	const record = toRecord(payload)
	return firstString(
		record.rootCallId,
		toRecord(record.input).rootCallId,
		toRecord(record.result).rootCallId
	)
}

export function inferLocalCallId(payload: unknown): string | undefined {
	const record = toRecord(payload)
	return firstString(
		record.callId,
		toRecord(record.input).callId,
		toRecord(record.result).callId
	)
}