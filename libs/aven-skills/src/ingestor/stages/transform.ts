import { coerceValue } from '../../coerce'
import { type Stage, stage } from '../../pipeline/types'
import type { IngestConfig, TargetConfig } from '../config'
import { keyFromRow, parentKeyFromChild } from '../keys'
import type { StoredRow } from '../store'
import type { ParsedSource } from './parse-csv'

/** Provenance recorded on every target row — links it back to its source doc + row. */
export interface SourceRef {
	ingestId: string
	fileId: string
	contentSha256: string
	/** The source row's unique ref id (`source.rowRef`). */
	sourceRef: string
}

export type TransformOutput = Record<string, StoredRow[]>

function mapRow(target: TargetConfig, row: Record<string, string>): Record<string, unknown> {
	const out: Record<string, unknown> = {}
	for (const [field, rule] of Object.entries(target.fields)) {
		const raw = rule.from !== undefined ? row[rule.from] : undefined
		out[field] = coerceValue(raw, rule)
	}
	return out
}

/**
 * Stage 3 — pure mapping from source rows to one-or-more target collections. Each
 * emitted row carries its dedup key, an optional parent key (for later nesting), and
 * `_source` provenance pointing back at the ingest doc + originating row.
 */
export function makeTransformStage(config: IngestConfig): Stage<ParsedSource, TransformOutput> {
	return stage('transform', (input, ctx) => {
		const out: TransformOutput = {}
		for (const target of config.targets) out[target.name] = []

		input.rows.forEach((row, idx) => {
			const source: SourceRef = {
				ingestId: ctx.runId,
				fileId: input.fileId,
				contentSha256: input.contentSha256,
				sourceRef: input.rowRefs[idx]
			}
			for (const target of config.targets) {
				const data = mapRow(target, row)
				data._source = source
				const entry: StoredRow = { key: keyFromRow(row, target.key), data }
				if (target.parent) {
					const parent = config.targets.find((t) => t.name === target.parent?.target)
					if (parent) {
						entry.parentKey = parentKeyFromChild(row, parent.key, target.parent.match)
					}
				}
				out[target.name].push(entry)
			}
		})

		const summary = Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length]))
		ctx.logger.log('info', 'transform', 'mapped rows per target', summary)
		return out
	})
}
