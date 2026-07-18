import { describe, expect, test } from 'bun:test'
import { contactDisplayName, mintContactId } from '../src/contact.js'

// board 0082 — contact short id: 8-char Crockford base32, minted once, collision-checked.

// Deterministic PRNG so the minting is reproducible in tests.
function mulberry32(seed: number): () => number {
	let a = seed
	return () => {
		a |= 0
		a = (a + 0x6d2b79f5) | 0
		let t = Math.imul(a ^ (a >>> 15), 1 | a)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

describe('contact short id', () => {
	test('mintContactId is 8-char base32 (no ambiguous chars)', () => {
		const id = mintContactId(mulberry32(1), [])
		expect(id).toMatch(/^[0-9A-HJ-NP-Z]{8}$/)
	})

	test('mint avoids a colliding existing id', () => {
		const id1 = mintContactId(mulberry32(42), [])
		// Same seed would mint id1 again — but it's now taken, so mint must produce a different id.
		const id2 = mintContactId(mulberry32(42), [id1])
		expect(id2).not.toBe(id1)
		expect(id2).toMatch(/^[0-9A-HJ-NP-Z]{8}$/)
	})

	test('ids are unique across many mints', () => {
		const rand = mulberry32(7)
		const seen = new Set<string>()
		for (let i = 0; i < 500; i++) {
			const id = mintContactId(rand, seen)
			expect(seen.has(id)).toBe(false)
			seen.add(id)
		}
		expect(seen.size).toBe(500)
	})

	test('contactDisplayName joins name + legal form', () => {
		expect(contactDisplayName({ name: 'WaizmannTabelle', legal_form: 'GmbH' })).toBe(
			'WaizmannTabelle GmbH'
		)
		expect(contactDisplayName({ name: 'Müller' })).toBe('Müller')
	})
})
