import { createHash, randomUUID } from 'node:crypto'
import { type WorkerPlacement, workerPlacementSchema } from '@avenos/aven-customer-contracts'
import {
	admissionDigest,
	type InputAdmission,
	inputAdmissionSchema
} from '@avenos/intents/admission'
import {
	type TurnBlockReason,
	type TurnFinish,
	type TurnRunReference,
	turnBlockReasonSchema,
	turnFinishSchema,
	turnRunReferenceSchema
} from '@avenos/intents/work'
import type pg from 'pg'
import { z } from 'zod'
import { replacementHistory } from './replacement-history.js'
import {
	IntentConflictError,
	IntentNotFoundError,
	insertContribution,
	transaction
} from './store.js'

export type { TurnFinish } from '@avenos/intents/work'

const scopeSchema = z
	.object({ subjectId: z.uuid(), environmentId: z.uuid(), generation: z.number().int().positive() })
	.strict()
export type TurnScope = z.infer<typeof scopeSchema>
export interface TurnDispatch {
	turnId: string
	intentId: string
	contributionId: string
	outputId: string
	sequence: number
	contextSequence: number
	token: string
	expiresAt: string
	input: InputAdmission
	workGrant: string
}
export type TurnClaim =
	| { state: 'claimed'; dispatch: TurnDispatch }
	| { state: 'waiting' | 'blocked' | 'dispatched' | 'completed' | 'failed' | 'cancelled' }

const stable = (value: unknown): string => {
	if (value === null || typeof value !== 'object') return JSON.stringify(value)
	if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
	return `{${Object.entries(value as Record<string, unknown>)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
		.join(',')}}`
}

/** Customer-local queue coordination, not another executor or an authorization service.
 * Callers must authenticate and authorize the current tenant before obtaining its pool.
 * The runner still owns execution leases and side-effect reconciliation.
 */
export class IntentTurnOutbox {
	constructor(private readonly pool: pg.Pool) {}

	/** Internal lifecycle coordination using a verified Intent-worker placement.
	 * No conversation content is returned. A resumed certificate still needs a live
	 * runner lease and fresh control authorization before context or tools are allowed.
	 */
	async lifecycle(placement: WorkerPlacement, reference: TurnRunReference, resume: boolean) {
		this.#placement(placement)
		turnRunReferenceSchema.parse(reference)
		const scope = {
			environmentId: placement.environmentId,
			generation: placement.routingGeneration,
			subjectId: reference.subjectId
		}
		return transaction(this.pool, async (db) => {
			const row = await this.#locked(db, scope, reference.turnId)
			await this.#active(db, scope)
			const input = inputAdmissionSchema.parse(row.input)
			if (
				input.inputId !== reference.inputId ||
				input.revision !== reference.inputRevision ||
				(await admissionDigest(input)) !== reference.materialDigest ||
				(row.run_id && row.run_id !== reference.runId)
			)
				throw new IntentConflictError('This is not the admitted turn.')
			if (row.finish_digest && ['completed', 'failed'].includes(row.state))
				return { state: row.state as 'completed' | 'failed', contributionId: String(row.output_id) }
			if (row.state === 'pending' && row.authority_live) return { state: 'waiting' as const }
			if (row.state !== 'dispatched' || !row.authority_live) return { state: 'ended' as const }
			return {
				state: 'ready' as const,
				replacedRuns: await replacementHistory(
					db,
					{ ...scope, intentId: row.intent_id },
					input.replaces?.turnId ?? null,
					true
				),
				...(resume && { workGrant: String(row.work_grant) })
			}
		})
	}

	/** Internal executor context; never included in public Intent/run projections. */
	async executionContext(scope: TurnScope, turnId: string, runId: string) {
		z.uuid().parse(runId)
		return transaction(this.pool, async (db) => {
			const row = await this.#locked(db, scope, turnId)
			await this.#active(db, scope)
			if (row.state !== 'dispatched' || row.run_id !== runId || !row.authority_live)
				throw new IntentConflictError('This turn is not ready to execute.')
			return {
				turnId,
				intentId: String(row.intent_id),
				contributionId: String(row.contribution_id),
				outputId: String(row.output_id),
				input: inputAdmissionSchema.parse(row.input),
				replacedRuns: await replacementHistory(
					db,
					{ ...scope, intentId: row.intent_id },
					inputAdmissionSchema.parse(row.input).replaces?.turnId ?? null,
					true
				),
				workGrant: String(row.work_grant)
			}
		})
	}

