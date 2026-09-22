import type { WorkerPlacement } from '@avenos/aven-customer-contracts'
import { journalDigest, TurnRecoveryRequired } from '@avenos/chat-engine/journal'
import { capturePriorActions } from '@avenos/chat-engine/prior-actions'
import type { TurnRunReference } from '@avenos/intents/work'
import type pg from 'pg'
import { z } from 'zod'
import { observeTurnRun } from './turn-observation.js'

const timing = z
	.object({
		startedAt: z.number().finite().nonnegative(),
		durationMs: z.number().finite().nonnegative(),
		basis: z.enum(['execution', 'receipt-check', 'read-again', 'recomputed']),
		firstContentMs: z.number().finite().nonnegative().optional()
	})
	.strict()
const toolCheckpoint = z
	.object({
		kind: z.literal('tool'),
		command: z
			.object({ name: z.string().min(1).max(160), args: z.string().max(3 * 1024 * 1024) })
			.strict(),
		result: z.object({ record: z.string(), wire: z.string(), timing: timing.optional() }).strict(),
		timing
	})
	.strict()

/** Completion can be saved just before its executor settles. Wait at readiness,
 * before taking a new execution lease; an invalid/uncertain record instead reaches
 * the strict reader and fails closed without a model request. */
export async function replacementActionsReady(
	pool: pg.Pool,
	placement: Pick<WorkerPlacement, 'environmentId' | 'routingGeneration'>,
	references: TurnRunReference[]
) {
	if (references.length > 16) throw new TurnRecoveryRequired('Invalid replacement ancestry.')
	for (const reference of references)
		if ((await observeTurnRun(pool, placement, reference))?.settlement === 'pending') return false
	return true
}

/** All-or-nothing transfer. The bounded, verified ancestry comes from the Intent
 * service; every run must also be terminal and every effect settled in this runner. */
export async function readReplacementActions(
	pool: pg.Pool,
	placement: Pick<WorkerPlacement, 'environmentId' | 'routingGeneration'>,
	references: TurnRunReference[]
) {
	if (
		references.length > 16 ||
		new Set(references.map((ref) => ref.turnId)).size !== references.length
	)
		throw new TurnRecoveryRequired('Invalid replacement ancestry.')
	const receipts = []
	for (const reference of references) {
		for (const receipt of await readSettledChatReceipts(pool, placement, reference)) {
			receipts.push({
				turnId: receipt.turnId,
				runId: receipt.runId,
				invocationId: receipt.invocationId,
				ordinal: receipt.ordinal,
				name: receipt.command.name,
				arguments: receipt.command.args,
				result: receipt.result.record
			})
		}
	}
	try {
		return capturePriorActions(receipts)
	} catch {
		throw new TurnRecoveryRequired('Prior actions exceed the replacement inspection bound.')
	}
}

/** Private worker-side inspection, not an HTTP endpoint or a new execution path.
 * The caller must obtain the reference from an authorized same-Intent relation;
 * model-supplied run IDs are not authority. Never return partial/uncertain receipts.
 * Inspection does not grant permission to repeat or undo any recorded command. */
export async function readSettledChatReceipts(
	pool: pg.Pool,
	placement: Pick<WorkerPlacement, 'environmentId' | 'routingGeneration'>,
	reference: TurnRunReference
) {
	const db = await pool.connect()
	try {
		await db.query('BEGIN')
		const status = await observeTurnRun(db, placement, reference, true)
		if (!status || status.settlement !== 'settled')
			throw new TurnRecoveryRequired('Prior turn receipts are not available as settled evidence.')
		const rows = await db.query(
			`SELECT ordinal,invocation_id,material_digest,value FROM run_steps
        WHERE run_id=$1 AND kind='tool' ORDER BY ordinal LIMIT 257`,
			[reference.runId]
		)
		if (rows.rows.length > 256 || Buffer.byteLength(JSON.stringify(rows.rows)) > 16 * 1024 * 1024)
			throw new TurnRecoveryRequired('Prior turn receipts exceed the inspection bound.')
		const receipts = []
		for (const row of rows.rows) {
			const value = toolCheckpoint.safeParse(row.value)
			if (!value.success || (await journalDigest(value.data.command)) !== row.material_digest)
				throw new TurnRecoveryRequired('A prior tool receipt does not match its recorded command.')
			receipts.push({
				turnId: reference.turnId,
				runId: reference.runId,
				ordinal: row.ordinal as number,
				invocationId: z.uuid().parse(row.invocation_id),
				...value.data
			})
		}
		await db.query('COMMIT')
		return receipts
	} catch (error) {
		await db.query('ROLLBACK').catch(() => {})
		throw error
	} finally {
		db.release()
	}
}
