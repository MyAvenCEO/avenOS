export function toIsoUtcString(value: Date | string | undefined, fallback: Date | string = new Date()): string {
	if (typeof value === 'string') {
		const normalized = value.trim()
		if (normalized.length === 0) {
			return typeof fallback === 'string' ? fallback : fallback.toISOString()
		}

		const parsed = new Date(normalized)
		if (Number.isNaN(parsed.getTime())) {
			throw new RangeError(`Invalid timestamp string: ${value}`)
		}

		return normalized
	}

	if (typeof value === 'string') {
		return value
	}

	if (value instanceof Date) {
		return value.toISOString()
	}

	return typeof fallback === 'string' ? fallback : fallback.toISOString()
}

export function plusMilliseconds(date: Date, milliseconds: number): Date {
	return new Date(date.getTime() + milliseconds)
}

export function exponentialBackoffMilliseconds(attempts: number): number {
	const normalizedAttempts = Math.max(1, attempts)
	return 1000 * 2 ** (normalizedAttempts - 1)
}