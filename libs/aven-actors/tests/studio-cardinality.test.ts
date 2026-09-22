import { expect, test } from 'bun:test'
import { cardinalityFits } from '../src/studio/cardinality'

test('port assignability preserves every possible source count, including empty results', () => {
	const counts = { one: [1], optional: [0, 1], many: [0, 1, 2, 128] }
	for (const source of ['one', 'optional', 'many'] as const)
		for (const target of ['one', 'optional', 'many'] as const)
			expect(cardinalityFits(source, target)).toBe(
				counts[source].every((count) => counts[target].includes(count))
			)
})
