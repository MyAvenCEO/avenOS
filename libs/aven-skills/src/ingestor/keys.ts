/** Field-separator that cannot appear in a CSV cell — joins composite key parts. */
const SEP = ''

/** Canonical, order-sensitive key string from a source row over the given columns. */
export function keyFromRow(row: Record<string, string>, cols: string[]): string {
	return cols.map((c) => (row[c] ?? '').trim()).join(SEP)
}

/**
 * Parent key string from a child's source row: read each parent key column through
 * the child→parent column mapping so it lines up with the parent's own key string.
 */
export function parentKeyFromChild(
	row: Record<string, string>,
	parentKeyCols: string[],
	match: Record<string, string>
): string {
	return parentKeyCols.map((pcol) => (row[match[pcol]] ?? '').trim()).join(SEP)
}
