import { createHash } from 'node:crypto'
import type { PlanRunContinuation, PlanRunExecutionContext } from '@avenos/actors'
import type {
	ActorReviewDecisionCommand,
	ActorReviewProposal,
	ActorReviewRecord
} from '@avenos/actors/review'
import { type ArtifactJson, canonicalArtifactJson } from '@avenos/artifact-store'
import type pg from 'pg'
import { z } from 'zod'
import { stablePublicationUuid } from './artifact-store-port'

const uuid = z.uuid()
const revision = z.number().int().positive().max(2147483647)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const hasControlCharacter = (value: string) =>
	[...value].some((character) => {
		const code = character.charCodeAt(0)
		return code < 32 || code === 127
	})
const text = z
	.string()
	.min(1)
	.max(256)
	.refine((s) => !hasControlCharacter(s))
export const reviewProposalSchema = z
	.object({
		id: uuid,
		invocationId: text,
		revision,
		subjectSchema: text,
		subjectDigest: digest,
		subject: z.record(z.string(), z.unknown()),
		title: text,
		expiresAt: z.iso.datetime({ offset: true })
	})
	.strict()
export const reviewDecisionCommandSchema = z
	.object({
		id: uuid,
		revision,
		subjectDigest: digest,
		expectedEventVersion: z.number().int().min(0).max(2147483646),
		outcome: z.enum(['approve', 'deny', 'postpone'])
	})
	.strict()
const recordSchema = reviewProposalSchema
	.extend({
		runId: uuid,
		generation: revision,
		createdAt: z.string(),
		superseded: z.boolean(),
		eventVersion: z.number().int().nonnegative(),
		// PostgreSQL's timestamptz JSON includes a space rather than ISO's T.
		expiresAt: z.string(),
		decision: z
			.object({
				id: uuid,
				outcome: z.enum(['approve', 'deny', 'postpone']),
				reviewerId: uuid,
				sessionId: text,
				decidedAt: z.string()
			})
			.strict()
			.nullable()
	})
	.strict()
export type ReviewRecord = ActorReviewRecord
export type ReviewProposal = ActorReviewProposal
export type ReviewDecisionCommand = ActorReviewDecisionCommand
export type ReviewScope = { environmentId: string; generation: number; subjectId: string }

export const reviewSubjectDigest = (subject: Record<string, unknown>) =>
	createHash('sha256')
		.update(canonicalArtifactJson(subject as ArtifactJson))
		.digest('hex')

export class ReviewError extends Error {
	constructor(readonly code: string) {
		super(code)
	}
}
const safeErrors = new Set([
	'REVIEW_SCOPE_UNAVAILABLE',
	'REVIEW_NOT_FOUND',
	'REVIEW_EXECUTION_INACTIVE',
	'REVIEW_INPUT_INVALID',
	'REVIEW_CONFLICT',
	'REVIEW_NOT_OPEN'
])

/** Function-only, generation-scoped adapter. A worker pool cannot decide. */
export class ReviewStore {
	constructor(
		private readonly pool: Pick<pg.Pool, 'query'>,
		readonly scope: ReviewScope
	) {
		z.object({ environmentId: uuid, generation: revision, subjectId: uuid }).strict().parse(scope)
	}
	private async call(sql: string, parameters: unknown[]): Promise<ReviewRecord> {
		try {
			const result = await this.pool.query(sql, [
				this.scope.environmentId,
				this.scope.generation,
				this.scope.subjectId,
				...parameters
			])
			const record = recordSchema.parse(result.rows[0]?.value)
			if (reviewSubjectDigest(record.subject) !== record.subjectDigest)
				throw new ReviewError('REVIEW_SUBJECT_CHANGED')
			return record
		} catch (error) {
			if (error instanceof ReviewError) throw error
			const message = error instanceof Error ? error.message : ''
			throw new ReviewError(safeErrors.has(message) ? message : 'REVIEW_UNAVAILABLE')
		}
	}
	read(runId: string, id: string) {
		return this.call('SELECT aven_actor_runs.review_read($1,$2,$3,$4,$5) AS value', [
			uuid.parse(runId),
			uuid.parse(id)
		])
	}
	open(runId: string, leaseOwnerId: string, input: ReviewProposal) {
		const proposal = reviewProposalSchema.parse(input)
		if (
			reviewSubjectDigest(proposal.subject) !== proposal.subjectDigest ||
			Buffer.byteLength(JSON.stringify(proposal.subject)) > 24000
		)
			throw new ReviewError('REVIEW_INPUT_INVALID')
		return this.call('SELECT aven_actor_runs.review_open($1,$2,$3,$4,$5,$6) AS value', [
			uuid.parse(runId),
			uuid.parse(leaseOwnerId),
			proposal
		])
	}
	/** Only call with the session stamped by the authenticated interactive ingress. */
	decide(runId: string, reviewId: string, sessionId: string, input: ReviewDecisionCommand) {
		return this.call('SELECT aven_actor_runs.review_decide($1,$2,$3,$4,$5,$6,$7) AS value', [
			text.parse(sessionId),
			uuid.parse(runId),
			uuid.parse(reviewId),
			reviewDecisionCommandSchema.parse(input)
		])
	}
}

