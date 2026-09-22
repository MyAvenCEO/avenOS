import type { WorkerPlacement } from '@avenos/aven-customer-contracts'
import {
	type TurnRunReference,
	turnRunReferenceSchema,
	turnRunStatusSchema
} from '@avenos/intents/work'
import type pg from 'pg'
import { CHAT_TURN_SKILL } from './chat-executor.js'

/** Content-free observation shared by supervision and private receipt inspection.
 * Callers authenticate their placement before opening the customer-bound pool.
 * A locked observation must run inside the receipt reader's transaction. */
export async function observeTurnRun(
	db: Pick<pg.Pool, 'query'> | pg.PoolClient,
	placement: Pick<WorkerPlacement, 'environmentId' | 'routingGeneration'>,
	reference: TurnRunReference,
	locked = false
) {
	turnRunReferenceSchema.parse(reference)
	const result = await db.query(
		`SELECT r.state, r.record->'failure'->>'code' AS failure_code,
      r.id=ANY(e.execution_unsettled) AS execution_unsettled, s.pending_tool
      FROM runs r JOIN run_settlement s ON s.run_id=r.id
      CROSS JOIN aven_platform.environment_identity e WHERE e.singleton AND r.id=$1 AND r.subject_id=$2
      AND r.record->>'skillRef'=$3 AND r.record->>'executionEnvironment'='server'
      AND r.record->'parameters'->>'turnId'=$4 AND r.record->'parameters'->>'inputId'=$5
      AND r.record->'parameters'->>'inputRevision'=$6 AND r.record->'parameters'->>'materialDigest'=$7
      AND r.record->'security'->'access'->>'tenantId'=$8
      AND e.environment_id=$8::uuid AND e.routing_generation=$9 AND e.execution_enabled
      ${locked ? 'FOR SHARE OF r' : ''}`,
		[
			reference.runId,
			reference.subjectId,
			CHAT_TURN_SKILL,
			reference.turnId,
			reference.inputId,
			String(reference.inputRevision),
			reference.materialDigest,
			placement.environmentId,
			placement.routingGeneration
		]
	)
	const row = result.rows[0]
	if (!row) return null
	const state = ['accepted', 'planning', 'running'].includes(row.state)
		? 'active'
		: row.state === 'waiting_for_input'
			? 'waiting'
			: row.state
	// A terminal label cannot settle a still-running executor or uncertain write.
	const settlement =
		state === 'active' || state === 'waiting' || row.execution_unsettled
			? 'pending'
			: row.pending_tool || row.failure_code === 'EXECUTION_UNCERTAIN'
				? 'uncertain'
				: 'settled'
	return turnRunStatusSchema.parse({
		state,
		settlement,
		...(state === 'failed' && { uncertain: row.failure_code === 'EXECUTION_UNCERTAIN' })
	})
}
