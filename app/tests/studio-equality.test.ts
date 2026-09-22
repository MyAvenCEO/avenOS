import { expect, test } from 'bun:test'
import { sameStudioJson } from '../src/lib/skills/studio-equality'

test('database object-key order does not turn a saved case or published skill into an edit', () => {
	const original = {
		title: 'Invoice review',
		steps: [{ id: 'read', inputs: { source: 'invoice' } }],
		evidence: ['first', 'second']
	}
	const persisted = {
		evidence: ['first', 'second'],
		steps: [{ inputs: { source: 'invoice' }, id: 'read' }],
		title: 'Invoice review'
	}
	expect(sameStudioJson(original, persisted)).toBe(true)
	expect(sameStudioJson(original, { ...persisted, title: 'Different' })).toBe(false)
	expect(sameStudioJson(original, { ...persisted, evidence: ['second', 'first'] })).toBe(false)
	expect(sameStudioJson(original, { ...persisted, steps: [] })).toBe(false)
	expect(sameStudioJson(original, null)).toBe(false)
	expect(sameStudioJson({}, [])).toBe(false)
	expect(sameStudioJson({ optional: null }, {})).toBe(false)
})
