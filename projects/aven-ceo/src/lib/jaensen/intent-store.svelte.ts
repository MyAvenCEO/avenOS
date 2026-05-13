import type { ActivityItem, IntentOrchestrator, IntentSkillBinding, SubAgent, ToolCallStep } from '$lib/intent-mock/types'

import { getEvents, getIntent, listIntents, postMessage } from './api'
import { subscribeToScope } from './sse'
import type {
	HumanMessage,
	HumanQuestion,
	IntentDetailDto,
	IntentStatus,
	IntentView,
	PostMessageAttachmentInput,
	StreamEventRecord,
	TimelineItem,
	WorkerView
} from './types'

const ACTIVE_ENVELOPE_EVENT_TYPES = new Set([
	'runtime.envelope.queued',
	'runtime.envelope.claimed',
	'runtime.envelope.completed',
	'runtime.envelope.failed',
	'intent.skill_call_started',
	'intent.skill_call_completed',
	'skill.worker_spawned',
	'skill.worker_routed',
	'skill.worker_completed',
	'actor.event'
])

const STORAGE_PREFIX = 'aven-ceo:jaensen:last-seq:'

function logJaensenError(context: string, error: unknown) {
	console.error(`[aven-ceo][jaensen] ${context}`, error)
}

export class IntentStore {
	intents = $state<Record<string, IntentView>>({})
	orderedIntentIds = $state<string[]>([])
	selectedIntentId = $state<string | null>(null)
	loading = $state(false)
	error = $state<string | null>(null)
	private streams = new Map<string, EventSource>()
	private booted = false

	selectedIntent(): IntentOrchestrator | null {
		return this.selectedIntentId ? toIntentOrchestrator(this.intents[this.selectedIntentId] ?? null) : null
	}

	intentList(): IntentOrchestrator[] {
		return this.orderedIntentIds
			.map((id) => toIntentOrchestrator(this.intents[id] ?? null))
			.filter((value): value is IntentOrchestrator => value !== null)
	}

	async init(): Promise<void> {
		if (this.booted) return
		this.booted = true
		this.loading = true
		this.error = null
		try {
			const summaries = await listIntents()
			const intents = await Promise.all(summaries.map((intent) => this.hydrateIntent(intent.id)))
			this.orderedIntentIds = sortIntentIds(intents)
			if (!this.selectedIntentId) {
				this.selectedIntentId = this.orderedIntentIds[0] ?? null
			}
		} catch (error) {
			logJaensenError('IntentStore.init failed', error)
			this.error = error instanceof Error ? error.message : String(error)
		} finally {
			this.loading = false
		}
	}

	selectIntent(intentId: string | null) {
		this.selectedIntentId = intentId
	}

	removeIntent(intentId: string) {
		this.closeIntentStreams(intentId)
		const next = { ...this.intents }
		delete next[intentId]
		this.intents = next
		this.orderedIntentIds = this.orderedIntentIds.filter((id) => id !== intentId)
		if (this.selectedIntentId === intentId) {
			this.selectedIntentId = this.orderedIntentIds[0] ?? null
		}
	}

	async sendMessage(
		text: string,
		options?: {
			intentIdHint?: string
			attachment?: PostMessageAttachmentInput
			resolvedQuestionId?: string
		}
	) {
		const result = await postMessage({
			text,
			intentIdHint: options?.intentIdHint,
			attachments: options?.attachment ? [options.attachment] : []
		})
		if (options?.intentIdHint && options?.resolvedQuestionId) {
			this.markQuestionResolved(options.intentIdHint, options.resolvedQuestionId)
		}
		this.subscribe(`correlation/${result.correlationId}`)
		return result
	}

	private async hydrateIntent(intentId: string): Promise<IntentView> {
		const snapshot = await getIntent(intentId)
		let state = mergeSnapshot(createEmptyIntentView(intentId), snapshot)
		const scope = `intents/${intentId}`
		// Always replay the full persisted intent event stream when hydrating.
		// `lastSeq` is only safe for resuming live SSE subscriptions; it is not
		// enough to reconstruct derived UI state like timeline/messages after a
		// reload or server restart.
		const events = await getEvents(scope)
		for (const event of events) {
			state = reduceIntentEvent(state, event)
		}
		this.writeIntent(state)
		if (state.status === 'active' || state.status === 'waiting_for_user') {
			this.subscribe(scope)
		}
		return state
	}

