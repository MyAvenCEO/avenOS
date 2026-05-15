import { randomBytes } from 'node:crypto'

const SEGMENT_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export type ActorKind = 'runtime' | 'group' | 'system' | 'intent' | 'skill' | 'worker'

export interface ParsedActorId {
	id: string
	kind: ActorKind
	parentId: string | null
	segments: string[]
	isVirtual: boolean
	name: string
	intentId?: string
	skillId?: string
	workerName?: string
}

export const AVEN_ROOT_ACTOR_ID = 'aven'
export const SYSTEM_ACTOR_ID = 'aven/system'
export const DISPATCHER_ACTOR_ID = 'aven/system/dispatcher'
export const HUMAN_ACTOR_ID = 'aven/system/human'
export const INTENTS_ACTOR_ID = 'aven/intents'
export const SKILLS_ACTOR_ID = 'aven/skills'

export function isSlugSafe(value: string): boolean {
	return SEGMENT_PATTERN.test(value)
}

export function assertActorId(id: string): void {
	parseActorId(id)
}

export function assertCanonicalActorId(id: string): ParsedActorId {
	return parseActorId(id)
}

export function createSystemActorId(name: string): string {
	return `${SYSTEM_ACTOR_ID}/${normalizeSegment(name, 'name')}`
}

export function createIntentActorId(intentId: string): string {
	return `${INTENTS_ACTOR_ID}/${normalizeSegment(intentId, 'intentId')}`
}

export function createSkillActorId(skillId: string): string {
	return `${SKILLS_ACTOR_ID}/${normalizeSegment(skillId, 'skillId')}`
}

export function createWorkerActorId(skillId: string, purpose: string): string {
	const normalizedPurpose = normalizeSegment(purpose, 'purpose')
	return `${createSkillActorId(skillId)}/workers/${normalizedPurpose}-${randomSuffix()}`
}

export function createStableWorkerActorId(skillId: string, workerName: string): string {
	return `${createSkillActorId(skillId)}/workers/${normalizeSegment(workerName, 'workerName')}`
}

export function createSkillWorkerActorId(skillId: string, purpose: string): string {
	return createWorkerActorId(skillId, purpose)
}

export function parentActorId(id: string): string | null {
	return parseActorId(id).parentId
}

export function actorParentIdFromId(id: string): string | undefined {
	return parentActorId(id) ?? undefined
}

export function actorKindFromId(id: string): ActorKind {
	return parseActorId(id).kind
}

export function actorNameFromId(id: string): string {
	return parseActorId(id).name
}

export function actorDepth(id: string): number {
	return Math.max(0, parseActorId(id).segments.length - 1)
}

export function isUnderActorPath(id: string, parent: string): boolean {
	assertActorId(id)
	assertActorId(parent)
	return id === parent || id.startsWith(`${parent}/`)
}

export function parseIntentActorId(actorId: string): string | null {
	const parsed = parseActorId(actorId)
	return parsed.kind === 'intent' ? parsed.intentId ?? null : null
}

export function parseSkillActorId(actorId: string): { skillId: string } | null {
	const parsed = parseActorId(actorId)
	return parsed.kind === 'skill' && parsed.skillId ? { skillId: parsed.skillId } : null
}

export function parseSkillWorkerActorId(actorId: string): { skillId: string; workerName: string } | null {
	const parsed = parseActorId(actorId)
	return parsed.kind === 'worker' && parsed.skillId && parsed.workerName
		? { skillId: parsed.skillId, workerName: parsed.workerName }
		: null
}

export function parseActorId(id: string): ParsedActorId {
	validateActorId(id)
	const segments = id.split('/')

	if (id === AVEN_ROOT_ACTOR_ID) return createParsed(id, 'runtime', null, segments, true, 'aven')
	if (id === SYSTEM_ACTOR_ID) return createParsed(id, 'group', AVEN_ROOT_ACTOR_ID, segments, true, 'system')
	if (id === INTENTS_ACTOR_ID) return createParsed(id, 'group', AVEN_ROOT_ACTOR_ID, segments, true, 'intents')
	if (id === SKILLS_ACTOR_ID) return createParsed(id, 'group', AVEN_ROOT_ACTOR_ID, segments, true, 'skills')
	if (id === DISPATCHER_ACTOR_ID) return createParsed(id, 'system', SYSTEM_ACTOR_ID, segments, false, 'dispatcher')
	if (id === HUMAN_ACTOR_ID) return createParsed(id, 'system', SYSTEM_ACTOR_ID, segments, false, 'human')

	if (segments[1] === 'intents' && segments.length === 3) {
		return createParsed(id, 'intent', INTENTS_ACTOR_ID, segments, false, segments[2], { intentId: segments[2] })
	}

	if (segments[1] === 'skills' && segments.length === 3) {
		return createParsed(id, 'skill', SKILLS_ACTOR_ID, segments, false, segments[2], { skillId: segments[2] })
	}

	if (segments[1] === 'skills' && segments.length === 4 && segments[3] === 'workers') {
		return createParsed(id, 'group', createSkillActorId(segments[2]), segments, true, 'workers', { skillId: segments[2] })
	}

	if (segments[1] === 'skills' && segments.length === 5 && segments[3] === 'workers') {
		return createParsed(id, 'worker', `${createSkillActorId(segments[2])}/workers`, segments, false, segments[4], {
			skillId: segments[2],
			workerName: segments[4]
		})
	}

	throw new Error(`Unsupported actor id: ${id}`)
}

function validateActorId(id: string): void {
	if (typeof id !== 'string' || id.length === 0) throw new Error('Actor id must be a non-empty string')
	if (id.includes('//') || id.startsWith('/') || id.endsWith('/')) throw new Error(`Invalid actor id: ${id}`)
	const segments = id.split('/')
	if (segments[0] !== AVEN_ROOT_ACTOR_ID) throw new Error(`Actor id must be rooted at ${AVEN_ROOT_ACTOR_ID}: ${id}`)
	for (const segment of segments) {
		if (!segment || !isSlugSafe(segment)) throw new Error(`Actor id segment must be lowercase kebab-case: ${id}`)
	}
}

function normalizeSegment(value: string, label: string): string {
	if (typeof value !== 'string' || value.length === 0 || !isSlugSafe(value)) {
		throw new Error(`Invalid ${label}: ${value}`)
	}
	return value
}

function randomSuffix(): string {
	return randomBytes(4).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6)
}

function createParsed(
	id: string,
	kind: ActorKind,
	parentId: string | null,
	segments: string[],
	isVirtual: boolean,
	name: string,
	extra: Partial<ParsedActorId> = {}
): ParsedActorId {
	return { id, kind, parentId, segments, isVirtual, name, ...extra }
}
