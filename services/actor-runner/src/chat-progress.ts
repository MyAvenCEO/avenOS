import { turnProgressSchema } from '@avenos/intents/turn-progress'
import type pg from 'pg'
import { CHAT_TURN_SKILL } from './chat-executor.js'

/** Read the runner's existing projection, not its private execution journal. */
export async function readChatProgress(pool: pg.Pool, subjectId: string, turnId: string) {
	const found = await pool.query(
		`SELECT revision,state,updated_at,clock_timestamp() AS observed_at,
		record->'progress' AS progress,(record->'lease'->>'expiresAt')::timestamptz AS lease_expires_at
		FROM runs WHERE subject_id=$1 AND record->>'skillRef'=$2
		AND record#>>'{parameters,turnId}'=$3 LIMIT 2`,
		[subjectId, CHAT_TURN_SKILL, turnId]
	)
	if (!found.rowCount) return null
	if (found.rowCount !== 1) throw Error('Conversation progress has an ambiguous execution binding.')
	const row = found.rows[0],
		progress = row.progress
	if (progress && (progress.kind !== 'intent-turn' || progress.turnId !== turnId))
		throw Error('Conversation progress does not match its admitted turn.')
	const parsed = turnProgressSchema.safeParse({
		turnId,
		revision: Number(row.revision),
		state: row.state,
		updatedAt: new Date(row.updated_at).toISOString(),
		observedAt: new Date(row.observed_at).toISOString(),
		leaseExpiresAt: row.lease_expires_at ? new Date(row.lease_expires_at).toISOString() : null,
		operation: progress?.operation ?? null,
		steps: progress?.steps ?? []
	})
	if (!parsed.success) throw Error('Saved conversation progress is invalid.')
	return parsed.data
}