	subscribe(scope: string) {
		if (typeof window === 'undefined' || this.streams.has(scope)) return
		const source = subscribeToScope(scope, {
			afterSeq: this.readStoredLastSeq(scope),
			onEvent: (event) => this.apply(event),
			onError: (error) => {
				logJaensenError(`SSE error for scope ${scope}`, error)
			}
		})
		this.streams.set(scope, source)
	}

	apply(event: StreamEventRecord) {
		const payload = toRecord(event.payload)
		const intentId = inferIntentIdFromPayload(payload)
		if (event.type === 'intent.created' && intentId) {
			const current = this.intents[intentId] ?? createEmptyIntentView(intentId)
			const next = reduceIntentEvent(current, event)
			this.writeIntent(next)
			this.subscribe(`intents/${intentId}`)
			this.closeCorrelationScope(event, payload)
			if (!this.selectedIntentId) this.selectedIntentId = intentId
			return
		}

		if (!intentId) {
			return
		}

		const intentScope = `intents/${intentId}`
		if (event.scope.startsWith('correlation/') && this.streams.has(intentScope)) {
			this.closeScope(event.scope)
			return
		}

		const current = this.intents[intentId] ?? createEmptyIntentView(intentId)
		const next = reduceIntentEvent(current, event)
		this.writeIntent(next)
		if (next.status === 'active' || next.status === 'waiting_for_user') {
			this.subscribe(intentScope)
		}
		this.closeCorrelationScope(event, payload)
		if (next.status === 'completed' || next.status === 'failed') {
			this.closeScope(intentScope)
		}
	}

	private writeIntent(intent: IntentView) {
		this.intents = { ...this.intents, [intent.intentId]: intent }
		this.orderedIntentIds = sortIntentIds(Object.values(this.intents))
		for (const [scope, seq] of Object.entries(intent.lastSeqByScope)) {
			this.storeLastSeq(scope, seq)
		}
	}

	private readStoredLastSeq(scope: string): number {
		if (typeof localStorage === 'undefined') return 0
		const raw = localStorage.getItem(`${STORAGE_PREFIX}${scope}`)
		const parsed = Number.parseInt(raw ?? '0', 10)
		return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
	}

	private storeLastSeq(scope: string, seq: number) {
		if (typeof localStorage === 'undefined' || !(seq > 0)) return
		localStorage.setItem(`${STORAGE_PREFIX}${scope}`, String(seq))
	}

	private closeScope(scope: string) {
		const stream = this.streams.get(scope)
		if (!stream) return
		stream.close()
		this.streams.delete(scope)
	}

	private closeIntentStreams(intentId: string) {
		this.closeScope(`intents/${intentId}`)
		for (const scope of [...this.streams.keys()]) {
			if (scope.includes(intentId)) this.closeScope(scope)
		}
	}

	private closeCorrelationScope(event: StreamEventRecord, payload: Record<string, unknown>) {
		if (event.scope.startsWith('correlation/')) {
			this.closeScope(event.scope)
			return
		}
		const correlationId = inferCorrelationIdFromPayload(payload)
		if (!correlationId) return
		this.closeScope(`correlation/${correlationId}`)
	}

	private markQuestionResolved(intentId: string, questionId: string) {
		const intent = this.intents[intentId]
		if (!intent) return
		const nextQuestions = intent.questions.map((question) =>
			question.id === questionId ? { ...question, resolved: true } : question
		)
		if (nextQuestions === intent.questions) return
		this.writeIntent({
			...intent,
			questions: nextQuestions
		})
	}
}

