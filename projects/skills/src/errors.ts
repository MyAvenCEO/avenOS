export class SkillError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options)
		this.name = 'SkillError'
	}
}

export class SkillValidationError extends SkillError {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options)
		this.name = 'SkillValidationError'
	}
}

export class SkillNotFoundError extends SkillError {
	constructor(skillId: string) {
		super(`Skill not found: ${skillId}`)
		this.name = 'SkillNotFoundError'
	}
}