import { expect, test } from 'bun:test'
import { lookupIntents, selectContextIntents } from '../src/lib/intents/context-selection'

const items = Array.from({ length: 500 }, (_, index) => ({
	id: `intent-${index}`,
	title: index === 472 ? 'Old invoice reconciliation' : `Matter ${index}`,
	type: 'auftrag',
	status: index === 472 ? 'archive' : 'working',
	source: 'Chat',
	routingSummary: index === 472 ? 'The invoice information is here' : undefined
}))

test('default context keeps the selected and recently opened intents within eight rows', () => {
	const selected = selectContextIntents(items, 'intent-499', ['intent-300', 'intent-10'])
	expect(selected).toHaveLength(8)
	expect(selected.slice(0, 3).map((item) => item.id)).toEqual([
		'intent-499',
		'intent-300',
		'intent-10'
	])
	expect(selected.some((item) => item.id === 'intent-472')).toBe(false)
})

test('search finds old archived work while unfiltered lookup pages through all intents', () => {
	const hit = lookupIntents(items, 'invoice information', 0, 20)
	expect(hit.total).toBe(1)
	expect(hit.rows[0].id).toBe('intent-472')
	const first = lookupIntents(items, '', 0, 500)
	expect(first.rows).toHaveLength(20)
	expect(first.hasMore).toBe(true)
	const second = lookupIntents(items, '', 20, 20)
	expect(second.rows[0].id).toBe('intent-20')
})

test('search can discover an intent from conversation text outside its metadata', () => {
	const hit = lookupIntents(items, 'the permit was approved', 0, 20, (id) => id === 'intent-380')
	expect(hit.rows.map((item) => item.id)).toEqual(['intent-380'])
})

test('warm LRU context uses indexed identities without scanning unrelated intents', () => {
	const index = new Map(items.map((item) => [item.id, item]))
	const forbidden = new Proxy(items, {
		get() {
			throw Error('Scanned workspace on a warm context lookup')
		}
	})
	const selected = selectContextIntents(
		forbidden,
		'intent-499',
		[
			'intent-498',
			'intent-497',
			'intent-496',
			'intent-495',
			'intent-494',
			'intent-493',
			'intent-492'
		],
		8,
		index
	)
	expect(selected).toHaveLength(8)
	expect(selected[0].id).toBe('intent-499')
})