function reduceIntentEvent(state: IntentView, event: StreamEventRecord): IntentView {
	const payload = toRecord(event.payload)
	if (!matchesIntent(state.intentId, payload)) {
		return updateSeq(state, event)
	}

	switch (event.type) {
		case 'intent.created':
		case 'intent.status_changed':
			return applyIntentStatus(updateSeq(state, event), payload, event)
		case 'runtime.envelope.queued':
			return applyRuntimeEnvelopeQueued(updateSeq(state, event), payload, event)
		case 'runtime.envelope.claimed':
			return applyRuntimeEnvelopeClaimed(updateSeq(state, event), payload, event)
		case 'runtime.envelope.completed':
			return applyRuntimeEnvelopeCompleted(updateSeq(state, event), payload, event)
		case 'runtime.envelope.failed':
			return applyRuntimeEnvelopeFailed(updateSeq(state, event), payload, event)
		case 'intent.message_to_user':
			return applyMessageToUser(updateSeq(state, event), payload, event)
		case 'actor.event':
			return applyActorEvent(updateSeq(state, event), payload, event)
		case 'intent.skill_call_started':
			return applySkillCallStarted(updateSeq(state, event), payload, event)
		case 'intent.skill_call_completed':
			return applySkillCallCompleted(updateSeq(state, event), payload, event)
		case 'skill.worker_spawned':
		case 'skill.worker_routed':
			return applyWorker(updateSeq(state, event), payload, event, event.type === 'skill.worker_spawned' ? 'spawned' : 'routed')
		case 'skill.worker_completed':
			return applyWorker(updateSeq(state, event), payload, event, 'completed')
		default:
			return addDebugTimelineItem(updateSeq(state, event), event)
	}
}

function matchesIntent(intentId: string, payload: Record<string, unknown>): boolean {
	const directIntentId = inferIntentIdFromPayload(payload)
	if (directIntentId) return directIntentId === intentId
	const actorId = readString(payload.actorId)
	if (actorId) return actorId === `intents/${intentId}`
	const toActor = readString(payload.toActor)
	if (toActor) return toActor === `intents/${intentId}`
	return false
}

function createEmptyIntentView(intentId: string): IntentView {
	return {
		intentId,
		title: 'Untitled intent',
		status: 'active',
		summary: '',
		lastActiveAt: undefined,
		messages: [],
		questions: [],
		skillCalls: {},
		workers: {},
		timeline: [],
		lastSeqByScope: {}
	}
}

function mergeSnapshot(state: IntentView, snapshot: IntentDetailDto): IntentView {
	const resolvedStatus = normalizeIntentStatus(snapshot.status) ?? state.status
	const next: IntentView = {
		...state,
		title: snapshot.title ?? state.title,
		status: resolvedStatus,
		summary: snapshot.summary ?? state.summary,
		createdAt: snapshot.createdAt ?? state.createdAt,
		updatedAt: snapshot.updatedAt ?? state.updatedAt
	}

	const pending = toRecord(snapshot.pendingSkillCalls)
	for (const [callId, rawCall] of Object.entries(pending)) {
		const call = toRecord(rawCall)
		next.skillCalls[callId] = {
			callId,
			skillId: readString(call.skillId) ?? 'skill',
			request: readString(call.request) ?? '',
			status: 'pending',
			startedAt: readString(call.createdAt) ?? next.updatedAt,
			updatedAt: next.updatedAt,
			metadata: call
		}
	}

	return next
}

function updateSeq(state: IntentView, event: StreamEventRecord): IntentView {
	const nextCorrelationId = inferCorrelationIdFromPayload(toRecord(event.payload)) ?? state.correlationId
	const nextLastActiveAt =
		ACTIVE_ENVELOPE_EVENT_TYPES.has(event.type) && nextCorrelationId ? (event.createdAt ?? state.lastActiveAt) : state.lastActiveAt
	return {
		...state,
		updatedAt: event.createdAt ?? state.updatedAt,
		correlationId: nextCorrelationId,
		lastActiveAt: nextLastActiveAt,
		lastSeqByScope: {
			...state.lastSeqByScope,
			[event.scope]: Math.max(event.seq, state.lastSeqByScope[event.scope] ?? 0)
		}
	}
}

