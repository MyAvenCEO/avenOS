export class PersistenceError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'PersistenceError'
	}
}

export class ConcurrencyError extends PersistenceError {
	constructor(message: string) {
		super(message)
		this.name = 'ConcurrencyError'
	}
}

export class NotFoundError extends PersistenceError {
	constructor(message: string) {
		super(message)
		this.name = 'NotFoundError'
	}
}