import { z } from 'zod'

/** Execution metadata only. Never accept provider narration or tool arguments. */
export const turnOperationSchema = z
	.object({
		ordinal: z.number().int().nonnegative(),
		kind: z.enum(['model', 'tool']),
		phase: z.enum(['answer', 'verification', 'repair', 'checklist']).optional(),
		name: z.string().min(1).max(128).optional(),
		state: z.enum(['running', 'completed', 'failed', 'reconciling']),
		startedAt: z.number().finite().nonnegative(),
		durationMs: z.number().finite().nonnegative().optional(),
		firstContentMs: z.number().finite().nonnegative().optional(),
		firstTextMs: z.number().finite().nonnegative().optional(),
		basis: z.enum(['execution', 'receipt-check', 'read-again', 'recomputed']).optional(),
		replayed: z.boolean()
	})
	.strict()

export const turnProgressSchema = z
	.object({
		turnId: z.uuid(),
		revision: z.number().int().positive(),
		state: z.enum([
			'accepted',
			'planning',
			'running',
			'waiting_for_input',
			'succeeded',
			'failed',
			'cancelled'
		]),
		updatedAt: z.iso.datetime({ offset: true }),
		observedAt: z.iso.datetime({ offset: true }),
		/** A lapsed lease is not proof that work stopped or an effect failed. */
		leaseExpiresAt: z.iso.datetime({ offset: true }).nullable(),
		operation: turnOperationSchema.nullable(),
		steps: z.array(turnOperationSchema).max(24)
	})
	.strict()
	.refine((value) => new Set(value.steps.map((s) => s.ordinal)).size === value.steps.length)

export type TurnOperation = z.infer<typeof turnOperationSchema>
export type TurnProgress = z.infer<typeof turnProgressSchema>
