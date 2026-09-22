import { describe, expect, test } from 'bun:test'
import {
	type ArtifactEvidence,
	evidenceForPointer,
	formatMoney,
	splitUtf8Range
} from '../src/lib/artifacts/artifact-view'

const evidence: ArtifactEvidence[] = [
	{
		ordinal: 0,
		outputArtifactId: 'output',
		outputLocator: { kind: 'json-pointer', pointer: '/lineItems/0' },
		inputRole: 'source',
		inputOrdinal: 0,
		inputArtifactId: 'input',
		inputLocator: { kind: 'page-region', page: 1, x: 1, y: 2, width: 3, height: 4 }
	},
	{
		ordinal: 1,
		outputArtifactId: 'output',
		outputLocator: { kind: 'json-pointer', pointer: '/lineItems/0/description' },
		inputRole: 'source',
		inputOrdinal: 0,
		inputArtifactId: 'input',
		inputLocator: { kind: 'page-region', page: 2, x: 1, y: 2, width: 3, height: 4 }
	}
]

describe('artifact viewer helpers', () => {
	test('formats stored minor currency units', () => {
		expect(formatMoney(12345, 'EUR')).toMatch(/123,45/)
		// Invented amount above the safe-integer boundary; never a customer amount.
		expect(formatMoney('13092687039092598', 'EUR')).toContain('130.926.870.390.925,98')
		expect(formatMoney('-1', 'EUR')).toContain('-0,01')
		expect(formatMoney('12345', 'JPY')).toContain('12.345')
		expect(formatMoney('12345', 'JPY')).not.toContain(',')
		expect(formatMoney('12345', 'KWD')).toContain('12,345')
		expect(formatMoney('12345', null)).toBe('12345 minor units · currency unknown')
		expect(formatMoney('12345', 'ZZZ')).toBe('12345 minor units · currency ZZZ not recognized')
		expect(formatMoney(null, 'EUR')).toBe('—')
		expect(formatMoney(Number.MAX_SAFE_INTEGER + 1, 'EUR')).toBe('—')
	})

	test('chooses the most specific evidence pointer and supports row evidence', () => {
		expect(evidenceForPointer(evidence, '/lineItems/0/description')?.ordinal).toBe(1)
		expect(evidenceForPointer(evidence, '/lineItems/0/quantity')?.ordinal).toBe(0)
	})

	test('uses UTF-8 byte offsets rather than JavaScript character offsets', () => {
		const bytes = new TextEncoder().encode('A € B')
		expect(splitUtf8Range(bytes, 2, 5)).toEqual({ before: 'A ', marked: '€', after: ' B' })
		expect(splitUtf8Range(bytes, 3, 5)).toBeNull()
	})
})