	/** Read-only exchange guard. The caller already verified both signed authorities.
	 * Exact certificate equality prevents a fresh certificate for the same input from
	 * silently replacing the authority durably accepted with this turn.
	 */
	async authorizeExecution(
		scope: TurnScope,
		turnId: string,
		runId: string,
		workToken: string
	): Promise<void> {
		z.uuid().parse(runId)
		z.string().min(1).max(8192).parse(workToken)
		await transaction(this.pool, async (db) => {
			const row = await this.#locked(db, scope, turnId)
			await this.#active(db, scope)
			if (
				row.state !== 'dispatched' ||
				row.run_id !== runId ||
				!row.authority_live ||
				row.work_grant !== workToken
			)
				throw new IntentConflictError('This turn no longer authorizes execution.')
		})
	}

	/** Bootstrap only: an unexpired pending claim may admit its stable run. It does
	 * not authorize model/tool execution before the outbox has bound that run.
	 */
	async authorizeDispatch(
		scope: TurnScope,
		turnId: string,
		dispatchToken: string,
		workToken: string
	): Promise<number> {
		z.uuid().parse(dispatchToken)
		z.string().min(1).max(8192).parse(workToken)
		return transaction(this.pool, async (db) => {
			const row = await this.#locked(db, scope, turnId)
			await this.#active(db, scope)
			if (
				row.state !== 'pending' ||
				!row.dispatch_live ||
				!row.authority_live ||
				row.dispatch_token !== dispatchToken ||
				row.work_grant !== workToken
			)
				throw new IntentConflictError('This dispatch no longer owns the turn.')
			return Math.floor(new Date(row.dispatch_until).getTime() / 1000)
		})
	}

