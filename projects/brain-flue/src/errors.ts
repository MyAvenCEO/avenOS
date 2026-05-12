export class FlueBrainError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options)
		this.name = 'FlueBrainError'
	}
}

export class FlueBrainValidationError extends FlueBrainError {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options)
		this.name = 'FlueBrainValidationError'
	}
}

export class FlueBrainModelError extends FlueBrainError {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options)
		this.name = 'FlueBrainModelError'
	}
}

export function isFlueBrainValidationError(error: unknown): error is FlueBrainValidationError {
	return error instanceof Error && error.name === 'FlueBrainValidationError'
}

export function toFlueBrainModelError(message: string, error: unknown): Error {
	if (isFlueBrainValidationError(error)) {
		return error
	}

	return new FlueBrainModelError(`${message}: ${error instanceof Error ? error.message : String(error)}`, {
		cause: error instanceof Error ? error : undefined
	})
}