function applyIntentStatus(state: IntentView, payload: Record<string, unknown>, event: StreamEventRecord): IntentView {
	const next = {
		...state,
		title: readString(payload.title) ?? state.title,
		status: normalizeIntentStatus(payload.status) ?? state.status,
		summary: readString(payload.summary) ?? state.summary,
		updatedAt: event.createdAt ?? state.updatedAt
	}
	return appendTimeline(next, {
		id: `${state.intentId}:${event.seq}`,
		seq: event.seq,
		type: event.type,
		title: event.type === 'intent.created' ? 'Intent created' : `Status changed to ${next.status}`,
		detail: next.summary || undefined,
		at: event.createdAt,
		kind: 'intent'
	})
}

function applyMessageToUser(state: IntentView, payload: Record<string, unknown>, event: StreamEventRecord): IntentView {
	const messageType = readString(payload.messageType)
	if (messageType === 'human.question') {
		const questionText = readString(payload.question) ?? readString(payload.message) ?? ''
		const question: HumanQuestion = {
			id: `${state.intentId}:question:${event.seq}`,
			intentId: state.intentId,
			question: questionText,
			createdAt: event.createdAt,
			envelopeId: event.envelopeId,
			resolved: false,
			seq: event.seq
		}
		return appendTimeline({
			...state,
			questions: upsertQuestion(state.questions, question)
		}, {
			id: `${state.intentId}:${event.seq}`,
			seq: event.seq,
			type: event.type,
			title: 'Question for you',
			detail: questionText,
			at: event.createdAt,
			kind: 'question'
		})
	}

	const text = readString(payload.message) ?? ''
	const message: HumanMessage = {
		id: `${state.intentId}:assistant:${event.seq}`,
		intentId: state.intentId,
		role: 'assistant',
		text,
		createdAt: event.createdAt,
		envelopeId: event.envelopeId,
		seq: event.seq
	}
	return appendTimeline({
		...state,
		messages: upsertMessage(state.messages, message)
	}, {
		id: `${state.intentId}:${event.seq}`,
		seq: event.seq,
		type: event.type,
		title: 'Assistant message',
		detail: text,
		at: event.createdAt,
		kind: 'human'
	})
}

function applyActorEvent(state: IntentView, payload: Record<string, unknown>, event: StreamEventRecord): IntentView {
	const nested = toRecord(payload.event)
	const nestedType = readString(nested.type)
	if (nestedType === 'intent.confirmation_requested' || nestedType === 'ask.user') {
		const nestedPayload = toRecord(nested.payload)
		const assistantText =
			readString(nestedPayload.draftMessage) ??
			readString(nestedPayload.message) ??
			readString(nestedPayload.clarification)
		const nextState = assistantText
			? {
				...state,
				messages: upsertMessage(state.messages, {
					id: `${state.intentId}:assistant:${event.seq}`,
					intentId: state.intentId,
					role: 'assistant',
					text: assistantText,
					createdAt: event.createdAt,
					envelopeId: event.envelopeId,
					seq: event.seq
				})
			}
			: state
		const questionText =
			readString(nestedPayload.clarification) ??
			readString(nestedPayload.question) ??
			readString(nestedPayload.message) ??
			''
		if (questionText) {
			const question: HumanQuestion = {
				id: `${state.intentId}:question:${event.seq}`,
				intentId: state.intentId,
				question: questionText,
				createdAt: event.createdAt,
				envelopeId: event.envelopeId,
				resolved: false,
				seq: event.seq
			}
			const withQuestion = {
				...nextState,
				questions: upsertQuestion(nextState.questions, question)
			}
			const withAssistantTimeline = assistantText
				? appendTimeline(withQuestion, {
					id: `${state.intentId}:${event.seq}:assistant`,
					seq: event.seq,
					type: `${event.type}.assistant`,
					title: 'Assistant message',
					detail: assistantText,
					at: event.createdAt,
					kind: 'human'
				})
				: withQuestion
			return appendTimeline(withAssistantTimeline, {
				id: `${state.intentId}:${event.seq}`,
				seq: event.seq,
				type: event.type,
				title: 'Question for you',
				detail: questionText,
				at: event.createdAt,
				kind: 'question'
			})
		}
		if (assistantText) {
			return appendTimeline(nextState, {
				id: `${state.intentId}:${event.seq}:assistant`,
				seq: event.seq,
				type: `${event.type}.assistant`,
				title: 'Assistant message',
				detail: assistantText,
				at: event.createdAt,
				kind: 'human'
			})
		}
	}

	return addDebugTimelineItem(state, event)
}

