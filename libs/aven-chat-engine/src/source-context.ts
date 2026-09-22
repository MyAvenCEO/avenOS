import { readSourceContext } from '@avenos/intents/source-context'
import type { Turn } from './chat'

export { readSourceContext, type SourceContext } from '@avenos/intents/source-context'

/** Capture before routing: a later screen change must not replace what "that" referred to. */
export function captureSourceContext(intentId: string, turns: readonly Turn[]) {
	const marker = '\n[Excerpt shortened]\n'
	const messages = turns
		.filter(
			(t) =>
				t.persisted &&
				!t.pending &&
				!t.queued &&
				!t.attachment &&
				!t.deliveryError &&
				t.content.trim()
		)
		.slice(-4)
		.map((t) => ({
			id: t.id,
			role: t.role,
			shortened: t.content.length > 800,
			content:
				t.content.length <= 800
					? t.content
					: `${t.content.slice(0, 400)}${marker}${t.content.slice(-(400 - marker.length))}`
		}))
	return readSourceContext({ intentId, capturedAt: new Date().toISOString(), messages })
}
