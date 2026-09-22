import {
	type ExecutionBinding,
	executionBindingSchema,
	type WorkGrantClaims
} from '@avenos/aven-customer-contracts'
import { WorkExecutionEnded } from '@avenos/aven-customer-runtime'
import type pg from 'pg'

/** Internal read-only guard after certificate verification. The run's public
 * parameters contain references/digests only; the work certificate stays in Intents.
 */
export async function assertWorkLease(
	pool: Pick<pg.Pool, 'query'>,
	work: WorkGrantClaims,
	binding: ExecutionBinding
): Promise<number> {
	executionBindingSchema.parse(binding)
	if (binding.workId !== work.jti) throw new WorkExecutionEnded('Work execution ownership ended.')
	const found = await pool.query(
		`SELECT extract(epoch FROM (r.record->'lease'->>'expiresAt')::timestamptz) AS expires_at
    FROM runs r, aven_platform.environment_identity e
    WHERE e.singleton AND e.environment_id=$1 AND e.routing_generation=$2 AND e.execution_enabled
      AND r.id=$3 AND r.subject_id=$4 AND r.state='running'
      AND r.record->'lease'->>'ownerId'=$5
      AND (r.record->'lease'->>'expiresAt')::timestamptz > clock_timestamp()
      AND r.record->'parameters'->>'turnId'=$6
      AND r.record->'parameters'->>'inputId'=$7
      AND r.record->'parameters'->>'inputRevision'=$8
      AND r.record->'parameters'->>'materialDigest'=$9`,
		[
			work.environmentId,
			work.routingGeneration,
			binding.runId,
			work.sub,
			binding.leaseOwnerId,
			binding.turnId,
			work.inputId,
			String(work.inputRevision),
			work.materialDigest
		]
	)
	if (!found.rowCount) throw new WorkExecutionEnded('Work execution ownership ended.')
	return Math.floor(Number(found.rows[0].expires_at))
}
