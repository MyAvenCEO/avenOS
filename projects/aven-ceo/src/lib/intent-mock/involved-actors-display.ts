import type { ActivityItem, IntentOrchestrator, SubAgent } from './types'
import { skillLinesForSubAgent } from './skill-display'
import type { ActorTier } from './boring-avatar'

export type InvolvedActorId = string

export type InvolvedActorDisplayRow = {
	id: InvolvedActorId
	label: string
	skillName: string
	tier: ActorTier
	status: SubAgent['status'] | 'orchestrating'
	runtimeActorIds: string[]
}

/**
 * Filter activity rows for the Overview log (skill-scoped).
 * Slot index aligns with {@link MOCK_INVOLVED_ACTORS} order.
 */
export function activityMatchesActorFilter(
	intent: IntentOrchestrator,
	activity: ActivityItem,
	actorId: InvolvedActorId
): boolean {
	const row = actorSelectionRowForId(intent, actorId)
	if (!row) return true
	if (activity.actorIds?.some((id) => row.runtimeActorIds.includes(id))) return true
	if (activity.agentId && row.runtimeActorIds.includes(activity.agentId)) return true
	if (row.id === `intents/${intent.id}`) {
		return activity.kind === 'orchestrator' || activity.kind === 'human' || activity.kind === 'hitl'
	}
	if (row.id === 'dispatcher') {
		return activity.kind === 'delegation'
	}
	return false
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
	const rows: InvolvedActorDisplayRow[] = [
		{
			id: `intents/${intent.id}`,
			label: 'Intent',
			skillName: intent.orchestratorLabel,
			tier: 'orchestrator',
			status: statusForOrchestrator(intent),
			runtimeActorIds: [`intents/${intent.id}`]
		},
		{
			id: 'dispatcher',
			label: 'Dispatcher',
			skillName: 'Dispatch',
			tier: 'supervisor',
			status: intent.done ? 'done' : 'running',
			runtimeActorIds: ['dispatcher']
		}
	]

	for (const sub of intent.subAgents) {
		const lines = skillLinesForSubAgent(sub, intent.skills)
		rows.push({
			id: sub.id,
			label: sub.name,
			skillName: lines.primary,
			tier: 'worker',
			status: sub.status,
			runtimeActorIds: [sub.name, sub.id].filter((value, index, all) => value.length > 0 && all.indexOf(value) === index)
		})
	}

	const known = new Set(rows.flatMap((row) => row.runtimeActorIds))
	for (const activity of intent.activity) {
		for (const actorRef of activity.actorIds ?? []) {
			if (known.has(actorRef) || actorRef === `intents/${intent.id}`) continue
			known.add(actorRef)
			rows.push({
				id: actorRef,
				label: actorRef,
				skillName: prettifyActorLabel(actorRef),
				tier: actorRef === 'dispatcher' ? 'supervisor' : 'worker',
				status: 'running',
				runtimeActorIds: [actorRef]
			})
		}
	}

	return rows
}

export function runtimeActorIdsForSelection(intent: IntentOrchestrator, actorId: InvolvedActorId): string[] {
	return actorSelectionRowForId(intent, actorId)?.runtimeActorIds ?? []
}

export function actorSelectionRowForId(
	intent: IntentOrchestrator,
	actorId: InvolvedActorId
): InvolvedActorDisplayRow | undefined {
	return involvedActorsForIntent(intent).find((row) => row.id === actorId)
}

function prettifyActorLabel(actorId: string): string {
	return actorId
		.replace(/^intent\//, 'Intent ')
		.replaceAll(/[-_]/g, ' ')
		.trim()
}
