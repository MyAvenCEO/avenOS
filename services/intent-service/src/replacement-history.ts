import { admissionDigest, inputAdmissionSchema } from '@avenos/intents/admission'
import { type TurnRunReference, turnRunReferenceSchema } from '@avenos/intents/work'
import type pg from 'pg'

export const MAX_REPLACEMENT_DEPTH = 16
export class ReplacementHistoryError extends Error {}

/** Only call while holding the owning Intent lock. Links come from immutable
 * admissions, never a model-selected run or an independently supplied receipt ID. */
export async function replacementHistory(
	db: pg.PoolClient,
	scope: { subjectId: string; intentId: string; generation: number },
	firstTurnId: string | null,
	settledOnly: boolean
): Promise<TurnRunReference[]> {
	const seen = new Set<string>(),
		references: TurnRunReference[] = []
	let id = firstTurnId
	while (id) {
		if (seen.has(id) || seen.size >= MAX_REPLACEMENT_DEPTH)
			throw new ReplacementHistoryError(
				'The edited message history exceeds the safe inspection bound.'
			)
		seen.add(id)
		const row = (
			await db.query(
				`SELECT t.turn_id,t.run_id,t.state,t.input,t.replaces_turn_id,
        a.input_id,a.revision,a.material_digest
        FROM turn_outbox t JOIN input_admissions a USING(turn_id)
        WHERE t.turn_id=$1 AND t.intent_id=$2 AND t.owner_subject_id=$3 AND t.routing_generation=$4
          AND a.intent_id=t.intent_id AND a.owner_subject_id=t.owner_subject_id`,
				[id, scope.intentId, scope.subjectId, scope.generation]
			)
		).rows[0]
		if (!row)
			throw new ReplacementHistoryError(
				'The edited message history is not available in this Intent.'
			)
		const input = inputAdmissionSchema.parse(row.input)
		if (
			input.inputId !== row.input_id ||
			input.revision !== row.revision ||
			(await admissionDigest(input)) !== row.material_digest ||
			(input.replaces?.turnId ?? null) !== row.replaces_turn_id
		)
			throw new ReplacementHistoryError(
				'The edited message history does not match its admitted input.'
			)
		if (settledOnly && !['cancelled', 'completed', 'failed'].includes(row.state))
			throw new ReplacementHistoryError('Earlier edited work is not settled yet.')
		if (row.run_id)
			references.push(
				turnRunReferenceSchema.parse({
					turnId: row.turn_id,
					runId: row.run_id,
					subjectId: scope.subjectId,
					inputId: row.input_id,
					inputRevision: row.revision,
					materialDigest: row.material_digest
				})
			)
		id = row.replaces_turn_id
	}
	return references.reverse()
}
