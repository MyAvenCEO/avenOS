import type { IntentRecord } from '@avenos/jaensen-bot'
import type {
	ActivityItem,
	HitlTodo,
	IntentOrchestrator,
	IntentSkillBinding,
	SubAgent,
	ToolCallStep
} from '$lib/intent-mock/types'

function skillAgentId(intent: IntentRecord, skillId: string): string {
	return `${intent.id}-${skillId}`
}

function stringifyContribution(value: unknown): string | undefined {
	if (typeof value === 'string') return value
	if (value === null || value === undefined) return undefined
	try {
		return JSON.stringify(value)
	} catch {
		return String(value)
	}
}

function summarizeIntentDecision(data: Record<string, unknown>): {
	title: string
	detail?: string
} {
	const actions = Array.isArray(data.actions) ? data.actions : []
	const skillResults = Array.isArray(data.skillResults) ? data.skillResults : []
	if (actions.length === 0 && skillResults.length === 0) {
		return {
			title: 'Intent reviewed the request and kept the case moving',
			detail: 'No concrete skill action was recorded for this step.'
		}
	}

	const actionSummary = actions
		.map((action) => {
			if (!action || typeof action !== 'object') return null
			const record = action as Record<string, unknown>
			return `${String(record.skill ?? 'unknown')}.${String(record.operation ?? 'step')}`
		})
		.filter(Boolean)
		.join(', ')

	const resultSummary = skillResults
		.map((result) => {
			if (!result || typeof result !== 'object') return null
			const record = result as Record<string, unknown>
			return stringifyContribution(record.summary)
		})
		.filter(Boolean)
		.join(' · ')

	return {
		title: actionSummary
			? `Intent selected the next actions: ${actionSummary}`
			: 'Intent applied the latest decision',
		detail: resultSummary || undefined
	}
}

function mapActivityItem(
	intent: IntentRecord,
	event: IntentRecord['events'][number],
	index: number
): ActivityItem {
	const data = event.data && typeof event.data === 'object' ? event.data : {}
	const at = (() => {
		try {
			return new Date(event.timestamp).toLocaleTimeString([], {
				hour: '2-digit',
				minute: '2-digit'
			})
		} catch {
			return '--:--'
		}
	})()

	if (event.type === 'response_ready') {
		return {
			id: `${intent.id}-activity-${index}`,
			at,
			kind: 'orchestrator',
			title: 'Jaensen prepared a reply for the owner',
			detail: typeof data.reply === 'string' ? data.reply : stringifyContribution(data)
		}
	}

	if (event.source === 'skill') {
		const skillId = typeof data.skill === 'string' ? data.skill : 'skill'
		return {
			id: `${intent.id}-activity-${index}`,
			at,
			kind: 'tool',
			title: typeof data.summary === 'string' ? data.summary : `${skillId} reported progress`,
			detail: stringifyContribution(data),
			agentId: skillAgentId(intent, skillId)
		}
	}

	if (event.source === 'human') {
		return {
			id: `${intent.id}-activity-${index}`,
			at,
			kind: 'human',
			title: 'Human contributed to the case',
			detail: stringifyContribution(data)
		}
	}

	if (event.type === 'intent_decision_applied') {
		const summary = summarizeIntentDecision(data as Record<string, unknown>)
		return {
			id: `${intent.id}-activity-${index}`,
			at,
			kind: 'orchestrator',
			title: summary.title,
			detail: summary.detail
		}
	}

	if (event.type === 'input_received') {
		return {
			id: `${intent.id}-activity-${index}`,
			at,
			kind: 'human',
			title:
				typeof data.from === 'string'
					? `${data.from} added a new message`
					: 'A new message arrived',
			detail: typeof data.message === 'string' ? data.message : stringifyContribution(data)
		}
	}

	return {
		id: `${intent.id}-activity-${index}`,
		at,
		kind: event.source === 'system' ? 'orchestrator' : 'human',
		title: event.type,
		detail: stringifyContribution(data)
	}
}

function mapActivity(intent: IntentRecord): ActivityItem[] {
	const events = Array.isArray(intent.events) ? intent.events : []
	return events.map((event: IntentRecord['events'][number], index: number) =>
		mapActivityItem(intent, event, index)
	)
}

