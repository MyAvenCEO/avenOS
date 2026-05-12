export class ConversationActorsError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options)
		this.name = 'ConversationActorsError'
	}
}

export class ConversationActorsValidationError extends ConversationActorsError {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options)
		this.name = 'ConversationActorsValidationError'
	}
}

export class UnknownIntentError extends ConversationActorsError {
	constructor(intentId: string) {
		super(`Unknown intent: ${intentId}`)
		this.name = 'UnknownIntentError'
	}
}

export class UnknownSkillError extends ConversationActorsError {
	constructor(skillId: string) {
		super(`Unknown skill: ${skillId}`)
		this.name = 'UnknownSkillError'
	}
}