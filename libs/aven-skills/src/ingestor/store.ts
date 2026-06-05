/**
 * In-memory target store. Idempotent by construction: each collection is a
 * `Map<keyString, row>`, so re-ingesting the same source only inserts keys not yet
 * present (first write wins — existing rows are never clobbered). This is what makes
 * "throw the same file in as many times as you want" add only genuinely new data.
 */

export interface StoredRow {
	/** Dedup key (canonical string over the target's key columns). */
	key: string
	/** Parent key (children only) — links a row to its parent for nesting. */
	parentKey?: string
	/** The mapped, output-shaped data (includes `_source` provenance). */
	data: Record<string, unknown>
}

export interface UpsertStats {
	added: number
	skipped: number
}

export class IngestStore {
	private readonly tables = new Map<string, Map<string, StoredRow>>()

	upsertMany(target: string, rows: StoredRow[]): UpsertStats {
		const tbl = this.table(target)
		let added = 0
		let skipped = 0
		for (const row of rows) {
			if (tbl.has(row.key)) {
				skipped += 1
				continue
			}
			tbl.set(row.key, row)
			added += 1
		}
		return { added, skipped }
	}

	entries(target: string): StoredRow[] {
		return [...this.table(target).values()]
	}

	count(target: string): number {
		return this.table(target).size
	}

	private table(name: string): Map<string, StoredRow> {
		let m = this.tables.get(name)
		if (!m) {
			m = new Map()
			this.tables.set(name, m)
		}
		return m
	}
}
