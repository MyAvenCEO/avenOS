export class RuntimeError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options)
		this.name = 'RuntimeError'
	}
}

export class RuntimeCommitError extends RuntimeError {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options)
		this.name = 'RuntimeCommitError'
	}
}

export class RuntimeActivationTimeoutError extends RuntimeError {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options)
		this.name = 'RuntimeActivationTimeoutError'
	}
}

export class RuntimeActivationAbortedError extends RuntimeError {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options)
		this.name = 'RuntimeActivationAbortedError'
	}
}

export class RuntimeNonRetryableError extends RuntimeError {
	readonly code: string

	constructor(message: string, options?: ErrorOptions & { code?: string }) {
		super(message, options)
		this.name = 'RuntimeNonRetryableError'
		this.code = options?.code ?? 'non_retryable'
	}
}