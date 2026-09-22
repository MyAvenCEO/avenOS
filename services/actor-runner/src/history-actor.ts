import type { Handler } from '@avenos/actors'
import { createRetrievalActor } from '@avenos/actors/retrieval'
import {
	type HistoryQuery,
	historyReadSchema,
	historySearchSchema
} from '@avenos/intents/retrieval'
import { z } from 'zod'
import { type TurnWorkClient, TurnWorkRequestError } from './turn-work-client.js'

/** Transport adapters only. Selection, excerpts, cursors and owner checks remain
 * in the same Intent Store used by the desktop. No database/login reaches Chat. */
export function createHistoryActor(client: TurnWorkClient) {
	const handle =
		(query: (p: Record<string, unknown>) => HistoryQuery): Handler =>
		async (p, context) => {
			try {
				context?.signal?.throwIfAborted()
				const result = await client.history(query(p), context?.signal)
				const text = JSON.stringify(result)
				return { record: text, wire: text }
			} catch (error) {
				context?.signal?.throwIfAborted()
				const message =
					error instanceof z.ZodError
						? 'Use valid record IDs, a bounded query and the cursor from the same search.'
						: error instanceof TurnWorkRequestError && error.status === 404
							? 'This record was not found in your accessible history.'
							: error instanceof TurnWorkRequestError && error.status === 400
								? 'This search or text offset is invalid. Restart the query without its cursor.'
								: null
				if (!message) throw error
				const text = JSON.stringify({ ok: false, error: message })
				return { record: text, wire: text }
			}
		}
	return createRetrievalActor({
		intent_list: handle((p) =>
			historySearchSchema.parse({ kind: 'search', recordKind: 'intent', input: p })
		),
		intent_messages: handle((p) =>
			historySearchSchema.parse({ kind: 'search', recordKind: 'message', input: p })
		),
		intent_detail: handle((p) =>
			historyReadSchema.parse({ kind: 'read', recordKind: 'intent', id: p.intent })
		),
		message_detail: handle((p) =>
			historyReadSchema.parse({ kind: 'read', recordKind: 'message', id: p.id, offset: p.offset })
		)
	})
}
