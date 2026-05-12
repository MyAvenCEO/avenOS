import type {
	EventListResponse,
	IntentDetailDto,
	IntentSummaryDto,
	PostMessageInput,
	PostMessageResult,
	StreamEventRecord
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

export async function getEvents(scope: string, after?: number): Promise<StreamEventRecord[]> {
	const url = new URL('/api/aven/jaensen/events', window.location.origin)
	url.searchParams.set('scope', scope)
	if (after && after > 0) {
		url.searchParams.set('after', String(after))
	}
	const response = await fetch(url)
	const body = await expectJson<EventListResponse>(response)
	return body.events.map((event) => ({
		seq: event.seq,
		scope: event.scope,
		type: event.type,
		payload: event.payload,
		createdAt: event.createdAt,
		envelopeId: event.envelopeId
	}))
}