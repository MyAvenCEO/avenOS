import type { ActivityItem, IntentOrchestrator, SubAgent } from './types'
import { skillLinesForSubAgent } from './skill-display'
import type { MockInvolvedActor } from './boring-avatar'
import { MOCK_INVOLVED_ACTORS } from './boring-avatar'

export type InvolvedActorId = (typeof MOCK_INVOLVED_ACTORS)[number]['id']

/**
 * Filter activity rows for the Overview log (skill-scoped).
 * Slot index aligns with {@link MOCK_INVOLVED_ACTORS} order.
 */
export function activityMatchesActorFilter(
	intent: IntentOrchestrator,
	activity: ActivityItem,
	actorId: InvolvedActorId
): boolean {
	const slot = MOCK_INVOLVED_ACTORS.findIndex((a) => a.id === actorId)
	if (slot < 0) return true

	const agentId = activity.agentId

	if (agentId) {
		const subIx = intent.subAgents.findIndex((s) => s.id === agentId)
		if (subIx >= 0) return slot === subIx + 2
		return slot === 0
	}

	if (slot === 0) {
		return (
			activity.kind === 'orchestrator' ||
			activity.kind === 'human' ||
			activity.kind === 'hitl' ||
			activity.kind === 'sub_agent' ||
			activity.kind === 'tool'
		)
	}

	if (slot === 1) {
		return activity.kind === 'delegation'
	}

	return false
}

export type InvolvedActorDisplayRow = {
	actor: MockInvolvedActor
	skillName: string
	status: SubAgent['status'] | 'orchestrating'
}

function statusForOrchestrator(intent: IntentOrchestrator): InvolvedActorDisplayRow['status'] {
	if (intent.done) return 'done'
	return 'orchestrating'
}

/** Short label for the small status pill under each actor name. */
export function statusBadgeLabel(status: InvolvedActorDisplayRow['status']): string {
	switch (status) {
		case 'orchestrating':
			return 'Leading'
		case 'idle':
			return 'Idle'
		case 'running':
			return 'Running'
		case 'blocked_hitl':
			return 'Blocked'
		case 'done':
			return 'Done'
		default:
			return 'Idle'
	}
}

/**
 * Mock faces + live skill names / statuses derived from the current intent.
 * Order: AvenCEO → supervisor(s) → workers (see {@link MOCK_INVOLVED_ACTORS} tiers).
 */
export function involvedActorsForIntent(intent: IntentOrchestrator): InvolvedActorDisplayRow[] {
	const sa = intent.subAgents
	const skills = intent.skills

	return MOCK_INVOLVED_ACTORS.map((actor, i): InvolvedActorDisplayRow => {
		if (i === 0) {
			return {
				actor,
				skillName: intent.orchestratorLabel,
				status: statusForOrchestrator(intent)
			}
		}
		if (i === 1) {
			return {
				actor,
				skillName: 'Dispatch',
				status: intent.done ? 'done' : 'running'
			}
		}
		const subIndex = i - 2
		const sub = sa[subIndex]
		if (sub) {
			const lines = skillLinesForSubAgent(sub, skills)
			return { actor, skillName: lines.primary, status: sub.status }
		}
		return {
			actor,
			skillName: actor.label,
			status: 'idle'
		}
	})
}

export function runtimeActorIdsForSelection(intent: IntentOrchestrator, actorId: InvolvedActorId): string[] {
	const slot = MOCK_INVOLVED_ACTORS.findIndex((actor) => actor.id === actorId)
	if (slot < 0) return []
	if (slot === 0) return [`intent/${intent.id}`]
	if (slot === 1) return ['dispatcher']
	const sub = intent.subAgents[slot - 2]
	if (!sub) return []
	return [sub.name, sub.id].filter((value, index, all) => value.length > 0 && all.indexOf(value) === index)
}
