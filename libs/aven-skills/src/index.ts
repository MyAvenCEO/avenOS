/**
 * @avenos/aven-skills — generic, config-driven data ingestor.
 *
 * A source → map → target import is described entirely by a pure-JSON `IngestConfig`
 * and run through a deterministic serial pipeline (ingest → parse → transform → dedup
 * → assemble). Imports are idempotent and every target row keeps provenance back to
 * its source doc. See `configs/` for ready-made configs and the README for the model.
 */

export { coerceValue } from './coerce'
export {
	ConfigError,
	childTargets,
	type FieldRule,
	type FieldType,
	type IngestConfig,
	type ParentRel,
	rootTargets,
	type SourceConfig,
	type TargetConfig,
	validateConfig
} from './ingestor/config'
export {
	createIngestor,
	INGEST_STAGES,
	type Ingestor,
	type IngestorOptions,
	type IngestReport,
	type IngestStageName
} from './ingestor/ingestor'
export {
	defaultPorts,
	type HashPort,
	type IngestorPorts,
	memoryUploaderPort,
	type UploaderPort,
	type UploadInput,
	type UploadResult,
	webCryptoHashPort
} from './ingestor/ports'
export type { AssembledOutput } from './ingestor/stages/assemble'
export type { RawSource, SourceDoc } from './ingestor/stages/ingest'
export type { ParsedSource } from './ingestor/stages/parse-csv'
export type { SourceRef } from './ingestor/stages/transform'
export { IngestStore, type StoredRow, type UpsertStats } from './ingestor/store'
export {
	consoleLogger,
	type Logger,
	type LogLevel,
	type PipelineContext,
	type Stage,
	type StageEvent,
	type StagePhase,
	silentLogger,
	stage
} from './pipeline/types'

import type { RawSource } from './ingestor/stages/ingest'

/** Build a `RawSource` from a UTF-8 string — handy for tests and pasted data. */
export function textSource(filename: string, text: string, mimeType = 'text/csv'): RawSource {
	return { filename, mimeType, bytes: new TextEncoder().encode(text) }
}
