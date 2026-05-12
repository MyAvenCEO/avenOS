import { STREAM_EVENT_TYPES, type StreamEventRecord } from './types'

export function subscribeToScope(
	scope: string,
	options: {
		afterSeq?: number
		onEvent: (event: StreamEventRecord) => void
		onError?: (error: Event) => void
	}
): EventSource {
	const url = new URL('/api/aven/jaensen/events/stream', window.location.origin)
	url.searchParams.set('scope', scope)
	if (options.afterSeq && options.afterSeq > 0) {
		url.searchParams.set('after', String(options.afterSeq))
	}

	const source = new EventSource(url)
	for (const type of STREAM_EVENT_TYPES) {
		source.addEventListener(type, (raw) => {
			const event = raw as MessageEvent<string>
			const parsed = JSON.parse(event.data) as
				| StreamEventRecord
				| { payload?: unknown; createdAt?: string; envelopeId?: string | null; scope?: string; seq?: number; type?: string }
			options.onEvent({
				seq:
					typeof parsed?.seq === 'number'
						? parsed.seq
						: Number.parseInt(event.lastEventId || '0', 10) || 0,
				scope: typeof parsed?.scope === 'string' ? parsed.scope : scope,
				type: typeof parsed?.type === 'string' ? parsed.type : type,
				payload: 'payload' in parsed ? parsed.payload : parsed,
				createdAt: typeof parsed?.createdAt === 'string' ? parsed.createdAt : undefined,
				envelopeId: typeof parsed?.envelopeId === 'string' || parsed?.envelopeId === null ? parsed.envelopeId : undefined
			})
		})
	}
	source.onerror = (error) => options.onError?.(error)
	return source
}