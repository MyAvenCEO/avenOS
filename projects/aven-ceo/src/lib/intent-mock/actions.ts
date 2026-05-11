import { mockId } from './id'
import type { HitlTodo, IntentOrchestrator } from './types'

export function upsertIntent(
	list: IntentOrchestrator[],
	next: IntentOrchestrator
): IntentOrchestrator[] {
	const i = list.findIndex((x) => x.id === next.id)
	if (i === -1) return [...list, next]
	const copy = [...list]
	copy[i] = next
	return copy
}

export function toggleIntentDone(list: IntentOrchestrator[], id: string): IntentOrchestrator[] {
	return list.map((it) => (it.id === id ? { ...it, done: !it.done } : it))
}

export function removeIntent(list: IntentOrchestrator[], id: string): IntentOrchestrator[] {
	return list.filter((it) => it.id !== id)
}

export function resolveHitlTodo(
	intent: IntentOrchestrator,
	todoId: string,
	payload:
		| { kind: 'text_reply'; text: string }
		| { kind: 'choice'; optionId: string }
		| { kind: 'approve_reject'; approved: boolean }
): IntentOrchestrator {
	const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
	const todos = intent.hitlTodos.map((t) =>
		t.id === todoId ? { ...t, status: 'done' as const } : t
	)

	let detail = ''
	if (payload.kind === 'text_reply') {
		detail = `Human: ${payload.text}`
	} else if (payload.kind === 'choice') {
		detail = `Selected option: ${payload.optionId}`
	} else {
		detail = payload.approved ? 'Approved' : 'Rejected'
	}

	const activity = [
		...intent.activity,
		{
			id: mockId('act'),
			at: now,
			kind: 'hitl' as const,
			title: 'Human Review completed',
			detail
		},
		{
			id: mockId('act'),
			at: now,
			kind: 'orchestrator' as const,
			title: 'AvenCEO continued the work',
			detail: 'Skills that were waiting can move forward.'
		}
	]

	const subAgents = intent.subAgents.map((saj) =>
		saj.status === 'blocked_hitl'
			? { ...saj, status: 'running' as const, blockedReason: undefined }
			: saj
	)

	return { ...intent, hitlTodos: todos, activity, subAgents }
}

export function openSyntheticHitlForDemo(intent: IntentOrchestrator): IntentOrchestrator {
	const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
	const todo: HitlTodo = {
		id: mockId('hitl'),
		intentId: intent.id,
		type: 'text_reply',
		title: 'Quick check',
		status: 'open',
		createdAt: now,
		question: 'Anything to tighten before we mark this intent done?',
		placeholder: 'Optional note…'
	}
	return {
		...intent,
		hitlTodos: [...intent.hitlTodos, todo],
		activity: [
			...intent.activity,
			{
				id: mockId('act'),
				at: now,
				kind: 'hitl',
				title: 'AvenCEO opened Human Review (demo)',
				detail: 'Example card below — stays in your browser only.'
			}
		]
	}
}