function applyRuntimeEnvelopeQueued(state: IntentView, payload: Record<string, unknown>, event: StreamEventRecord): IntentView {
	return appendTimeline(state, {
		id: `${state.intentId}:${event.seq}`,
		seq: event.seq,
		type: event.type,
		title: 'Work queued',
		detail: summarizeEnvelopeLifecycle(payload),
		at: event.createdAt,
		actorId: readString(payload.actorId),
		fromActor: readString(payload.fromActor),
		toActor: readString(payload.toActor),
		envelopeId: event.envelopeId,
		kind: 'intent'
	})
}

function applyRuntimeEnvelopeClaimed(state: IntentView, payload: Record<string, unknown>, event: StreamEventRecord): IntentView {
	return appendTimeline(state, {
		id: `${state.intentId}:${event.seq}`,
		seq: event.seq,
		type: event.type,
		title: 'Work started',
		detail: summarizeEnvelopeLifecycle(payload),
		at: event.createdAt,
		actorId: readString(payload.actorId),
		fromActor: readString(payload.fromActor),
		toActor: readString(payload.toActor),
		envelopeId: event.envelopeId,
		kind: 'intent'
	})
}

function applyRuntimeEnvelopeCompleted(state: IntentView, payload: Record<string, unknown>, event: StreamEventRecord): IntentView {
	return appendTimeline(state, {
		id: `${state.intentId}:${event.seq}`,
		seq: event.seq,
		type: event.type,
		title: 'Work completed',
		detail: summarizeEnvelopeLifecycle(payload),
		at: event.createdAt,
		actorId: readString(payload.actorId),
		fromActor: readString(payload.fromActor),
		toActor: readString(payload.toActor),
		envelopeId: event.envelopeId,
		kind: 'intent'
	})
}

function applyRuntimeEnvelopeFailed(state: IntentView, payload: Record<string, unknown>, event: StreamEventRecord): IntentView {
	const failedIntentActor = readString(payload.actorId) === `intents/${state.intentId}`
	const nextState = failedIntentActor
		? {
				...state,
				status: 'failed' as const,
				summary: readString(payload.error) ?? state.summary
			}
		: state
	return appendTimeline(nextState, {
		id: `${state.intentId}:${event.seq}`,
		seq: event.seq,
		type: event.type,
		title: 'Work failed',
		detail: summarizeEnvelopeLifecycle(payload),
		at: event.createdAt,
		actorId: readString(payload.actorId),
		fromActor: readString(payload.fromActor),
		toActor: readString(payload.toActor),
		envelopeId: event.envelopeId,
		kind: 'intent'
	})
}

function applySkillCallStarted(state: IntentView, payload: Record<string, unknown>, event: StreamEventRecord): IntentView {
	const callId = readString(payload.callId) ?? `call-${event.seq}`
	const nextCall = {
		callId,
		skillId: readString(payload.skillId) ?? 'skill',
		request: readString(payload.request) ?? '',
		status: 'pending' as const,
		startedAt: event.createdAt,
		updatedAt: event.createdAt,
		metadata: payload
	}
	return appendTimeline({
		...state,
		skillCalls: { ...state.skillCalls, [callId]: nextCall }
	}, {
		id: `${state.intentId}:${event.seq}`,
		seq: event.seq,
		type: event.type,
		title: `Skill call started · ${nextCall.skillId}`,
		detail: nextCall.request,
		at: event.createdAt,
		kind: 'skill_call'
	})
}

