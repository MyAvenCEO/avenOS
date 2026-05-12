const SLUG_SAFE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function createSupervisorSessionName(skillId: string): string {
	return `actor/skill/${skillId}`
}

export function createWorkerSessionName(skillId: string, workerId: string): string {
	return `actor/skill-worker/${skillId}/${workerId}`
}

export function createDispatcherSessionName(): string {
	return 'actor/dispatcher'
}

export function createIntentSessionName(intentId: string): string {
	return `actor/intent/${intentId}`
}

export function isSlugSafe(value: string): boolean {
	return SLUG_SAFE_PATTERN.test(value)
}