import { z } from 'zod'

/** One bounded query contract for interactive and delegated history readers. */
export const intentRetrievalSchema = z
	.object({
		query: z.string().max(500).optional(),
		cursor: z.string().max(2048).optional(),
		limit: z.coerce.number().int().min(1).max(50).optional(),
		intent: z.uuid().optional(),
		state: z.enum(['all', 'active', 'archive']).optional()
	})
	.strict()
/** Chronological message browsing needs an explicit Intent; UUID search ordering
 * across unrelated threads is not a chronology. Activity is not a chat message. */
export const messageRetrievalSchema = intentRetrievalSchema
	.extend({
		role: z.enum(['user', 'assistant']).optional(),
		order: z.enum(['oldest', 'newest']).optional()
	})
	.refine((value) => !value.order || !!value.intent, 'Chronological order requires an Intent.')
export const historySearchSchema = z
	.object({
		kind: z.literal('search'),
		recordKind: z.enum(['intent', 'message']),
		input: messageRetrievalSchema
	})
	.strict()
	.refine(
		(value) => value.recordKind === 'message' || (!value.input.role && !value.input.order),
		'Speaker and chronological order apply only to messages.'
	)
export const historyReadSchema = z
	.object({
		kind: z.literal('read'),
		recordKind: z.enum(['intent', 'message']),
		id: z.uuid(),
		offset: z.number().int().min(0).max(100_000).default(0)
	})
	.strict()
	.refine(
		(v) => v.recordKind !== 'intent' || v.offset === 0,
		'Use message search and its cursor to read older Intent history.'
	)
export type HistoryQuery = z.infer<typeof historySearchSchema> | z.infer<typeof historyReadSchema>
export const HISTORY_PREVIEW_MESSAGES = 10
export const HISTORY_PREVIEW_CHARS = 700

/** A preview is not a second evidence source or a full transcript. Exact messages
 * stay separately readable, including user feedback and long-text offsets. Preview
 * excerpts use those same message identities; SQL offsets count Unicode code points. */
export function intentHistoryPreview(detail: {
	id: string
	title: string
	state: string
	sourceLabel: string
	contributionsHasMore?: boolean
	contributions: Array<{
		id: string
		contributorKind: string
		kind: string
		text: string | null
		createdAt: string
		feedback?: unknown
		totalChars?: number
	}>
}) {
	const messages = detail.contributions.filter(
		(c) => ['human', 'agent'].includes(c.contributorKind) && c.kind === 'message' && c.text !== null
	)
	return {
		ok: true,
		id: detail.id,
		title: detail.title,
		status: detail.state,
		source: detail.sourceLabel,
		conversation: messages.slice(-HISTORY_PREVIEW_MESSAGES).map((c) => {
			const characters = Array.from(c.text!),
				content = characters.slice(0, HISTORY_PREVIEW_CHARS).join('')
			const totalChars = c.totalChars ?? characters.length,
				end = Math.min(characters.length, HISTORY_PREVIEW_CHARS)
			return {
				id: c.id,
				sourceId: c.id,
				offset: 0,
				role: c.contributorKind === 'human' ? 'user' : 'assistant',
				content,
				totalChars,
				complete: end === totalChars,
				nextOffset: end < totalChars ? end : null,
				createdAt: c.createdAt,
				hasMoreText: end < totalChars,
				...(c.feedback !== undefined && c.feedback !== null ? { feedback: c.feedback } : {})
			}
		}),
		olderMessagesAvailable: Boolean(
			detail.contributionsHasMore || messages.length > HISTORY_PREVIEW_MESSAGES
		),
		notice:
			'Recent exact message excerpts, retained for quotation under each sourceId, not this Intent ID. Use workspace_search with kind message and this Intent ID for older history; workspace_read with the message ID and nextOffset continues long text.',
		activity: detail.contributions
			.filter((c) => c.kind !== 'message')
			.slice(-10)
			.map((c) => `${c.kind}: ${(c.text ?? '').slice(0, 500)}`)
	}
}