function applySkillCallCompleted(state: IntentView, payload: Record<string, unknown>, event: StreamEventRecord): IntentView {
	const callId = readString(payload.callId) ?? inferLatestCallId(state.skillCalls)
	if (!callId) {
		return addDebugTimelineItem(state, event)
	}
	const current = state.skillCalls[callId]
	const messageType = readString(payload.messageType)
	const status =
		messageType === 'skill.failed'
			? 'failed'
			: messageType === 'skill.needs_clarification'
				? 'needs_clarification'
				: 'completed'
		
	return appendTimeline({
		...state,
		skillCalls: {
			...state.skillCalls,
			[callId]: {
				callId,
				skillId: readString(payload.skillId) ?? current?.skillId ?? 'skill',
				request: current?.request ?? readString(payload.request) ?? '',
				status,
				startedAt: current?.startedAt,
				updatedAt: event.createdAt,
				resultSummary: summarizePayload(payload),
				metadata: payload
			}
		}
	}, {
		id: `${state.intentId}:${event.seq}`,
		seq: event.seq,
		type: event.type,
		title: `Skill call ${status.replace('_', ' ')}${current?.skillId ? ` · ${current.skillId}` : ''}`,
		detail: summarizePayload(payload),
		at: event.createdAt,
		kind: 'skill_call'
	})
}

function applyWorker(
	state: IntentView,
	payload: Record<string, unknown>,
	event: StreamEventRecord,
	status: WorkerView['status']
): IntentView {
	const workerId = readString(payload.workerId) ?? readString(payload.workerActorId) ?? `worker-${event.seq}`
	const existing = state.workers[workerId]
	return appendTimeline({
		...state,
		workers: {
			...state.workers,
			[workerId]: {
				workerId,
				skillId: readString(payload.skillId) ?? existing?.skillId,
				workerActorId: readString(payload.workerActorId) ?? existing?.workerActorId,
				status,
				startedAt: existing?.startedAt ?? event.createdAt,
				updatedAt: event.createdAt,
				metadata: payload
			}
		}
	}, {
		id: `${state.intentId}:${event.seq}`,
		seq: event.seq,
		type: event.type,
		title: `Worker ${status}`,
		detail: summarizePayload(payload),
		at: event.createdAt,
		kind: 'worker'
	})
}

function addDebugTimelineItem(state: IntentView, event: StreamEventRecord): IntentView {
	return appendTimeline(state, {
		id: `${state.intentId}:${event.seq}`,
		seq: event.seq,
		type: event.type,
		title: event.type,
		detail: summarizePayload(toRecord(event.payload)),
		at: event.createdAt,
		kind: 'debug'
	})
}

function appendTimeline(state: IntentView, item: TimelineItem): IntentView {
	if (state.timeline.some((existing) => existing.seq === item.seq && existing.type === item.type)) {
		return state
	}
	return {
		...state,
		timeline: [...state.timeline, item].sort((a, b) => a.seq - b.seq)
	}
}

function upsertMessage(messages: HumanMessage[], next: HumanMessage): HumanMessage[] {
	return [...messages.filter((message) => message.id !== next.id), next].sort(bySeqThenDate)
}

function upsertQuestion(questions: HumanQuestion[], next: HumanQuestion): HumanQuestion[] {
	return [...questions.filter((question) => question.id !== next.id), next].sort(bySeqThenDate)
}

function bySeqThenDate(a: { seq?: number; createdAt?: string }, b: { seq?: number; createdAt?: string }) {
	const seqDiff = (a.seq ?? 0) - (b.seq ?? 0)
	if (seqDiff !== 0) return seqDiff
	return (a.createdAt ?? '').localeCompare(b.createdAt ?? '')
}

function toIntentOrchestrator(intent: IntentView | null): IntentOrchestrator | null {
	if (!intent) return null
	const skills = buildSkills(intent)
	const subAgents = buildSubAgents(intent)
	return {
		id: intent.intentId,
		title: intent.title,
		summary: intent.summary,
		done: intent.status === 'completed',
		isActivelyWorkedOn: isIntentActivelyWorkedOn(intent),
		lastActiveAt: intent.lastActiveAt,
		orchestratorLabel: 'Jaensen Intent',
		subAgents,
		activity: buildActivity(intent, subAgents, skills),
		toolCalls: buildToolCalls(intent),
		hitlTodos: intent.questions
			.filter((question) => !question.resolved)
			.map((question) => ({
				id: question.id,
				intentId: intent.intentId,
				title: 'Reply to continue',
				status: 'open' as const,
				createdAt: question.createdAt ?? new Date().toISOString(),
				type: 'text_reply' as const,
				question: question.question,
				placeholder: 'Tell AvenCEO what to do next…'
			})),
		config: {
			routingMode: 'select',
			workerClassLabel: 'web-api dispatcher',
			notes: `Status: ${intent.status}`
		},
		skills
	}
}

