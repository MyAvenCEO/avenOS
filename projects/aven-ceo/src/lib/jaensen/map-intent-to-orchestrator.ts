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

function summarizeIntentDecision(data: Record<string, unknown>): { title: string; detail?: string } {
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

function mapActivityItem(intent: IntentRecord, event: IntentRecord['events'][number], index: number): ActivityItem {
	if (event.type === 'response_ready') {
		return {
			id: `${intent.id}-activity-${index}`,
			at: new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
			kind: 'orchestrator',
			title: 'Jaensen prepared a reply for the owner',
			detail: typeof event.data.reply === 'string' ? event.data.reply : stringifyContribution(event.data)
		}
	}

	if (event.source === 'skill') {
		const skillId = typeof event.data.skill === 'string' ? event.data.skill : 'skill'
		return {
			id: `${intent.id}-activity-${index}`,
			at: new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
			kind: 'tool',
			title:
				typeof event.data.summary === 'string'
					? event.data.summary
					: `${skillId} reported progress`,
			detail: stringifyContribution(event.data),
			agentId: skillAgentId(intent, skillId)
		}
	}

	if (event.source === 'human') {
		return {
			id: `${intent.id}-activity-${index}`,
			at: new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
			kind: 'human',
			title: 'Human contributed to the case',
			detail: stringifyContribution(event.data)
		}
	}

	if (event.type === 'intent_decision_applied') {
		const summary = summarizeIntentDecision(event.data)
		return {
			id: `${intent.id}-activity-${index}`,
			at: new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
			kind: 'orchestrator',
			title: summary.title,
			detail: summary.detail
		}
	}

	if (event.type === 'input_received') {
		return {
			id: `${intent.id}-activity-${index}`,
			at: new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
			kind: 'human',
			title: typeof event.data.from === 'string' ? `${event.data.from} added a new message` : 'A new message arrived',
			detail: typeof event.data.message === 'string' ? event.data.message : stringifyContribution(event.data)
		}
	}

	return {
		id: `${intent.id}-activity-${index}`,
		at: new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
		kind: event.source === 'system' ? 'orchestrator' : 'human',
		title: event.type,
		detail: stringifyContribution(event.data)
	}
}

function mapActivity(intent: IntentRecord): ActivityItem[] {
	return intent.events.map((event: IntentRecord['events'][number], index: number) =>
		mapActivityItem(intent, event, index)
	)
}

function mapHitl(intent: IntentRecord): HitlTodo[] {
	const todos: HitlTodo[] = []
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

	const latestResponse = [...intent.events].reverse().find((event) => event.type === 'response_ready')
	if (latestResponse && intent.status !== 'resolved') {
		const reply = typeof latestResponse.data.reply === 'string' ? latestResponse.data.reply.trim() : ''
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
	const used = new Set(
		intent.events
			.filter((event: IntentRecord['events'][number]) => event.source === 'skill')
			.map((event: IntentRecord['events'][number]) => String(event.data.skill ?? ''))
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
			status: intent.status === 'resolved' ? 'done' : intent.status === 'pending' ? 'blocked_hitl' : 'idle',
			parentOrchestratorId: intent.id,
			skillId: skill.skillId
		}))
}

function mapToolCalls(intent: IntentRecord): ToolCallStep[] {
	return intent.events
		.filter((event: IntentRecord['events'][number]) => event.source === 'skill')
		.map((event: IntentRecord['events'][number], index: number) => {
			const skillId = typeof event.data.skill === 'string' ? event.data.skill : 'skill'
			return {
				id: `${intent.id}-tool-${index}`,
				agentId: skillAgentId(intent, skillId),
				tool: skillId,
				inputSummary: typeof event.data.summary === 'string' ? event.data.summary : event.type,
				outputSummary: stringifyContribution(event.data),
				status: event.data.ok === false ? 'error' : 'ok'
			}
		})
}

export function mapIntentToOrchestrator(intent: IntentRecord): IntentOrchestrator {
	return {
		id: intent.id,
		title: intent.title,
		summary: intent.summary,
		done: intent.status === 'resolved',
		orchestratorLabel: 'Jaensen Intent',
		subAgents: mapSubAgents(intent),
		activity: mapActivity(intent),
		toolCalls: mapToolCalls(intent),
		hitlTodos: mapHitl(intent),
		config: {
			routingMode: 'select',
			workerClassLabel: 'Jaensen dispatcher',
			notes: `Status: ${intent.status}`
		},
		skills: mapSkills(intent)
	}
}