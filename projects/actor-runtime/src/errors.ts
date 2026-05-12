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