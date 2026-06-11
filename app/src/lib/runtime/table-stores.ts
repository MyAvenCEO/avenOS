import { type Readable, type Writable, writable } from 'svelte/store'

/** Per-table row snapshots pushed via `avenos:runtime` `{ kind: 'table' }`. */
const tableStores = new Map<string, Writable<unknown[]>>()

export function getTableRowsStore(table: string): Writable<unknown[]> {
	let w = tableStores.get(table)
	if (!w) {
		w = writable<unknown[]>([])
		tableStores.set(table, w)
	}
	return w
}

/** Clear all table stores on vault lock / reset. */
export function resetAllTableRowStores(): void {
	for (const s of tableStores.values()) {
		s.set([])
	}
	tableStores.clear()
}

export function tableRowsReadable(table: string): Readable<unknown[]> {
	return getTableRowsStore(table)
}
