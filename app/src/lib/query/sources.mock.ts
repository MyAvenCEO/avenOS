import { registerSource, rowsAnswer } from './answer'

/**
 * The slice-1 source (0159). Mocked hits, real registry: it exists so the
 * fan-out is exercised by more than one implementation before the per-skill
 * sources arrive (slice 2), and so the shell can be looked at.
 *
 * Note what it does NOT do: it never tells the engine what a "person" is. It
 * hands back rows with a `shape` string and the renderer decides how to draw
 * them. Replacing this file with six real sources changes nothing else.
 */

interface Seed {
	source: string
	rows: { id: string; label: string; note?: string; shape: string }[]
}

const SEEDS: Seed[] = [
	{
		source: 'todos',
		rows: [
			{ id: 't1', label: 'Nachweis einreichen', note: 'fällig 12.09. · @me', shape: 'check' },
			{ id: 't2', label: 'Rechnung Bürostuhl bezahlen', note: 'bis 30.08.', shape: 'check' },
			{ id: 't3', label: 'Steuerunterlagen sortieren', note: 'offen', shape: 'check' }
		]
	},
	{
		source: 'contacts',
		rows: [
			{ id: 'p1', label: 'Techniker Krankenkasse', note: 'Firma · Versicherung', shape: 'person' },
			{ id: 'p2', label: 'Anna Berger', note: 'Steuerberatung', shape: 'person' }
		]
	},
	{
		source: 'calendar',
		rows: [{ id: 'c1', label: 'Frist Krankenkasse', note: '15.09. · ganztägig', shape: 'time' }]
	},
	{
		source: 'docs',
		rows: [
			{ id: 'd1', label: 'krankenkasse-brief.pdf', note: 'gescannt 12.08.', shape: 'doc' },
			{ id: 'd2', label: 'stromabrechnung-2024.pdf', note: 'Upload · heute', shape: 'doc' }
		]
	},
	{
		source: 'brain',
		rows: [{ id: 'b1', label: '[[Versicherungen 2025]]', note: '4 Verknüpfungen', shape: 'note' }]
	}
]

/** Everything a query matches, by the plainest possible rule. Slice 2 replaces
 * this with each skill answering for itself. */
function matches(query: string, label: string, note?: string): boolean {
	const q = query.trim().toLowerCase()
	if (q === '') return false
	return `${label} ${note ?? ''}`.toLowerCase().includes(q)
}

/**
 * The window source: the one answer shape that is not a list. Kept beside the
 * mocked hits so the modal can be seen doing both — and so `view` is a normal
 * source result rather than a special case in the engine.
 */
const WINDOWS: { key: string; title: string; words: string[] }[] = [
	{ key: 'list', title: 'Todos', words: ['todo', 'todos', 'liste', 'list'] },
	{ key: 'board', title: 'Kanban Board', words: ['board', 'kanban', 'brett'] }
]

export function registerMockSources(): void {
	for (const seed of SEEDS) {
		registerSource(seed.source, (q) =>
			[
				rowsAnswer(
					seed.source,
					seed.rows.filter((r) => matches(q, r.label, r.note))
				)
			].filter((a) => a.kind === 'rows' && a.rows.length > 0)
		)
	}

	registerSource('windows', (q) => {
		const words = q.trim().toLowerCase().split(/\s+/)
		return WINDOWS.filter((w) => w.words.some((word) => words.includes(word))).map((w) => ({
			kind: 'view' as const,
			id: `view:${w.key}`,
			window: w.key,
			title: w.title
		}))
	})
}
