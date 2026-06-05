import { type Stage, stage } from '../../pipeline/types'
import { childTargets, type IngestConfig, rootTargets } from '../config'
import type { IngestStore } from '../store'
import type { DedupStats } from './dedup'

/** Root target name → array of fully-nested rows. */
export type AssembledOutput = Record<string, Record<string, unknown>[]>

interface BuiltRow {
	key: string
	parentKey?: string
	data: Record<string, unknown>
}

/**
 * Stage 5 — read the whole store and nest child collections into their parents per
 * the `parent` relations, producing the final shaped output (e.g. orders with their
 * `lines`). Reads the accumulated store, so the output always reflects every ingest
 * so far, not just the latest file. Supports arbitrary nesting depth.
 */
export function makeAssembleStage(
	config: IngestConfig,
	store: IngestStore
): Stage<DedupStats, AssembledOutput> {
	function buildSubtree(targetName: string): BuiltRow[] {
		const kids = childTargets(config, targetName).map((ct) => {
			const byParent = new Map<string, Record<string, unknown>[]>()
			for (const built of buildSubtree(ct.name)) {
				const pk = built.parentKey ?? ''
				const arr = byParent.get(pk) ?? []
				arr.push(built.data)
				byParent.set(pk, arr)
			}
			// biome-ignore lint/style/noNonNullAssertion: childTargets only returns targets with a parent
			return { as: ct.parent!.as, byParent }
		})
		return store.entries(targetName).map((entry) => {
			const data = { ...entry.data }
			for (const kid of kids) data[kid.as] = kid.byParent.get(entry.key) ?? []
			return { key: entry.key, parentKey: entry.parentKey, data }
		})
	}

	return stage('assemble', (_input, ctx) => {
		const out: AssembledOutput = {}
		for (const root of rootTargets(config)) {
			out[root.name] = buildSubtree(root.name).map((r) => r.data)
		}
		const summary = Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length]))
		ctx.logger.log('info', 'assemble', 'nested output ready', summary)
		return out
	})
}
