import { z } from 'zod'

/** Feedback is human annotation, never another message to the agent. */
export const feedbackContributionSchema = z
	.object({
		id: z.uuid(),
		contributorKind: z.literal('human'),
		kind: z.literal('response-feedback'),
		text: z.null(),
		payload: z
			.object({
				responseId: z.uuid(),
				vote: z.enum(['up', 'down']).nullable(),
				reason: z.string().max(2000),
				previousFeedbackId: z.uuid().nullable(),
				inferredFrom: z.uuid().optional(),
				sourceQuote: z.string().min(1).max(280).optional()
			})
			.strict()
			.refine((value) => value.vote !== null || value.reason === '', {
				message: 'Clearing a vote also clears its reason.'
			})
			.refine((value) => !value.inferredFrom || (value.vote !== null && value.reason === ''), {
				message: 'An inferred vote cannot clear feedback or invent a reason.'
			})
			.refine((value) => value.sourceQuote === undefined || Boolean(value.inferredFrom), {
				message: 'Source quotations belong only to inferred feedback.'
			})
	})
	.strict()

/** A completed neutral/suppressed check, not a cleared vote and not a chat message. */
export const feedbackAssessmentSchema = z
	.object({
		id: z.uuid(),
		contributorKind: z.literal('human'),
		kind: z.literal('feedback-assessment'),
		text: z.null(),
		payload: z.object({ sourceId: z.uuid() }).strict()
	})
	.strict()
export const feedbackCheckProjection = `EXISTS (SELECT 1 FROM contributions checked
	WHERE checked.id=CASE WHEN c.payload->'feedbackCheck'->>'commandId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
		THEN (c.payload->'feedbackCheck'->>'commandId')::uuid END
	AND checked.owner_subject_id=c.owner_subject_id
	AND checked.kind IN ('response-feedback','feedback-assessment')) AS feedback_check_complete`

export interface ResponseFeedback {
	id: string
	sequence: number
	vote: 'up' | 'down' | null
	reason: string
	updatedAt: string
	inferredFrom?: string
}

// Correlate by exact response identity, independently of the visible history page.
// The original reply and each feedback revision remain immutable contributions.
export const feedbackProjection = `(SELECT jsonb_build_object(
	'id',f.id,'sequence',f.sequence,'vote',f.payload->'vote','reason',f.payload->>'reason','updatedAt',f.created_at)
	|| jsonb_strip_nulls(jsonb_build_object('inferredFrom',f.payload->>'inferredFrom'))
	FROM contributions f WHERE f.intent_id=c.intent_id AND f.kind='response-feedback'
	AND f.payload->>'responseId'=c.id::text ORDER BY f.sequence DESC LIMIT 1) AS feedback`
