/**
 * The pure-JSON contract for a universal import: how to read a source, and how to
 * map its rows onto one or more (`n+`) target collections. A new source type is
 * onboarded by writing one of these — no bespoke code.
 */

export type FieldType = 'text' | 'int' | 'number' | 'datetime' | 'bool'

export interface FieldRule {
	/** Source column to read from. */
	from?: string
	/** Constant literal (ignores the source row entirely). */
	const?: unknown
	/** Coerce the raw cell to this type. Default `text`. */
	type?: FieldType
	/** Decimal separator for `number` (e.g. `,` for German exports). Default `.`. */
	decimal?: string
	/** Thousands separator to strip for `number` (e.g. `.`). */
	thousands?: string
	/** Input format for `datetime`; tokens: YYYY MM DD HH mm ss (e.g. `DD.MM.YYYY HH:mm:ss`). */
	format?: string
	/** Empty/null source → `null` instead of `default`. */
	nullable?: boolean
	/** Fallback when the source column is absent or empty. */
	default?: unknown
}

export interface ParentRel {
	/** Name of the parent target collection. */
	target: string
	/** Map of `{ parentKeyColumn: childSourceColumn }` used to match a child to its parent. */
	match: Record<string, string>
	/** Property on the parent under which matched children are nested (e.g. `lines`). */
	as: string
}

export interface TargetConfig {
	/** Collection name (also the key used in the assembled output). */
	name: string
	/** Source columns whose combined value uniquely identifies a target row (dedup key). */
	key: string[]
	/** Output field name → mapping rule. */
	fields: Record<string, FieldRule>
	/** When set, this target is nested into a parent rather than emitted at the root. */
	parent?: ParentRel
}

export interface SourceConfig {
	format: 'csv'
	/** Field delimiter. Default `,`. */
	delimiter?: string
	/** First row holds column names. Default `true`. */
	headerRow?: boolean
	/** Cell values treated as empty/null (e.g. `["—", ""]`). Default `[""]`. */
	nullValues?: string[]
	/** Source columns that uniquely identify a source row (provenance ref). */
	rowRef: string[]
}

export interface IngestConfig {
	/** Stable config id (also the source classification slug). */
	id: string
	version: number
	source: SourceConfig
	targets: TargetConfig[]
	/** Skip the whole run when the same file content was already ingested. Default `true`. */
	skipDuplicateFiles?: boolean
}

export class ConfigError extends Error {}

/** Structural validation — throws `ConfigError` on the first problem found. */
export function validateConfig(config: IngestConfig): IngestConfig {
	if (!config.id) throw new ConfigError('config.id is required')
	if (config.source?.format !== 'csv')
		throw new ConfigError('only source.format "csv" is supported')
	if (!Array.isArray(config.source.rowRef) || config.source.rowRef.length === 0) {
		throw new ConfigError('source.rowRef must list at least one column')
	}
	if (!Array.isArray(config.targets) || config.targets.length === 0) {
		throw new ConfigError('config.targets must list at least one target')
	}
	const names = new Set<string>()
	for (const t of config.targets) {
		if (!t.name) throw new ConfigError('every target needs a name')
		if (names.has(t.name)) throw new ConfigError(`duplicate target name: ${t.name}`)
		names.add(t.name)
		if (!Array.isArray(t.key) || t.key.length === 0) {
			throw new ConfigError(`target "${t.name}" needs a non-empty key`)
		}
		if (!t.fields || Object.keys(t.fields).length === 0) {
			throw new ConfigError(`target "${t.name}" needs at least one field`)
		}
	}
	// Parent relations must point at a declared target and a valid nesting key.
	for (const t of config.targets) {
		if (!t.parent) continue
		const parent = config.targets.find((p) => p.name === t.parent?.target)
		if (!parent) throw new ConfigError(`target "${t.name}" parent "${t.parent.target}" not found`)
		if (parent.name === t.name) throw new ConfigError(`target "${t.name}" cannot parent itself`)
		for (const pcol of parent.key) {
			if (!(pcol in t.parent.match)) {
				throw new ConfigError(
					`target "${t.name}" parent.match is missing parent key column "${pcol}"`
				)
			}
		}
	}
	return config
}

/** Targets emitted at the root of the assembled output (those without a parent). */
export function rootTargets(config: IngestConfig): TargetConfig[] {
	return config.targets.filter((t) => !t.parent)
}

/** Child targets that nest into the given parent target name. */
export function childTargets(config: IngestConfig, parentName: string): TargetConfig[] {
	return config.targets.filter((t) => t.parent?.target === parentName)
}
