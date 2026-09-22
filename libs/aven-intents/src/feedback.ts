import { z } from 'zod'

const feedbackContextSchema = z
	.object({
		role: z.enum(['user', 'assistant']),
		content: z.string().max(1200),
		responseId: z.uuid().optional(),
		/** A not-yet-saved response is anchored to its already admitted request. */
		pending: z.literal(true).optional(),
		requestId: z.uuid().optional()
	})
	.strict()
	.refine((entry) => !entry.responseId || entry.role === 'assistant')
	.refine((entry) =>
		entry.pending
			? entry.role === 'assistant' && !!entry.responseId && !!entry.requestId
			: entry.requestId === undefined
	)

/** The optional assessment scope is immutable admission material, not an automatic
 * vote or execution authority. It remains attached to what the user actually saw,
 * even when the new contribution is routed elsewhere. */
export const feedbackCheckSchema = z
	.object({
		commandId: z.uuid(),
		intentId: z.uuid(),
		locale: z.string().min(1).max(80),
		recent: z.array(feedbackContextSchema).min(1).max(6)
	})
	.strict()
	.refine((check) => check.recent.some((entry) => entry.responseId))

export type FeedbackCheck = z.infer<typeof feedbackCheckSchema>

export function readFeedbackCheck(value: unknown): FeedbackCheck | undefined {
	const parsed = feedbackCheckSchema.safeParse(value)
	return parsed.success ? parsed.data : undefined
}
