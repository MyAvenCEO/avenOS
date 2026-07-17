// In-memory PredicationStore — powers the pure engine tests and any DB-free caller. Deterministic
// ids (id-1, id-2, …) so tests can assert exact predication rows.

import type { Cell, Place, PredicationStore, Row } from './types.js'

type Stored = { id: string; predicate: string; cells: Record<string, Cell> }

export function memStore(seed: Stored[] = []): PredicationStore & { dump: () => Stored[] } {
	const data: Stored[] = seed.map((s) => ({ ...s, cells: { ...s.cells } }))
	let n = 0
	const nextId = () => `id-${++n}`
	return {
		async rows(predicate) {
			return data
				.filter((d) => d.predicate === predicate)
				.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
				.map((d) => ({ id: d.id, ...d.cells }) as Row)
		},
		async insert(predicate, cells) {
			const id = nextId()
			data.push({ id, predicate, cells: { ...cells } as Record<string, Cell> })
			return id
		},
		async patch(id, cells) {
			const row = data.find((d) => d.id === id)
			if (row) Object.assign(row.cells, cells)
		},
		async patchWhere(predicate, place, equals, cells) {
			for (const d of data)
				if (d.predicate === predicate && d.cells[place] === equals) Object.assign(d.cells, cells)
		},
		async deleteWhere(predicate, place: Place, equals) {
			for (let i = data.length - 1; i >= 0; i--) {
				const d = data[i]
				if (d.predicate === predicate && d.cells[place] === equals) data.splice(i, 1)
			}
		},
		async remove(id) {
			const i = data.findIndex((d) => d.id === id)
			if (i >= 0) data.splice(i, 1)
		},
		dump: () => data.map((d) => ({ id: d.id, predicate: d.predicate, cells: { ...d.cells } }))
	}
}
