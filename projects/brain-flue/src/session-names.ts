const SLUG_SAFE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function createSupervisorSessionName(skillId: string): string {
	return `actor/aven/skills/${skillId}`
}

export function createWorkerSessionName(workerActorId: string): string {
	return `actor/${workerActorId}`
}

export function createDispatcherSessionName(): string {
	return 'actor/aven/system/dispatcher'
}

export function createIntentSessionName(intentId: string): string {
	return `actor/aven/intents/${intentId}`
}

export function isSlugSafe(value: string): boolean {
	return SLUG_SAFE_PATTERN.test(value)
}