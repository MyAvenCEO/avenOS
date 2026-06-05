import { type Stage, stage } from '../../pipeline/types'
import type { SourceConfig } from '../config'
import { keyFromRow } from '../keys'
import type { SourceDoc } from './ingest'

/** Source after parsing — the extracted source schema + rows + per-row ref ids. */
export interface ParsedSource extends SourceDoc {
	/** Extracted source schema: the column names, in order. */
	columns: string[]
	/** One record per data row, column-name → cell. */
	rows: Record<string, string>[]
	/** Unique source ref id per row (from `source.rowRef`), aligned with `rows`. */
	rowRefs: string[]
}

const decoder = new TextDecoder('utf-8')

/** Minimal RFC-4180-ish CSV reader: honors quotes, escaped quotes, CRLF, and a configurable delimiter. */
function parseCsv(text: string, delimiter: string): string[][] {
	const rows: string[][] = []
	let field = ''
	let row: string[] = []
	let inQuotes = false
	let i = 0
	const pushField = () => {
		row.push(field)
		field = ''
	}
	const pushRow = () => {
		pushField()
		rows.push(row)
		row = []
	}
	while (i < text.length) {
		const c = text[i]
		if (inQuotes) {
			if (c === '"') {
				if (text[i + 1] === '"') {
					field += '"'
					i += 2
					continue
				}
				inQuotes = false
				i += 1
				continue
			}
			field += c
			i += 1
			continue
		}
		if (c === '"') {
			inQuotes = true
			i += 1
			continue
		}
		if (c === delimiter) {
			pushField()
			i += 1
			continue
		}
		if (c === '\r') {
			i += 1
			continue
		}
		if (c === '\n') {
			pushRow()
			i += 1
			continue
		}
		field += c
		i += 1
	}
	// Trailing field/row (no final newline).
	if (field !== '' || row.length > 0) pushRow()
	return rows
}

/**
 * Stage 2 — decode + parse the CSV into the source schema (`columns`) and a list of
 * row records, normalizing configured null values, and deriving the unique per-row
 * ref id used for provenance.
 */
export function makeParseCsvStage(source: SourceConfig): Stage<SourceDoc, ParsedSource> {
	const delimiter = source.delimiter ?? ','
	const headerRow = source.headerRow !== false
	const nullValues = new Set(source.nullValues ?? [''])

	return stage('parse', (input, ctx) => {
		const text = decoder.decode(input.bytes)
		const grid = parseCsv(text, delimiter).filter((r) => !(r.length === 1 && r[0] === ''))
		if (grid.length === 0) {
			return { ...input, columns: [], rows: [], rowRefs: [] }
		}
		const columns = headerRow ? grid[0].map((c) => c.trim()) : grid[0].map((_, idx) => `col${idx}`)
		const dataRows = headerRow ? grid.slice(1) : grid

		const rows: Record<string, string>[] = []
		for (const cells of dataRows) {
			const rec: Record<string, string> = {}
			columns.forEach((col, idx) => {
				const raw = (cells[idx] ?? '').trim()
				rec[col] = nullValues.has(raw) ? '' : raw
			})
			rows.push(rec)
		}
		const rowRefs = rows.map((r) => keyFromRow(r, source.rowRef))
		ctx.logger.log('info', 'parse', `parsed ${rows.length} rows × ${columns.length} cols`, {
			columns
		})
		return { ...input, columns, rows, rowRefs }
	})
}