function mapHitl(intent: IntentRecord): HitlTodo[] {
	const todos: HitlTodo[] = []
	const events = Array.isArray(intent.events) ? intent.events : []
	if (intent.humanLoop?.needed) {
		todos.push({
			id: `${intent.id}-human-loop`,
			intentId: intent.id,
			title: intent.humanLoop.reason || 'Human review required',
			status: 'open',
			createdAt: intent.updatedAt,
			type: 'approve_reject',
			summary: intent.humanLoop.message || intent.summary
		})
	}

	const latestResponse = [...events].reverse().find((event) => event.type === 'response_ready')
	if (latestResponse && intent.status !== 'resolved') {
		const replyData =
			latestResponse.data && typeof latestResponse.data === 'object' ? latestResponse.data : {}
		const reply = typeof replyData.reply === 'string' ? replyData.reply.trim() : ''
		todos.push({
			id: `${intent.id}-owner-follow-up`,
			intentId: intent.id,
			title: 'Reply to Jaensen',
			status: 'open',
			createdAt: latestResponse.timestamp,
			type: 'text_reply',
			question: reply || intent.summary,
			placeholder: 'Tell Jaensen the next step…'
		})
	}

	return todos
}

function mapSkills(intent: IntentRecord): IntentSkillBinding[] {
	const events = Array.isArray(intent.events) ? intent.events : []
	const used = new Set(
		events
			.filter((event: IntentRecord['events'][number]) => event.source === 'skill')
			.map((event: IntentRecord['events'][number]) => {
				const d = event.data && typeof event.data === 'object' ? event.data : {}
				return String((d as Record<string, unknown>).skill ?? '')
			})
			.filter(Boolean)
	)
	const all: Array<IntentSkillBinding> = [
		{ skillId: 'memory', name: 'Memory', bound: used.has('memory') || true },
		{ skillId: 'ingest', name: 'Ingest', bound: used.has('ingest') },
		{ skillId: 'extract', name: 'Extract', bound: used.has('extract') }
	]
	return all
}

function mapSubAgents(intent: IntentRecord): SubAgent[] {
	return mapSkills(intent)
		.filter((skill) => skill.bound)
		.map((skill) => ({
			id: skillAgentId(intent, skill.skillId),
			name: `${skill.name} Worker`,
			role: `${skill.name} execution`,
			status:
				intent.status === 'resolved'
					? 'done'
					: intent.status === 'pending'
						? 'blocked_hitl'
						: 'idle',
			parentOrchestratorId: intent.id,
			skillId: skill.skillId
		}))
}

function mapToolCalls(intent: IntentRecord): ToolCallStep[] {
	const events = Array.isArray(intent.events) ? intent.events : []
	return events
		.filter((event: IntentRecord['events'][number]) => event.source === 'skill')
		.map((event: IntentRecord['events'][number], index: number) => {
			const d = event.data && typeof event.data === 'object' ? event.data : {}
			const skillId =
				typeof (d as Record<string, unknown>).skill === 'string'
					? (d as { skill: string }).skill
					: 'skill'
			return {
				id: `${intent.id}-tool-${index}`,
				agentId: skillAgentId(intent, skillId),
				tool: skillId,
				inputSummary:
					typeof (d as Record<string, unknown>).summary === 'string'
						? (d as { summary: string }).summary
						: event.type,
				outputSummary: stringifyContribution(d),
				status: (d as Record<string, unknown>).ok === false ? 'error' : 'ok'
			}
		})
}

export function mapIntentToOrchestrator(intent: IntentRecord): IntentOrchestrator {
	const events = Array.isArray(intent.events) ? intent.events : []
	const title = intent.title?.trim() || 'Untitled'
	const summary = (intent.summary?.trim() || title).slice(0, 2000)
	const status =
		intent.status === 'resolved' || intent.status === 'pending' || intent.status === 'active'
			? intent.status
			: 'active'
	const safe: IntentRecord = {
		...intent,
		id: String(intent.id ?? 'unknown'),
		title,
		summary,
		status,
		createdAt: intent.createdAt ?? new Date().toISOString(),
		updatedAt: intent.updatedAt ?? new Date().toISOString(),
		events,
		context: intent.context && typeof intent.context === 'object' ? intent.context : {}
	}

	return {
		id: safe.id,
		title: safe.title,
		summary,
		done: safe.status === 'resolved',
		orchestratorLabel: 'Jaensen Intent',
		subAgents: mapSubAgents(safe),
		activity: mapActivity(safe),
		toolCalls: mapToolCalls(safe),
		hitlTodos: mapHitl(safe),
		config: {
			routingMode: 'select',
			workerClassLabel: 'Jaensen dispatcher',
			notes: `Status: ${safe.status}`
		},
		skills: mapSkills(safe)
	}
}
