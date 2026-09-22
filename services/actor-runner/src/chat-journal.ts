import { randomUUID } from 'node:crypto'
import {
	type JournalClaim,
	type JournalValue,
	journalDigest,
	type TurnJournal,
	TurnRecoveryRequired
} from '@avenos/chat-engine/journal'
import type pg from 'pg'

/** No caller-selected table/schema; the pool is already bound to one customer component. */
export class SqlChatJournal implements TurnJournal {
	constructor(
		private readonly pool: pg.Pool,
		private readonly runId: string,
		private readonly ownerId: string,
		private readonly engineDigest: string
	) {
		if (!/^[a-f0-9]{64}$/.test(engineDigest))
			throw Error('A pinned chat-engine digest is required.')
	}
	async #transaction<T>(action: (db: pg.PoolClient) => Promise<T>): Promise<T> {
		const db = await this.pool.connect()
		try {
			await db.query('BEGIN')
			const run = await db.query<{ journal_engine: string | null }>(
				`SELECT journal_engine FROM runs
				WHERE id=$1 AND state='running' AND record->'lease'->>'ownerId'=$2
				AND (record->'lease'->>'expiresAt')::timestamptz > clock_timestamp() FOR UPDATE`,
				[this.runId, this.ownerId]
			)
			if (!run.rows[0]) throw new TurnRecoveryRequired('Turn execution ownership ended.')
			if (run.rows[0].journal_engine && run.rows[0].journal_engine !== this.engineDigest)
				throw new TurnRecoveryRequired('This turn needs its original engine to recover safely.')
			if (!run.rows[0].journal_engine)
				await db.query(
					`UPDATE runs SET journal_engine=$2,
				journal_started_at=clock_timestamp() WHERE id=$1`,
					[this.runId, this.engineDigest]
				)
			const result = await action(db)
			await db.query('COMMIT')
			return result
		} catch (error) {
			await db.query('ROLLBACK').catch(() => {})
			throw error
		} finally {
			db.release()
		}
	}
	async startedAt(): Promise<string> {
		return this.#transaction(async (db) => {
			const found = await db.query<{ journal_started_at: Date }>(
				'SELECT journal_started_at FROM runs WHERE id=$1',
				[this.runId]
			)
			return found.rows[0]!.journal_started_at.toISOString()
		})
	}
	async timing(): Promise<{ startedAt: number; durationMs?: number }> {
		return this.#transaction(async (db) => {
			const found = await db.query<{ journal_started_at: Date; elapsed_ms: number }>(
				`SELECT journal_started_at,
				(EXTRACT(EPOCH FROM (clock_timestamp()-journal_started_at))*1000)::double precision AS elapsed_ms
				FROM runs WHERE id=$1`,
				[this.runId]
			)
			const row = found.rows[0]!
			return {
				startedAt: row.journal_started_at.getTime(),
				...(row.elapsed_ms >= 0 && { durationMs: row.elapsed_ms })
			}
		})
	}
	claim(ordinal: number, kind: JournalValue['kind'], digest: string): Promise<JournalClaim> {
		if (
			!Number.isInteger(ordinal) ||
			ordinal < 0 ||
			ordinal >= 256 ||
			!['model', 'tool', 'outcome'].includes(kind) ||
			!/^[a-f0-9]{64}$/.test(digest)
		)
			return Promise.reject(new TurnRecoveryRequired('Invalid turn checkpoint.'))
		return this.#transaction(async (db) => {
			const prior = await db.query(`SELECT * FROM run_steps WHERE run_id=$1 AND ordinal=$2`, [
				this.runId,
				ordinal
			])
			const row = prior.rows[0]
			if (row) {
				if (row.kind !== kind || row.material_digest !== digest)
					throw new TurnRecoveryRequired('Recovered turn no longer matches its recorded inputs.')
				if (row.state === 'complete')
					return { state: 'complete', invocationId: row.invocation_id, value: row.value }
				// A model generation cannot have dispatched tools before its completion
				// checkpoint; a pending operation may already have had an external effect.
				return { state: kind === 'tool' ? 'uncertain' : 'new', invocationId: row.invocation_id }
			}
			const previous = await db.query<{ next: number }>(
				`SELECT COALESCE(max(ordinal)+1,0) AS next FROM run_steps WHERE run_id=$1`,
				[this.runId]
			)
			if (previous.rows[0]!.next !== ordinal)
				throw new TurnRecoveryRequired('Turn checkpoint sequence is incomplete.')
			const invocationId = randomUUID()
			await db.query(
				`INSERT INTO run_steps(run_id,ordinal,invocation_id,kind,material_digest) VALUES($1,$2,$3,$4,$5)`,
				[this.runId, ordinal, invocationId, kind, digest]
			)
			return { state: 'new', invocationId }
		})
	}
	async complete(ordinal: number, value: JournalValue): Promise<void> {
		const encoded = JSON.stringify(value)
		if (Buffer.byteLength(encoded) > 3 * 1024 * 1024)
			throw new TurnRecoveryRequired('Turn result exceeds its checkpoint bound.')
		if (
			value.kind === 'tool' &&
			(!value.command ||
				typeof value.command.name !== 'string' ||
				!value.command.name ||
				typeof value.command.args !== 'string')
		)
			throw new TurnRecoveryRequired('Tool checkpoint needs its exact command.')
		const commandDigest = value.kind === 'tool' ? await journalDigest(value.command) : null
		return this.#transaction(async (db) => {
			const prior = await db.query(
				'SELECT kind,state,value,material_digest FROM run_steps WHERE run_id=$1 AND ordinal=$2',
				[this.runId, ordinal]
			)
			const row = prior.rows[0]
			if (!row || row.kind !== value.kind)
				throw new TurnRecoveryRequired('No matching operation checkpoint exists.')
			if (commandDigest !== null && commandDigest !== row.material_digest)
				throw new TurnRecoveryRequired('Tool result does not match its claimed command.')
			if (row.state === 'complete') {
				const same = await db.query<{ same: boolean }>('SELECT $1::jsonb=$2::jsonb AS same', [
					row.value,
					encoded
				])
				if (!same.rows[0]!.same)
					throw new TurnRecoveryRequired('A completed checkpoint cannot change its result.')
				return
			}
			const size = await db.query<{ bytes: string }>(
				'SELECT COALESCE(sum(octet_length(value::text)),0) AS bytes FROM run_steps WHERE run_id=$1',
				[this.runId]
			)
			if (Number(size.rows[0]!.bytes) + Buffer.byteLength(encoded) > 16 * 1024 * 1024)
				throw new TurnRecoveryRequired(
					'Turn journal capacity reached; retained results were not discarded.'
				)
			await db.query(
				`UPDATE run_steps SET state='complete',value=$3,completed_at=clock_timestamp()
				WHERE run_id=$1 AND ordinal=$2`,
				[this.runId, ordinal, encoded]
			)
		})
	}
}
