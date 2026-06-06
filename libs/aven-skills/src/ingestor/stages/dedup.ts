import { type Stage, stage } from '../../pipeline/types'
import type { IngestStore, UpsertStats } from '../store'
import type { TransformOutput } from './transform'

export type DedupStats = Record<string, UpsertStats>

/**
 * Stage 4 — merge the transformed rows into the persistent in-memory store. The
 * store dedups by key, so this is where idempotency happens: re-ingesting the same
 * content yields `{ added: 0 }` for every target.
 */
export function makeDedupStage(store: IngestStore): Stage<TransformOutput, DedupStats> {
	return stage('dedup', (input, ctx) => {
		const stats: DedupStats = {}
		for (const [target, rows] of Object.entries(input)) {
			stats[target] = store.upsertMany(target, rows)
		}
		ctx.logger.log('info', 'dedup', 'merged into store', stats)
		return stats
	})
}
