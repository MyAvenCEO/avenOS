import type { EventRecord } from './types'

const EVENT_TYPES = [
	'intent.created',
	'intent.status_changed',
	'intent.skill_call_started',
	'intent.skill_call_completed',
	'intent.message_to_user',
	'skill.worker_spawned',
	'skill.worker_routed',
	'skill.worker_completed',
	'runtime.envelope.completed',
	'runtime.envelope.queued',
	'runtime.envelope.claimed',
	'runtime.envelope.failed',
	'actor.event',
	'context.appended'
] as const

export function subscribeToEvents(
	filters: {
		runId?: string
		intentId?: string
		actorId?: string
		callId?: string
		visibility?: 'chat' | 'worklog' | 'debug'
	},
	options: {
		afterSeq?: number
		onEvent: (event: EventRecord) => void
		onError?: (error: Event) => void
	}
): EventSource {
	const url = new URL('/api/aven/jaensen/events/stream', window.location.origin)
	if (filters.runId) url.searchParams.set('runId', filters.runId)
	if (filters.intentId) url.searchParams.set('intentId', filters.intentId)
	if (filters.actorId) url.searchParams.set('actorId', filters.actorId)
	if (filters.callId) url.searchParams.set('callId', filters.callId)
	if (filters.visibility) url.searchParams.set('visibility', filters.visibility)
	if (options.afterSeq && options.afterSeq > 0) {
		url.searchParams.set('after', String(options.afterSeq))
	}

	const source = new EventSource(url)
	for (const type of EVENT_TYPES) {
		source.addEventListener(type, (raw) => {
			const event = raw as MessageEvent<string>
			const parsed = JSON.parse(event.data) as
				| EventRecord
				| { payload?: unknown; createdAt?: string; envelopeId?: string | null; seq?: number; type?: string; visibility?: 'chat' | 'worklog' | 'debug'; runId?: string | null; intentId?: string | null; actorId?: string | null; callId?: string | null; parentSeq?: number | null }
			options.onEvent({
				seq:
					typeof parsed?.seq === 'number'
						? parsed.seq
						: Number.parseInt(event.lastEventId || '0', 10) || 0,
				type: typeof parsed?.type === 'string' ? parsed.type : type,
				visibility: parsed?.visibility ?? 'worklog',
				runId: parsed?.runId ?? null,
				intentId: parsed?.intentId ?? null,
				actorId: parsed?.actorId ?? null,
				payload: 'payload' in parsed ? parsed.payload : parsed,
				createdAt: typeof parsed?.createdAt === 'string' ? parsed.createdAt : new Date().toISOString(),
				envelopeId:
					typeof parsed?.envelopeId === 'string' || parsed?.envelopeId === null
						? parsed.envelopeId
						: null,
				callId: parsed?.callId ?? null,
				parentSeq: parsed?.parentSeq ?? null
			})
		})
	}
	source.onerror = (error) => options.onError?.(error)
	return source
}