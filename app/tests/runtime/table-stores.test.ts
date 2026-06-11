import { describe, expect, test } from 'bun:test'
import { getTableRowsStore, resetAllTableRowStores } from '../../src/lib/runtime/table-stores'

describe('table row stores', () => {
	test('resetAllTableRowStores clears data', () => {
		getTableRowsStore('sparks').set([{ id: 'x' }])
		resetAllTableRowStores()
		let last: unknown[] | undefined
		const u = getTableRowsStore('sparks').subscribe((r) => {
			last = r as unknown[]
		})
		u()
		expect(last).toEqual([])
	})
})
