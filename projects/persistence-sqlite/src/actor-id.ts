const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export type CanonicalActorKind =
	| 'dispatcher'
	| 'human-outbox'
	| 'intents'
	| 'intent'
	| 'skills'
	| 'skill-supervisor'
	| 'skill-worker'
	| 'actor'

export interface ParsedActorId {
	id: string
	kind: CanonicalActorKind
	parentId?: string
	name: string
	segments: string[]
	intentId?: string
	skillId?: string
	workerId?: string
}

export const DISPATCHER_ACTOR_ID = 'dispatcher'
export const HUMAN_ACTOR_ID = 'human'
export const INTENTS_ACTOR_ID = 'intents'
export const SKILLS_ACTOR_ID = 'skills'

export function isSlugSafe(value: string): boolean {
	return SLUG_PATTERN.test(value)
}

export function createIntentActorId(intentId: string): string {
	return `${INTENTS_ACTOR_ID}/${intentId}`
}

export function createSkillActorId(skillId: string): string {
	return `${SKILLS_ACTOR_ID}/${skillId}`
}

export function createSkillWorkerActorId(skillId: string, workerId: string): string {
	return `${SKILLS_ACTOR_ID}/${skillId}/${workerId}`
}

export function parseIntentActorId(actorId: string): string | null {
	const parsed = parseActorId(actorId)
	return parsed?.kind === 'intent' ? parsed.intentId ?? null : null
}

export function parseSkillActorId(actorId: string): { skillId: string } | null {
	const parsed = parseActorId(actorId)
	return parsed?.kind === 'skill-supervisor' && parsed.skillId ? { skillId: parsed.skillId } : null
}

export function parseSkillWorkerActorId(actorId: string): { skillId: string; workerId: string } | null {
	const parsed = parseActorId(actorId)
	return parsed?.kind === 'skill-worker' && parsed.skillId && parsed.workerId
		? { skillId: parsed.skillId, workerId: parsed.workerId }
		: null
}

export function actorKindFromId(actorId: string): CanonicalActorKind {
	return parseActorId(actorId)?.kind ?? 'actor'
}

export function actorParentIdFromId(actorId: string): string | undefined {
	return parseActorId(actorId)?.parentId
}

export function actorNameFromId(actorId: string): string {
	return parseActorId(actorId)?.name ?? actorId
}

export function assertCanonicalActorId(actorId: string): ParsedActorId {
	const parsed = parseActorId(actorId)
	if (!parsed) {
		throw new Error(`Invalid actor id: ${actorId}`)
	}
	return parsed
}

export function parseActorId(actorId: string): ParsedActorId | null {
	if (actorId === DISPATCHER_ACTOR_ID) {
		return base(actorId, 'dispatcher', 'Dispatcher')
	}

	if (actorId === HUMAN_ACTOR_ID) {
		return base(actorId, 'human-outbox', 'Human outbox')
	}

	if (actorId === INTENTS_ACTOR_ID) {
		return base(actorId, 'intents', 'Intents')
	}

	if (actorId === SKILLS_ACTOR_ID) {
		return base(actorId, 'skills', 'Skills')
	}

	const segments = actorId.split('/')
	if (segments[0] === INTENTS_ACTOR_ID && segments.length === 2 && segments[1]) {
		return {
			id: actorId,
			kind: 'intent',
			parentId: INTENTS_ACTOR_ID,
			name: segments[1],
			segments,
			intentId: segments[1]
		}
	}

	if (segments[0] === SKILLS_ACTOR_ID && segments.length === 2 && segments[1]) {
		return {
			id: actorId,
			kind: 'skill-supervisor',
			parentId: SKILLS_ACTOR_ID,
			name: segments[1],
			segments,
			skillId: segments[1]
		}
	}

	if (segments[0] === SKILLS_ACTOR_ID && segments.length >= 3 && segments[1] && segments[2]) {
		const workerId = segments.slice(2).join('/')
		return {
			id: actorId,
			kind: 'skill-worker',
			parentId: createSkillActorId(segments[1]),
			name: workerId,
			segments,
			skillId: segments[1],
			workerId
		}
	}

	return null
}

function base(id: string, kind: CanonicalActorKind, name: string): ParsedActorId {
	return { id, kind, name, segments: [id] }
}