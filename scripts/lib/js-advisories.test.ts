import { expect, test } from 'bun:test'
import { type AdvisoryException, evaluate, exceptions } from './js-advisories.ts'

const advisory = (id: string, severity = 'low') => ({
	url: `https://github.com/advisories/${id}`,
	title: id,
	severity
})
const allowed: AdvisoryException[] = [{ id: 'GHSA-aaaa', package: 'left', reason: 'test' }]

test('an advisory passes only as a documented exception for that package', () => {
	expect(evaluate({ left: [advisory('GHSA-aaaa')] }, allowed)).toEqual({ findings: [], stale: [] })
	// The same advisory in another package is not covered.
	expect(
		evaluate({ left: [advisory('GHSA-aaaa')], right: [advisory('GHSA-aaaa')] }, allowed).findings
	).toEqual([{ package: 'right', advisory: advisory('GHSA-aaaa') }])
	// Any other advisory fails, whatever its severity.
	expect(
		evaluate({ left: [advisory('GHSA-aaaa'), advisory('GHSA-bbbb')] }, allowed).findings
	).toEqual([{ package: 'left', advisory: advisory('GHSA-bbbb') }])
})

test('an exception that no longer matches a finding is reported as stale', () => {
	expect(evaluate({}, allowed)).toEqual({ findings: [], stale: allowed })
})

test('every exception is unique and gives a reason', () => {
	const keys = exceptions.map((entry) => `${entry.package} ${entry.id}`)
	expect(new Set(keys).size).toBe(keys.length)
	for (const entry of exceptions) {
		expect(entry.id).toMatch(
			/^GHSA-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}$/
		)
		expect(entry.reason.length).toBeGreaterThan(20)
	}
})
