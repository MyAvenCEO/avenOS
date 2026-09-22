import type { ExecutionBinding, WorkGrantClaims } from '@avenos/aven-customer-contracts'
import { WorkExecutionEnded } from '@avenos/aven-customer-runtime'
import type pg from 'pg'
import type { StudioV2DraftRecord } from './studio-v2-drafts.js'
import { assertWorkLease } from './work-lease.js'

/** Host-only identity for one journaled authoring invocation. Never model input. */
export interface StudioDraftOperation {
	work: WorkGrantClaims
	execution: ExecutionBinding
	invocationId: string
}

/** Lock the owning invocation before saving. The draft and its exact receipt commit
 * together; lease takeover and competing receipts serialize with that commit.
 * Callers must also exchange fresh work authority before opening this transaction.
 * Intent Stop is a separate service boundary: an already-admitted edit may finish,
 * and its exact receipt remains available for settlement.
 */
export async function lockDraftOperation(
	db: pg.PoolClient,
	operation: StudioDraftOperation,
	subject: string
) {
	const { work, execution, invocationId } = operation
	if (work.sub !== subject) throw new WorkExecutionEnded('Studio operation owner does not match.')
	// Same lock order as the engine journal: run first, then its invocation.
	const run = await db.query('SELECT id FROM runs WHERE id=$1 AND subject_id=$2 FOR UPDATE', [
		execution.runId,
		subject
	])
	if (!run.rowCount) throw new WorkExecutionEnded('Studio operation owner does not match.')
	await assertWorkLease(db, work, execution)
	const found = await db.query(
		`SELECT invocation_id FROM run_steps
    WHERE run_id=$1 AND invocation_id=$2 AND kind='tool' AND state='pending' FOR UPDATE`,
		[execution.runId, invocationId]
	)
	if (!found.rowCount) throw new WorkExecutionEnded('Studio operation is not pending in this turn.')
}

export async function readDraftReceipt(
	db: Pick<pg.Pool, 'query'>,
	operation: StudioDraftOperation
): Promise<StudioV2DraftRecord | null> {
	const found = await db.query(
		`SELECT d.snapshot FROM studio_draft_receipts d
    JOIN run_steps s ON s.invocation_id=d.invocation_id JOIN runs r ON r.id=s.run_id
    WHERE d.invocation_id=$1 AND r.id=$2 AND r.subject_id=$3 AND s.kind='tool'`,
		[operation.invocationId, operation.execution.runId, operation.work.sub]
	)
	return found.rows[0]?.snapshot ?? null
}

export async function recordDraftReceipt(
	db: pg.PoolClient,
	operation: StudioDraftOperation,
	draft: StudioV2DraftRecord
) {
	const bytes = Buffer.byteLength(JSON.stringify(draft))
	const prior = await db.query(
		`SELECT COALESCE(sum(octet_length(d.snapshot::text)),0) AS bytes
    FROM studio_draft_receipts d JOIN run_steps s ON s.invocation_id=d.invocation_id WHERE s.run_id=$1`,
		[operation.execution.runId]
	)
	if (bytes > 2 * 1024 * 1024 || Number(prior.rows[0].bytes) + bytes > 16 * 1024 * 1024)
		throw Error('Studio draft receipt capacity reached; this edit was not saved.')
	await db.query('INSERT INTO studio_draft_receipts(invocation_id,snapshot) VALUES($1,$2)', [
		operation.invocationId,
		draft
	])
}
