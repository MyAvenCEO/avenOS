/** User-facing labels for non-technical executives (internal types stay technical). */

import type { ActivityItem, AgentStatus, IntentOrchestrator } from './types'

export const AVENCEO_NAME = 'AvenCEO'

export type IntentSidebarPhase = 'done' | 'human_review' | 'working' | 'open'

export type SkillKanbanColumn = 'open' | 'working' | 'review'

export function subAgentKanbanColumn(status: AgentStatus): SkillKanbanColumn {
	if (status === 'running') return 'working'
	if (status === 'blocked_hitl') return 'review'
	return 'open'
}

export function sidebarIntentPhase(intent: IntentOrchestrator): {
	phase: IntentSidebarPhase
	label: string
} {
	if (intent.done) {
		return { phase: 'done', label: 'Done' }
	}
	const needsYou =
		intent.hitlTodos.some((t) => t.status === 'open') ||
		intent.subAgents.some((s) => s.status === 'blocked_hitl')
	if (needsYou) {
		return { phase: 'human_review', label: 'Human Review' }
	}
	if (intent.subAgents.some((s) => s.status === 'running')) {
		return { phase: 'working', label: 'Working' }
	}
	return { phase: 'open', label: 'Queued' }
}

export function sidebarStatusBadgeClass(phase: IntentSidebarPhase): string {
	switch (phase) {
		case 'done':
			return 'bg-foreground/10 text-foreground/65'
		case 'human_review':
			return 'bg-amber-500/15 text-amber-950 ring-1 ring-amber-500/25'
		case 'working':
			return 'bg-sky-500/10 text-sky-950 ring-1 ring-sky-500/20'
		case 'open':
			return 'bg-foreground/[0.04] text-foreground/55 ring-1 ring-border/55'
	}
}

const STREAM_KIND_LABEL: Record<ActivityItem['kind'], string> = {
	human: 'You',
	orchestrator: AVENCEO_NAME,
	sub_agent: 'Skill',
	delegation: 'Update',
	hitl: 'Human Review',
	tool: 'Progress'
}

export function activityStreamKindLabel(kind: ActivityItem['kind']): string {
	return STREAM_KIND_LABEL[kind]
}

export const KANBAN_COLUMN_HEADING: Record<SkillKanbanColumn, string> = {
	open: 'Open',
	working: 'Working',
	review: 'Review'
}