export function reviewContinuation(record: ReviewRecord): PlanRunContinuation {
	return {
		continuationId: record.id,
		kind: 'approval',
		schema: 'os.aven:schema:actors:review-request@1',
		prompt: record.title,
		persistence: 'metadata-only',
		state: 'open',
		review: { id: record.id, revision: record.revision, subjectDigest: record.subjectDigest }
	}
}

/** A copied continuation, model-produced boolean or plain chat "yes" is not evidence. */
export function requireApprovedReview(
	record: ReviewRecord,
	expected: {
		runId: string
		invocationId: string
		subjectDigest: string
		generation: number
		subjectId: string
	},
	now = Date.now()
): string {
	if (
		record.runId !== expected.runId ||
		record.invocationId !== expected.invocationId ||
		record.subjectDigest !== expected.subjectDigest ||
		record.generation !== expected.generation ||
		record.superseded ||
		!Number.isFinite(Date.parse(record.expiresAt)) ||
		Date.parse(record.expiresAt) <= now ||
		record.decision?.outcome !== 'approve' ||
		record.decision.reviewerId !== expected.subjectId
	)
		throw new ReviewError('REVIEW_APPROVAL_REQUIRED')
	return record.decision.id
}

export class WaitingForReview extends Error {
	constructor(readonly record: ReviewRecord) {
		super('REVIEW_REQUIRED')
	}
}

/** Shared execution gate. All decisions are reloaded; continuation values are ignored. */
export async function requestRunReview(
	store: ReviewStore,
	context: PlanRunExecutionContext | undefined,
	request: {
		invocationId: string
		subjectSchema: string
		title: string
		subject: Record<string, unknown>
	}
): Promise<string> {
	context?.signal?.throwIfAborted()
	if (!context?.lease) throw new ReviewError('REVIEW_EXECUTION_INACTIVE')
	await context.lease.assertActive()
	const runId = context.lease.runId
	const id = stablePublicationUuid(`review:${runId}:${request.invocationId}`)
	const subjectDigest = reviewSubjectDigest(request.subject)
	let record: ReviewRecord
	try {
		record = await store.read(runId, id)
	} catch (error) {
		if (!(error instanceof ReviewError) || error.code !== 'REVIEW_NOT_FOUND') throw error
		record = await store.open(runId, context.lease.ownerId, {
			...request,
			id,
			revision: 1,
			subjectDigest,
			expiresAt: new Date(Date.now() + 30 * 60_000).toISOString()
		})
	}
	if (
		record.subjectDigest !== subjectDigest ||
		record.subjectSchema !== request.subjectSchema ||
		record.superseded
	)
		throw new ReviewError('REVIEW_SUBJECT_CHANGED')
	if (Date.parse(record.expiresAt) <= Date.now()) throw new ReviewError('REVIEW_EXPIRED')
	if (record.decision?.outcome === 'deny') throw new ReviewError('REVIEW_DENIED')
	if (record.decision?.outcome !== 'approve') throw new WaitingForReview(record)
	context.signal?.throwIfAborted()
	await context.lease.assertActive()
	return requireApprovedReview(record, {
		runId,
		invocationId: request.invocationId,
		subjectDigest,
		generation: store.scope.generation,
		subjectId: store.scope.subjectId
	})
}
