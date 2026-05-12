const SKILL_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function isValidSkillId(value: string): boolean {
	return SKILL_ID_PATTERN.test(value)
}

export function createSkillActorId(skillId: string): string {
	return `skill/${skillId}`
}

export function createSkillWorkerActorId(skillId: string, workerId: string): string {
	return `skill-worker/${skillId}/${workerId}`
}

export function parseSkillActorId(actorId: string): { skillId: string } | null {
	const [kind, skillId, ...rest] = actorId.split('/')
	if (kind !== 'skill' || !skillId || rest.length > 0) {
		return null
	}

	return { skillId }
}

export function parseSkillWorkerActorId(
	actorId: string
): { skillId: string; workerId: string } | null {
	const [kind, skillId, ...workerParts] = actorId.split('/')
	if (kind !== 'skill-worker' || !skillId || workerParts.length === 0) {
		return null
	}

	const workerId = workerParts.join('/')
	if (!workerId) {
		return null
	}

	return { skillId, workerId }
}