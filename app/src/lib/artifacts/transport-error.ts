export function transportError(error: unknown): {
	message: string
	code: string
	status?: number
	retryable: boolean
} {
	let value: unknown = error
	if (typeof value === 'string') {
		try {
			value = JSON.parse(value)
		} catch {}
	}
	if (value && typeof value === 'object' && 'message' in value) {
		const data = value as {
			message: unknown
			code?: unknown
			retryable?: unknown
			status?: unknown
		}
		return {
			message: String(data.message),
			...(typeof data.status === 'number' && { status: data.status }),
			code: String(data.code ?? 'CLIENT_ERROR'),
			retryable: data.retryable === true
		}
	}
	return { message: String(error), code: 'CLIENT_ERROR', retryable: false }
}
