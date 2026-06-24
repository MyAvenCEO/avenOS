// Generic structured-document view-model. Every doctype mapper (invoice / bank-statement /
// contract) flattens its raw extracted JSON into this ONE shape, which the shared _doc view
// renders — "1 generic template + n per-type mappers" (board 0064). The view has no $if, so a
// section simply omits a kind by leaving its array empty (the engine renders nothing for []).

/** A key/value row (e.g. "Rechnungs-Nr." → "R-2026-1842"). */
export type DocKvRow = { k: string; v: string }

/** A party / address card: a small heading (role), an optional emphasized name, + detail lines. */
export type DocCard = { title: string; name: string; lines: { line: string }[] }

/** Table header cell. `align` is a full, non-empty class string (engine rejects empty class). */
export type DocColumn = { label: string; align: string }

/** Table body cell. `align` mirrors the column's class. */
export type DocCell = { text: string; align: string }

/** Table body row. */
export type DocRow = { cells: DocCell[] }

/** One section. Any kind it doesn't use stays an empty array. */
export type DocSection = {
	title: string
	cards: DocCard[]
	rows: DocKvRow[]
	columns: DocColumn[]
	tableRows: DocRow[]
}

/** The full view-model handed to the _doc vibe as `source`. */
export type DocView = {
	title: string
	subtitle: string
	sections: DocSection[]
}
