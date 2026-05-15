import type {
	ActorDetailDto,
	EnvelopeDto,
	EnvelopeListResponse,
	ContextItemsResponse,
	EventListResponse,
	EventRecord,
	IntentActorNode,
	IntentActorsResponse,
	IntentDetailDto,
	IntentSummaryDto,
	PostMessageInput,
	PostMessageResult
} from './types'

async function expectJson<T>(response: Response): Promise<T> {
	if (!response.ok) {
		let message = `Request failed (${response.status})`
		const body = (await response.json().catch(() => null)) as { error?: string } | null
		if (body?.error) {
			message = body.error
		}
		const error = new Error(message)
		console.error('[aven-ceo][jaensen][api] request failed', {
			status: response.status,
			statusText: response.statusText,
			message,
			url: response.url
		})
		throw error
	}
	return (await response.json()) as T
}

export async function postMessage(input: PostMessageInput): Promise<PostMessageResult> {
	const response = await fetch('/api/aven/jaensen/messages', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(input)
	})
	return expectJson<PostMessageResult>(response)
}

export async function listIntents(): Promise<IntentSummaryDto[]> {
	const response = await fetch('/api/aven/jaensen/intents')
	const body = await expectJson<{ intents: IntentSummaryDto[] }>(response)
	return body.intents
}

export async function getIntent(intentId: string): Promise<IntentDetailDto> {
	const response = await fetch(`/api/aven/jaensen/intents/${encodeURIComponent(intentId)}`)
	return expectJson<IntentDetailDto>(response)
}

export async function getEvents(input: {
	after?: number
	runId?: string
	intentId?: string
	actorId?: string
	callId?: string
	visibility?: 'chat' | 'worklog' | 'debug'
}): Promise<EventRecord[]> {
	const url = new URL('/api/aven/jaensen/events', window.location.origin)
	if (input.after && input.after > 0) {
		url.searchParams.set('after', String(input.after))
	}
	if (input.runId) url.searchParams.set('runId', input.runId)
	if (input.intentId) url.searchParams.set('intentId', input.intentId)
	if (input.actorId) url.searchParams.set('actorId', input.actorId)
	if (input.callId) url.searchParams.set('callId', input.callId)
	if (input.visibility) url.searchParams.set('visibility', input.visibility)
	const response = await fetch(url)
	const body = await expectJson<EventListResponse>(response)
	return body.events.map((event) => ({
		seq: event.seq,
		type: event.type,
		visibility: event.visibility ?? 'worklog',
		runId: event.runId ?? null,
		intentId: event.intentId ?? null,
		actorId: event.actorId,
		payload: event.payload,
		createdAt: event.createdAt,
		envelopeId: event.envelopeId,
		callId: event.callId ?? null,
		parentSeq: event.parentSeq ?? null
	}))
}

export async function getIntentActors(intentId: string): Promise<IntentActorNode[]> {
	const response = await fetch(`/api/aven/jaensen/intents/${encodeURIComponent(intentId)}/actors`)
	const body = await expectJson<IntentActorsResponse>(response)
	return body.actors
}

export async function getIntentActivity(input: {
	intentId: string
	actorId?: string
	visibility?: 'chat' | 'worklog' | 'debug'
	after?: number
	limit?: number
}): Promise<EventRecord[]> {
	const url = new URL(`/api/aven/jaensen/intents/${encodeURIComponent(input.intentId)}/activity`, window.location.origin)
	if (input.actorId) url.searchParams.set('actorId', input.actorId)
	if (input.visibility) url.searchParams.set('visibility', input.visibility)
	if (input.after) url.searchParams.set('after', String(input.after))
	if (input.limit) url.searchParams.set('limit', String(input.limit))
	const response = await fetch(url)
	const body = await expectJson<EventListResponse>(response)
	return body.events as EventRecord[]
}

export async function getIntentEnvelopes(input: {
	intentId: string
	actorId?: string
	after?: string
	limit?: number
}): Promise<EnvelopeDto[]> {
	const url = new URL(`/api/aven/jaensen/intents/${encodeURIComponent(input.intentId)}/envelopes`, window.location.origin)
	if (input.actorId) url.searchParams.set('actorId', input.actorId)
	if (input.after) url.searchParams.set('after', input.after)
	if (input.limit) url.searchParams.set('limit', String(input.limit))
	const response = await fetch(url)
	const body = await expectJson<EnvelopeListResponse>(response)
	return body.envelopes
}

export async function getActor(actorId: string): Promise<ActorDetailDto> {
	const response = await fetch(`/api/aven/jaensen/actors/${encodeURIComponent(actorId)}`)
	return expectJson<ActorDetailDto>(response)
}

export async function listContextItems(query: Record<string, string>): Promise<ContextItemsResponse['items']> {
	const url = new URL('/api/aven/jaensen/context/items', window.location.origin)
	for (const [key, value] of Object.entries(query)) {
		url.searchParams.set(key, value)
	}
	const response = await fetch(url)
	const body = await expectJson<ContextItemsResponse>(response)
	return body.items
}