	async #active(db: pg.PoolClient, scope: Pick<TurnScope, 'environmentId' | 'generation'>) {
		const active = await db.query(
			`SELECT 1 FROM aven_platform.environment_identity
      WHERE singleton AND environment_id=$1 AND routing_generation=$2 AND execution_enabled`,
			[scope.environmentId, scope.generation]
		)
		if (!active.rowCount) throw new IntentConflictError('This workspace changed or work is paused.')
	}

	/** Always lock the Intent first: admission, lifecycle and completion use the same order. */
	async #locked(db: pg.PoolClient, scope: TurnScope, turnId: string) {
		scopeSchema.parse(scope)
		z.uuid().parse(turnId)
		const intent = await db.query(
			`SELECT i.id FROM intents i JOIN turn_outbox t ON t.intent_id=i.id
      WHERE t.turn_id=$1 AND t.owner_subject_id=$2 AND i.owner_subject_id=$2 FOR UPDATE OF i`,
			[turnId, scope.subjectId]
		)
		if (!intent.rowCount) throw new IntentNotFoundError('Turn not found.')
		const found = await db.query(
			`SELECT t.*, a.contribution_id,
      t.dispatch_until > clock_timestamp() AS dispatch_live,
      t.authority_expires_at > clock_timestamp() AS authority_live,
      t.available_at <= clock_timestamp() AS available
      FROM turn_outbox t JOIN input_admissions a USING(turn_id)
      WHERE t.turn_id=$1 AND t.routing_generation=$2 FOR UPDATE OF t`,
			[turnId, scope.generation]
		)
		if (!found.rows[0])
			throw new IntentConflictError('This turn belongs to a different workspace generation.')
		return found.rows[0]
	}

	/** Bounded discovery within an already authorized subject/environment, without secrets. */
	async pending(scope: TurnScope, limit = 16): Promise<string[]> {
		scopeSchema.parse(scope)
		z.number().int().min(1).max(64).parse(limit)
		return (await this.#pending(scope, scope.subjectId, limit)).map((row) => row.turnId)
	}

	/** The caller verifies the signed placement before opening its component pool.
	 * Discovery does not release any input text or work certificate, nor execute it.
	 */
	async pendingForWorker(placement: WorkerPlacement) {
		this.#placement(placement)
		return this.#pending(
			{ environmentId: placement.environmentId, generation: placement.routingGeneration },
			null,
			16
		)
	}

	/** A short polling claim is independent of execution ownership. Updating its
	 * due time makes scans fair even when earlier runs remain active for hours.
	 * It neither exposes input content nor changes a run/turn execution state.
	 */
	async statusChecksForWorker(placement: WorkerPlacement) {
		this.#placement(placement)
		return transaction(this.pool, async (db) => {
			await this.#active(db, {
				environmentId: placement.environmentId,
				generation: placement.routingGeneration
			})
			const result = await db.query(
				`WITH due AS (
        SELECT t.turn_id FROM turn_outbox t
        WHERE (t.state='dispatched' OR (t.state='blocked' AND t.stop_requested_at IS NOT NULL))
          AND t.run_id IS NOT NULL AND t.routing_generation=$1 AND t.available_at<=clock_timestamp()
        ORDER BY t.available_at,t.turn_id LIMIT 16 FOR UPDATE SKIP LOCKED
      ) UPDATE turn_outbox t SET available_at=clock_timestamp()+interval '10 seconds'
        FROM due,input_admissions a WHERE t.turn_id=due.turn_id AND a.turn_id=t.turn_id
        RETURNING t.turn_id,t.run_id,t.owner_subject_id,a.input_id,a.revision,a.material_digest,
          t.authority_expires_at<=clock_timestamp() AS expired,t.stop_requested_at`,
				[placement.routingGeneration]
			)
			return result.rows.map((row) => ({
				expired: Boolean(row.expired),
				stopping: row.stop_requested_at !== null,
				run: turnRunReferenceSchema.parse({
					turnId: row.turn_id,
					runId: row.run_id,
					subjectId: row.owner_subject_id,
					inputId: row.input_id,
					inputRevision: row.revision,
					materialDigest: row.material_digest
				})
			}))
		})
	}

	/** Only a supervisor with an authenticated, exact-run settlement observation
	 * may complete a requested stop. No result is invented and no action undone. */
	async settleStopForWorker(
		placement: WorkerPlacement,
		reference: TurnRunReference,
		settlement: 'settled' | 'uncertain'
	): Promise<boolean> {
		this.#placement(placement)
		turnRunReferenceSchema.parse(reference)
		z.enum(['settled', 'uncertain']).parse(settlement)
		const scope = {
			environmentId: placement.environmentId,
			generation: placement.routingGeneration,
			subjectId: reference.subjectId
		}
		return transaction(this.pool, async (db) => {
			const row = await this.#locked(db, scope, reference.turnId)
			await this.#active(db, scope)
			if (row.state !== 'blocked' || !row.stop_requested_at) return false
			const input = inputAdmissionSchema.parse(row.input)
			if (
				row.run_id !== reference.runId ||
				input.inputId !== reference.inputId ||
				input.revision !== reference.inputRevision ||
				(await admissionDigest(input)) !== reference.materialDigest
			)
				throw new IntentConflictError('This is not the admitted run.')
			// A previous explicit uncertainty warning requires receipt reconciliation,
			// not a later status sample silently clearing that warning.
			if (row.error_code === 'EXECUTION_UNCERTAIN') return false
			if (settlement === 'uncertain') {
				await db.query(`UPDATE turn_outbox SET error_code='EXECUTION_UNCERTAIN' WHERE turn_id=$1`, [
					reference.turnId
				])
			} else {
				await db.query(
					`UPDATE turn_outbox SET state='cancelled',finished_at=clock_timestamp() WHERE turn_id=$1`,
					[reference.turnId]
				)
				await insertContribution(
					db,
					row.intent_id,
					{
						id: randomUUID(),
						contributorKind: 'system',
						kind: 'turn-stop-settled',
						text: null,
						payload: {
							turnId: reference.turnId,
							controlRevision: row.control_revision,
							completedActionsRetained: true
						}
					},
					`turn-stop-settled:${reference.turnId}`
				)
			}
			await db.query(
				'UPDATE intents SET version=version+1,updated_at=clock_timestamp() WHERE id=$1',
				[row.intent_id]
			)
			return true
		})
	}

	/** A supervisor only blocks a still-bound turn. A concurrently committed
	 * answer, cancellation, or new workspace generation always wins. Blocking
	 * stops new grants and holds FIFO; it never rolls back or retries an effect.
	 */
	async blockForWorker(
		placement: WorkerPlacement,
		reference: TurnRunReference,
		reason: TurnBlockReason
	): Promise<boolean> {
		this.#placement(placement)
		turnRunReferenceSchema.parse(reference)
		turnBlockReasonSchema.parse(reason)
		const scope = {
			environmentId: placement.environmentId,
			generation: placement.routingGeneration,
			subjectId: reference.subjectId
		}
		return transaction(this.pool, async (db) => {
			const row = await this.#locked(db, scope, reference.turnId)
			await this.#active(db, scope)
			if (row.state !== 'dispatched') return false
			const input = inputAdmissionSchema.parse(row.input)
			if (
				row.run_id !== reference.runId ||
				input.inputId !== reference.inputId ||
				input.revision !== reference.inputRevision ||
				(await admissionDigest(input)) !== reference.materialDigest
			)
				throw new IntentConflictError('This is not the admitted run.')
			if (reason === 'WORK_AUTHORITY_EXPIRED' && row.authority_live) return false
			await db.query(`UPDATE turn_outbox SET state='blocked',error_code=$2 WHERE turn_id=$1`, [
				reference.turnId,
				reason
			])
			await db.query(
				'UPDATE intents SET version=version+1,updated_at=clock_timestamp() WHERE id=$1',
				[row.intent_id]
			)
			return true
		})
	}

	#placement(placement: WorkerPlacement) {
		workerPlacementSchema.parse(placement)
		if (
			placement.componentRef !== 'ceo.aven:component:data:intents@1' ||
			placement.exp <= Date.now() / 1000 ||
			placement.iat > Date.now() / 1000
		)
			throw new IntentConflictError('Worker placement has ended.')
	}

	async #pending(
		scope: Pick<TurnScope, 'environmentId' | 'generation'>,
		subjectId: string | null,
		limit: number
	) {
		return transaction(this.pool, async (db) => {
			await this.#active(db, scope)
			const result = await db.query(
				`SELECT t.turn_id,t.owner_subject_id FROM turn_outbox t
        JOIN intents i ON i.id=t.intent_id
        WHERE ($1::uuid IS NULL OR t.owner_subject_id=$1) AND i.owner_subject_id=t.owner_subject_id AND t.routing_generation=$2
        AND i.state IN ('working','waiting','done','error') AND t.state='pending'
        AND t.available_at <= clock_timestamp() AND (t.dispatch_until IS NULL OR t.dispatch_until <= clock_timestamp())
        AND NOT EXISTS(SELECT 1 FROM turn_outbox prior WHERE prior.intent_id=t.intent_id
          AND (prior.queue_position,prior.queue_revision)<(t.queue_position,t.queue_revision)
          AND prior.state IN ('pending','dispatched','blocked'))
        ORDER BY t.available_at,t.created_at,t.turn_id LIMIT $3`,
				[subjectId, scope.generation, limit]
			)
			return result.rows.map((row) => ({
				turnId: String(row.turn_id),
				scope: { ...scope, subjectId: String(row.owner_subject_id) }
			}))
		})
	}

	async claim(scope: TurnScope, turnId: string): Promise<TurnClaim> {
		return transaction(this.pool, async (db) => {
			const row = await this.#locked(db, scope, turnId)
			await this.#active(db, scope)
			if (row.state !== 'pending') return { state: row.state } as TurnClaim
			if (!row.authority_live) {
				await db.query(
					`UPDATE turn_outbox SET state='blocked',error_code='WORK_AUTHORITY_EXPIRED',
          dispatch_token=NULL,dispatch_until=NULL WHERE turn_id=$1`,
					[turnId]
				)
				return { state: 'blocked' }
			}
			if (row.dispatch_live || !row.available) return { state: 'waiting' }
			const earlier = await db.query(
				`SELECT 1 FROM turn_outbox WHERE intent_id=$1 AND (queue_position,queue_revision)<($2,$3)
        AND state IN ('pending','dispatched','blocked') LIMIT 1`,
				[row.intent_id, row.queue_position, row.queue_revision]
			)
			if (earlier.rowCount) return { state: 'waiting' }
			const token = randomUUID()
			const updated = await db.query(
				`UPDATE turn_outbox SET dispatch_token=$2,
        dispatch_until=LEAST(clock_timestamp()+interval '30 seconds',authority_expires_at),attempts=attempts+1,
        context_sequence=COALESCE(context_sequence,(SELECT max(sequence) FROM contributions WHERE intent_id=$3))
        WHERE turn_id=$1 RETURNING dispatch_until,context_sequence`,
				[turnId, token, row.intent_id]
			)
			return {
				state: 'claimed',
				dispatch: {
					turnId,
					intentId: row.intent_id,
					contributionId: row.contribution_id,
					outputId: row.output_id,
					sequence: Number(row.sequence),
					contextSequence: Number(updated.rows[0].context_sequence),
					token,
					expiresAt: updated.rows[0].dispatch_until.toISOString(),
					input: inputAdmissionSchema.parse(row.input),
					workGrant: row.work_grant
				}
			}
		})
	}

	/** A lost runner reply is retried with the same logical turn, never a new run key. */
	async dispatched(scope: TurnScope, turnId: string, token: string, runId: string): Promise<void> {
		z.uuid().parse(token)
		z.uuid().parse(runId)
		return transaction(this.pool, async (db) => {
			const row = await this.#locked(db, scope, turnId)
			await this.#active(db, scope)
			if (row.dispatch_token !== token) throw new IntentConflictError('Dispatch ownership ended.')
			if (row.run_id === runId && ['dispatched', 'completed', 'failed'].includes(row.state)) return
			if (row.state !== 'pending' || !row.dispatch_live || !row.authority_live)
				throw new IntentConflictError('Dispatch ownership ended.')
			await db.query(
				`UPDATE turn_outbox SET state='dispatched',run_id=$2,dispatched_at=clock_timestamp(),
        dispatch_until=NULL,error_code=NULL WHERE turn_id=$1`,
				[turnId, runId]
			)
		})
	}

	/** Pin the prior history once; queued later human inputs are not this turn's context. */
	async history(scope: TurnScope, turnId: string, runId: string) {
		z.uuid().parse(runId)
		return transaction(this.pool, async (db) => {
			const row = await this.#locked(db, scope, turnId)
			await this.#active(db, scope)
			if (row.state !== 'dispatched' || row.run_id !== runId)
				throw new IntentConflictError('Turn is not executing.')
			const rows = await db.query(
				`SELECT c.id,c.sequence,c.contributor_kind,c.kind,c.text,c.payload,c.created_at,t.state AS work_state
        FROM contributions c LEFT JOIN input_admissions a ON a.contribution_id=c.id
        LEFT JOIN turn_outbox t ON t.turn_id=a.turn_id
        WHERE c.intent_id=$1 AND c.sequence<=$2 AND c.id<>$3
          AND (a.sequence IS NULL OR (t.queue_position,t.queue_revision)<($4,$5))
          ORDER BY c.sequence DESC LIMIT 81`,
				[
					row.intent_id,
					row.context_sequence,
					row.contribution_id,
					row.queue_position,
					row.queue_revision
				]
			)
			return {
				watermark: Number(row.context_sequence),
				hasMore: rows.rows.length > 80,
				contributions: rows.rows.slice(0, 80).reverse()
			}
		})
	}

	/** Commit the exact final contribution and release FIFO together. Replays cannot rewrite it.
	 * The caller must hold the runner execution lease before crossing this publication boundary.
	 */
	async finish(
		scope: TurnScope,
		turnId: string,
		runId: string,
		value: TurnFinish
	): Promise<string> {
		z.uuid().parse(runId)
		const output = turnFinishSchema.parse(value),
			digest = createHash('sha256').update(stable(output)).digest('hex')
		return transaction(this.pool, async (db) => {
			const row = await this.#locked(db, scope, turnId)
			if (row.run_id !== runId) throw new IntentConflictError('This result belongs to another run.')
			if (row.finish_digest) {
				if (row.finish_digest !== digest)
					throw new IntentConflictError('This turn already has a different result.')
				return String(row.output_id)
			}
			await this.#active(db, scope)
			if (row.state !== 'dispatched')
				throw new IntentConflictError('This turn is no longer executing.')
			await insertContribution(
				db,
				row.intent_id,
				{
					id: row.output_id,
					contributorKind: 'agent',
					kind: 'message',
					text: output.text,
					payload: { ...output.payload, turnId, runId, outcome: output.state }
				},
				`turn:${turnId}`
			)
			await db.query(
				`UPDATE turn_outbox SET state=$2,finish_digest=$3,finished_at=clock_timestamp() WHERE turn_id=$1`,
				[turnId, output.state, digest]
			)
			await db.query(
				'UPDATE intents SET version=version+1,updated_at=clock_timestamp() WHERE id=$1',
				[row.intent_id]
			)
			return String(row.output_id)
		})
	}
}
