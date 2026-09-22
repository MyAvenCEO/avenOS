import { expect, it } from 'vitest'
import { assertReferenceMembers, outputReferences } from '../src/studio-output-references'

it('supports local sibling references only to actual outputs in the same publication', () => {
	const refs = outputReferences({
		'manifest-0': [
			{ role: 'file', local: 'files-0' },
			{ role: 'message', id: 'recorded-id' }
		]
	})
	expect(() => assertReferenceMembers(refs, new Set(['manifest-0', 'files-0']))).not.toThrow()
	expect(() => assertReferenceMembers(refs, new Set(['manifest-0']))).toThrow('UNKNOWN_MEMBER')
	for (const entry of [
		{ role: 'file', id: 'x', local: 'y' },
		{ role: 'file' },
		{ role: 'file', local: '' },
		{ role: 'file', local: 3 },
		{ role: 'file', local: 'x', url: 'https://example.test' }
	])
		expect(() => outputReferences({ 'manifest-0': [entry] })).toThrow('INVALID')
})
