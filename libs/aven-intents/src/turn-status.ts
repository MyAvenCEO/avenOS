import { z } from 'zod'
import { turnBlockReasonSchema } from './work.js'

/** A user-visible queue projection, not execution authority or an effect receipt. */
export const turnStatusSchema = z
	.object({
		turnId: z.uuid(),
		intentId: z.uuid(),
		contributionId: z.uuid(),
		/** Reserved at admission, even before execution. Not proof that a reply exists. */
		responseId: z.uuid(),
		controlRevision: z.number().int().positive(),
		stopRequestedAt: z.iso.datetime({ offset: true }).nullable(),
		sequence: z.number().int().positive(),
		state: z.enum([
			'queued',
			'accepted',
			'stopping',
			'blocked',
			'completed',
			'failed',
			'cancelled'
		]),
		reason: z
			.enum([
				...turnBlockReasonSchema.options,
				'USER_STOP_REQUESTED',
				'INPUT_REPLACED',
				'INTENT_UNAVAILABLE',
				'WORKSPACE_CHANGED',
				'WORK_INTERRUPTED'
			])
			.nullable(),
		admittedAt: z.iso.datetime({ offset: true }),
		acceptedAt: z.iso.datetime({ offset: true }).nullable(),
		finishedAt: z.iso.datetime({ offset: true }).nullable(),
		outputContributionId: z.uuid().nullable()
	})
	.strict()
export type TurnStatus = z.infer<typeof turnStatusSchema>
export const turnStopCommandSchema = z
	.object({
		commandId: z.uuid(),
		expectedControlRevision: z.number().int().positive()
	})
	.strict()
export type TurnStopCommand = z.infer<typeof turnStopCommandSchema>
export const turnStopReceiptSchema = z
	.object({
		turnId: z.uuid(),
		intentId: z.uuid(),
		controlRevision: z.number().int().positive(),
		disposition: z.enum(['cancelled', 'stopping', 'finished']),
		stopRequestedAt: z.iso.datetime({ offset: true }).nullable()
	})
	.strict()
export const turnPageInputSchema = z
	.object({
		cursor: z.string().min(1).max(2048).optional(),
		limit: z.coerce.number().int().min(1).max(50).optional()
	})
	.strict()
export type TurnPageInput = z.infer<typeof turnPageInputSchema>
export const turnPageSchema = z
	.object({
		turns: z.array(turnStatusSchema).max(50),
		hasMore: z.boolean(),
		nextCursor: z.string().nullable(),
		observedAt: z.iso.datetime({ offset: true })
	})
	.strict()