function buildSkills(intent: IntentView): IntentSkillBinding[] {
	const ids = new Set<string>()
	for (const call of Object.values(intent.skillCalls)) ids.add(call.skillId)
	for (const worker of Object.values(intent.workers)) if (worker.skillId) ids.add(worker.skillId)
	return [...ids].sort().map((skillId) => ({
		skillId,
		name: skillId,
		bound: true
	}))
}

function buildSubAgents(intent: IntentView): SubAgent[] {
	return Object.values(intent.workers)
		.sort((a, b) => (a.startedAt ?? '').localeCompare(b.startedAt ?? ''))
		.map((worker) => ({
			id: worker.workerId,
			name: worker.workerActorId ?? worker.workerId,
			role: worker.skillId ? `${worker.skillId} worker` : 'Worker',
			status:
				worker.status === 'completed'
					? 'done'
					: intent.status === 'waiting_for_user'
						? 'blocked_hitl'
						: 'running',
			parentOrchestratorId: intent.intentId,
			blockedReason: intent.status === 'waiting_for_user' ? 'Waiting for your reply' : undefined,
			skillId: worker.skillId
		}))
}

function buildActivity(
	intent: IntentView,
	subAgents: SubAgent[],
	skills: IntentSkillBinding[]
): ActivityItem[] {
	return intent.timeline.map((item) => ({
		id: item.id,
		at: formatTime(item.at),
		kind: mapTimelineKind(item.kind),
		title: item.title,
		detail: item.detail,
		agentId: resolveAgentId(item, subAgents, skills),
		actorIds: extractActorIds(item, intent.intentId, subAgents)
	}))
}

function extractActorIds(item: TimelineItem, intentId: string, subAgents: SubAgent[]): string[] {
	const values = [item.actorId, item.fromActor, item.toActor].filter(
		(value): value is string => typeof value === 'string' && value.length > 0
	)
	if (item.kind === 'question' || item.kind === 'human') {
		values.push(`intents/${intentId}`)
	}
	const agentId = resolveAgentId(item, subAgents, [])
	if (agentId) values.push(agentId)
	return [...new Set(values)]
}

function buildToolCalls(intent: IntentView): ToolCallStep[] {
	return Object.values(intent.skillCalls)
		.map((call) => ({
			id: `${intent.intentId}:${call.callId}`,
			agentId: findWorkerAgentId(intent, call.skillId) ?? call.callId,
			tool: call.skillId,
			inputSummary: call.request,
			outputSummary: call.resultSummary,
			status: call.status === 'failed' ? 'error' : call.status === 'pending' ? 'pending' : 'ok'
		}))
		.sort((a, b) => a.id.localeCompare(b.id))
}

function resolveAgentId(item: TimelineItem, subAgents: SubAgent[], skills: IntentSkillBinding[]): string | undefined {
	if (item.kind !== 'skill_call' && item.kind !== 'worker') return undefined
	const detail = item.detail ?? ''
	for (const subAgent of subAgents) {
		if (detail.includes(subAgent.id) || detail.includes(subAgent.skillId ?? '')) {
			return subAgent.id
		}
	}
	for (const skill of skills) {
		if (detail.includes(skill.skillId)) {
			return subAgents.find((subAgent) => subAgent.skillId === skill.skillId)?.id
		}
	}
	return undefined
}

function findWorkerAgentId(intent: IntentView, skillId: string): string | undefined {
	return Object.values(intent.workers).find((worker) => worker.skillId === skillId)?.workerId
}

function mapTimelineKind(kind: TimelineItem['kind']): ActivityItem['kind'] {
	switch (kind) {
		case 'human':
			return 'human'
		case 'question':
			return 'hitl'
		case 'intent':
			return 'orchestrator'
		case 'skill_call':
			return 'tool'
		case 'worker':
			return 'sub_agent'
		default:
			return 'delegation'
	}
}

