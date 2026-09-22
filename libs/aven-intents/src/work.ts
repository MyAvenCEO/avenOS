import { z } from 'zod'
import { inputAdmissionSchema } from './admission.js'
import { historyReadSchema, historySearchSchema } from './retrieval.js'

/** Customer-owned output, distinct from content-free worker telemetry. */
export const turnFinishSchema = z
	.object({
		state: z.enum(['completed', 'failed']),
		text: z.string().min(1).max(100_000),
		payload: z.record(z.string(), z.json())
	})
	.strict()
	.refine(
		(value) => new TextEncoder().encode(JSON.stringify(value.payload)).length <= 64 * 1024,
		'Turn result is too large.'
	)
export type TurnFinish = z.infer<typeof turnFinishSchema>
export const turnWorkCommandSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('context') }).strict(),
	z.object({ kind: z.literal('finish'), output: turnFinishSchema }).strict(),
	historySearchSchema,
	historyReadSchema
])
export type TurnWorkCommand = z.infer<typeof turnWorkCommandSchema>

/** A reference from the runner's admitted record, not a replacement command. */
export const turnRunReferenceSchema = z
	.object({
		turnId: z.uuid(),
		runId: z.uuid(),
		subjectId: z.uuid(),
		inputId: z.uuid(),
		inputRevision: z.number().int().positive(),
		materialDigest: z.string().regex(/^[a-f0-9]{64}$/)
	})
	.strict()
export type TurnRunReference = z.infer<typeof turnRunReferenceSchema>

export const turnContextSchema = z
	.object({
		turnId: z.uuid(),
		intentId: z.uuid(),
		contributionId: z.uuid(),
		outputId: z.uuid(),
		input: inputAdmissionSchema,
		/** Same-Intent immutable predecessors; their receipts still require runner settlement checks. */
		replacedRuns: z.array(turnRunReferenceSchema).max(16),
		history: z
			.object({
				watermark: z.number().int().positive(),
				hasMore: z.boolean(),
				contributions: z
					.array(
						z
							.object({
								id: z.uuid(),
								sequence: z.coerce.number().int().positive(),
								contributor_kind: z.string(),
								kind: z.string(),
								text: z.string().nullable(),
								payload: z.record(z.string(), z.json()),
								work_state: z
									.enum(['pending', 'dispatched', 'completed', 'failed', 'cancelled', 'blocked'])
									.nullable(),
								created_at: z.iso.datetime({ offset: true })
							})
							.strict()
					)
					.max(80)
			})
			.strict()
	})
	.strict()
export type TurnContext = z.infer<typeof turnContextSchema>
export const turnFinishReceiptSchema = z.object({ contributionId: z.uuid() }).strict()
export const TURN_CONTEXT_MAX_BYTES = 2 * 1024 * 1024

export const turnLifecycleCommandSchema = z
	.object({
		kind: z.enum(['state', 'resume']),
		run: turnRunReferenceSchema
	})
	.strict()
export const turnLifecycleSchema = z.discriminatedUnion('state', [
	z.object({ state: z.literal('waiting') }).strict(),
	z.object({ state: z.literal('ended') }).strict(),
	z
		.object({
			state: z.literal('ready'),
			workGrant: z.string().min(1).max(8192).optional(),
			replacedRuns: z.array(turnRunReferenceSchema).max(16)
		})
		.strict(),
	z.object({ state: z.enum(['completed', 'failed']), contributionId: z.uuid() }).strict()
])

/** Content-free supervision of the exact admitted run. Settlement proves only
 * that execution ended and all started tools have recorded outcomes, not rollback. */
const settlementSchema = z.enum(['pending', 'settled', 'uncertain'])
export const turnRunStatusSchema = z.discriminatedUnion('state', [
	z
		.object({
			state: z.enum(['active', 'waiting', 'succeeded', 'cancelled']),
			settlement: settlementSchema
		})
		.strict(),
	z
		.object({ state: z.literal('failed'), uncertain: z.boolean(), settlement: settlementSchema })
		.strict()
])
export type TurnRunStatus = z.infer<typeof turnRunStatusSchema>
export const turnBlockReasonSchema = z.enum([
	'WORK_AUTHORITY_EXPIRED',
	'EXECUTION_UNCERTAIN',
	'RUN_FAILED',
	'RUN_CANCELLED',
	'ANSWER_NOT_SAVED'
])
export type TurnBlockReason = z.infer<typeof turnBlockReasonSchema>
