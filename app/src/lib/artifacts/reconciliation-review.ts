import type { ReconciliationReview } from '@avenos/document-ingest/reconciliation-flow'

/** Ranking is exhaustive; an unsolicited review must have a positive matching signal.
 * Other candidates remain inspectable by the agent and explicitly reviewable.
 * This is attention filtering, never an accounting decision or an acceptance policy.
 */
export function shouldSuggestReconciliation(candidate: ReconciliationReview['candidate']): boolean {
	return (
		candidate.recommendation !== 'reject' &&
		(candidate.referenceMatch === 'exact' ||
			candidate.ibanMatch ||
			candidate.counterpartyMatch !== 'none' ||
			(candidate.amountDistanceMinor === 0 && candidate.signMatch === 'match'))
	)
}