function formatTime(value?: string): string {
	if (!value) return '--:--'
	return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function normalizeIntentStatus(status: unknown): IntentStatus | null {
	return status === 'active' || status === 'waiting_for_user' || status === 'completed' || status === 'failed'
		? status
		: null
}

function inferLatestCallId(skillCalls: Record<string, { callId: string; updatedAt?: string }>): string | null {
	const latest = Object.values(skillCalls).sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))[0]
	return latest?.callId ?? null
}

function sortIntentIds(intents: Array<IntentView | undefined>): string[] {
	return intents
		.filter((intent): intent is IntentView => Boolean(intent))
		.sort((a, b) => (b.updatedAt ?? b.createdAt ?? '').localeCompare(a.updatedAt ?? a.createdAt ?? ''))
		.map((intent) => intent.intentId)
}

function summarizePayload(payload: Record<string, unknown>): string | undefined {
	const result = readString(payload.request) ?? readString(payload.message) ?? readString(payload.question)
	if (result) return result
	try {
		return JSON.stringify(payload)
	} catch {
		return undefined
	}
}

function summarizeEnvelopeLifecycle(payload: Record<string, unknown>): string | undefined {
	const error = readString(payload.error)
	if (error) return error

	const envelopeType = readString(payload.envelopeType)
	const workerId = readString(payload.workerId)
	const attempts = typeof payload.attempts === 'number' ? payload.attempts : undefined
	const parts = [
		envelopeType ? `Type: ${envelopeType}` : null,
		workerId ? `Worker: ${workerId}` : null,
		attempts !== undefined ? `Attempt ${attempts}` : null
	].filter((value): value is string => Boolean(value))

	return parts.length > 0 ? parts.join(' · ') : summarizePayload(payload)
}

function inferIntentIdFromPayload(payload: Record<string, unknown>): string | undefined {
	const queue: Array<{ value: Record<string, unknown>; depth: number }> = [{ value: payload, depth: 0 }]
	const seen = new WeakSet<Record<string, unknown>>()
	let inspected = 0
	const MAX_DEPTH = 6
	const MAX_OBJECTS = 64

	while (queue.length > 0) {
		const current = queue.shift()
		if (!current) break
		const { value, depth } = current
		if (seen.has(value)) continue
		seen.add(value)
		inspected += 1
		if (inspected > MAX_OBJECTS) break

		const direct = readString(value.intentId)
		if (direct) return direct

		for (const key of ['actorId', 'toActor', 'fromActor'] as const) {
			const actorRef = readString(value[key])
			if (actorRef?.startsWith('intents/')) {
				return actorRef.slice('intents/'.length)
			}
		}

		if (depth >= MAX_DEPTH) continue

		for (const key of ['event', 'input', 'result', 'call', 'payload'] as const) {
			const nested = value[key]
			if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
				queue.push({ value: nested as Record<string, unknown>, depth: depth + 1 })
			}
		}
	}

	return undefined
}

function inferCorrelationIdFromPayload(payload: Record<string, unknown>): string | undefined {
	const queue: Array<{ value: Record<string, unknown>; depth: number }> = [{ value: payload, depth: 0 }]
	const seen = new WeakSet<Record<string, unknown>>()
	let inspected = 0
	const MAX_DEPTH = 6
	const MAX_OBJECTS = 64

	while (queue.length > 0) {
		const current = queue.shift()
		if (!current) break
		const { value, depth } = current
		if (seen.has(value)) continue
		seen.add(value)
		inspected += 1
		if (inspected > MAX_OBJECTS) break

		const direct = readString(value.correlationId)
		if (direct) return direct

		if (depth >= MAX_DEPTH) continue

		for (const key of ['event', 'input', 'result', 'call', 'payload'] as const) {
			const nested = value[key]
			if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
				queue.push({ value: nested as Record<string, unknown>, depth: depth + 1 })
			}
		}
	}

	return undefined
}

function isIntentActivelyWorkedOn(intent: IntentView, now = Date.now()): boolean {
	if (intent.status !== 'active') return false
	if (!intent.correlationId || !intent.lastActiveAt) return false
	const activeAt = Date.parse(intent.lastActiveAt)
	if (!Number.isFinite(activeAt)) return false
	return now - activeAt < 60_000
}

function toRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function readString(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined
}