import type { ActivityItem, IntentOrchestrator, SubAgent } from './types'
import { skillLinesForSubAgent } from './skill-display'
import type { MockInvolvedActor } from './boring-avatar'
import { MOCK_INVOLVED_ACTORS } from './boring-avatar'

/** `all` or one of the five mock actor ids (`MOCK_INVOLVED_ACTORS[].id`). */
export type ActorFilterSelection = 'all' | (typeof MOCK_INVOLVED_ACTORS)[number]['id']

/**
 * Filter activity rows by the selected actor lane (Stream tab).
 * Unknown / orchestrator-side ids map to the lead (first) slot when not a sub-agent id.
 */
export function activityMatchesActorFilter(
	intent: IntentOrchestrator,
	activity: ActivityItem,
	filter: ActorFilterSelection
): boolean {
	if (filter === 'all') return true

	const slot = MOCK_INVOLVED_ACTORS.findIndex((a) => a.id === filter)
	if (slot < 0) return true

	const agentId = activity.agentId

	if (agentId) {
		const subIx = intent.subAgents.findIndex((s) => s.id === agentId)
		if (subIx >= 0) return slot === subIx + 2
		// Orchestrator / system ids — show under “lead” lane only
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

	// Slots 2–4: only rows with that sub-agent’s id match (handled when agentId is set above).
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

/** Short label for the small status pill under each skill name. */
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
 * Five fixed mock faces + live skill names / statuses derived from the current intent.
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
