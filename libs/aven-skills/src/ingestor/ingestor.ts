import { runStage } from '../pipeline/run'
import { type Logger, type PipelineContext, silentLogger } from '../pipeline/types'
import { type IngestConfig, validateConfig } from './config'
import { defaultPorts, type IngestorPorts } from './ports'
import { makeAssembleStage } from './stages/assemble'
import { type DedupStats, makeDedupStage } from './stages/dedup'
import { makeIngestStage, type RawSource } from './stages/ingest'
import { makeParseCsvStage } from './stages/parse-csv'
import { makeTransformStage } from './stages/transform'
import { IngestStore } from './store'

export interface IngestReport {
	/** Deterministic id for this run (`<config.id>@<sha-prefix>`). */
	runId: string
	fileId: string
	contentSha256: string
	/** True when the same content was already ingested and the run was skipped. */
	duplicateFile: boolean
	/** Per-target `{ added, skipped }`. */
	stats: DedupStats
	/** The full nested output across all ingests so far, keyed by root target. */
	output: Record<string, Record<string, unknown>[]>
}

export interface IngestorOptions {
	ports?: Partial<IngestorPorts>
	logger?: Logger
}

export interface Ingestor {
	/** The persistent in-memory target store (survives across `ingest` calls). */
	readonly store: IngestStore
	/** Run the full pipeline for one source file. */
	ingest(raw: RawSource): Promise<IngestReport>
	/** The current nested output without ingesting anything new. */
	output(): Record<string, Record<string, unknown>[]>
	/** Config id. */
	readonly id: string
}

/**
 * Build a reusable ingestor bound to one config. The deterministic serial pipeline:
 *   ingest → parse → transform → dedup → assemble
 * The store is held on the instance, so feeding the same file twice is a no-op and
 * feeding a superset only adds the new rows.
 */
export function createIngestor(rawConfig: IngestConfig, options: IngestorOptions = {}): Ingestor {
	const config = validateConfig(rawConfig)
	const ports: IngestorPorts = { ...defaultPorts(), ...options.ports }
	const logger = options.logger ?? silentLogger
	const store = new IngestStore()
	const seenFiles = new Set<string>()
	const skipDuplicateFiles = config.skipDuplicateFiles !== false

	const ingestStage = makeIngestStage(ports)
	const parseStage = makeParseCsvStage(config.source)
	const transformStage = makeTransformStage(config)
	const dedupStage = makeDedupStage(store)
	const assembleStage = makeAssembleStage(config, store)

	const assembleNow = (ctx: PipelineContext) =>
		assembleStage.run({}, ctx) as Record<string, Record<string, unknown>[]>

	async function ingest(raw: RawSource): Promise<IngestReport> {
		// We need the content hash to form the runId before the rest of the pipeline.
		const contentSha256 = await ports.hash.sha256Hex(raw.bytes)
		const runId = `${config.id}@${contentSha256.slice(0, 12)}`
		const ctx: PipelineContext = { runId, logger }

		const emptyStats: DedupStats = Object.fromEntries(
			config.targets.map((t) => [t.name, { added: 0, skipped: 0 }])
		)

		if (skipDuplicateFiles && seenFiles.has(contentSha256)) {
			logger.log('info', 'ingest', 'duplicate file — skipping', { contentSha256 })
			const output = assembleNow(ctx)
			return {
				runId,
				fileId: `mem:${contentSha256.slice(0, 16)}`,
				contentSha256,
				duplicateFile: true,
				stats: emptyStats,
				output
			}
		}

		const doc = await runStage(ctx, ingestStage, raw)
		const parsed = await runStage(ctx, parseStage, doc)
		const transformed = await runStage(ctx, transformStage, parsed)
		const stats = await runStage(ctx, dedupStage, transformed)
		const output = await runStage(ctx, assembleStage, stats)
		seenFiles.add(contentSha256)

		return { runId, fileId: doc.fileId, contentSha256, duplicateFile: false, stats, output }
	}

	function output(): Record<string, Record<string, unknown>[]> {
		return assembleNow({ runId: `${config.id}@output`, logger })
	}

	return { store, ingest, output, id: config.id }
}
