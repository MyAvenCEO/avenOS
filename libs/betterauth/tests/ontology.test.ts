import { compilePredicate, type PredicateDef } from '@avenos/aven-vibes/predicate'
import { CREATE_INSTRUCTIONS, findExistingPredicate } from '@avenos/skills/tools'
import Ajv from 'ajv'
import { describe, expect, test } from 'bun:test'

// board 0100 — the DETERMINISTIC proof: a novel x1–x5 predicate is self-validating (AJV) with its gismu's
// FULL place structure, and the dedup gate reuses an existing predicate instead of minting a duplicate.
// This is the measurable goal; the GLM minting QUALITY is a separate human-checked acceptance criterion.

// a novel gismu-inspired relation minted with ZERO code: ponse (x1 owns x2), with an optional x3 the
// immediate request need not fill — but the schema still carries it (full place structure).
const PONSE: PredicateDef = {
	predicate: 'ponse',
	gismu: 'ponse',
	gloss: 'x1 owns/possesses x2 under right x3',
	places: [
		{ pos: 'x1', role: 'owner', gloss: 'the possessor', kind: 'ref', references: '*' },
		{ pos: 'x2', role: 'possession', gloss: 'the thing owned', kind: 'ref', references: '*' },
		{ pos: 'x3', role: 'right', gloss: 'the legal basis', kind: 'value', type: 'string', required: false }
	]
}

describe('ontology — self-validating x1–x5 predicates (board 0100)', () => {
	test('a minted predicate carries the gismu FULL place structure + is AJV self-validating', () => {
		const schema = compilePredicate(PONSE) as {
			properties: Record<string, unknown>
			required: string[]
		}
		// FULL place structure: EVERY declared place is present in the compiled schema (not request-trimmed)
		for (const p of PONSE.places) expect(schema.properties[p.pos]).toBeDefined()
		expect(Object.keys(schema.properties)).toContain('predicate')

		const validate = new Ajv({ allErrors: true, strict: false }).compile(schema)
		// a full predication validates through AJV…
		expect(validate({ predicate: 'ponse', x1: 'person-1', x2: 'compan-1', x3: 'freehold' })).toBe(true)
		// …the optional place may be omitted…
		expect(validate({ predicate: 'ponse', x1: 'person-1', x2: 'compan-1' })).toBe(true)
		// …but a wrong predicate or a missing REQUIRED place is rejected (self-validating).
		expect(validate({ predicate: 'WRONG', x1: 'person-1', x2: 'compan-1' })).toBe(false)
		expect(validate({ predicate: 'ponse', x1: 'person-1' })).toBe(false) // x2 required
	})

	test('dedup — an existing predicate is REUSED; a genuinely new one mints', () => {
		const existing = [{ name: 'owned_by', gloss: 'ownership' }, { name: 'task' }]
		expect(findExistingPredicate({ name: 'owned_by' }, existing)?.name).toBe('owned_by')
		expect(findExistingPredicate({ name: 'ownership', keywords: ['owned_by'] }, existing)?.name).toBe(
			'owned_by'
		)
		expect(findExistingPredicate({ name: 'ponse', keywords: ['possess'] }, existing)).toBeNull()
	})

	test('the create prompt forces the FULL place structure even for a partial request', () => {
		expect(CREATE_INSTRUCTIONS).toContain('FULL PLACE STRUCTURE')
		expect(CREATE_INSTRUCTIONS).toContain('EVEN IF')
		expect(CREATE_INSTRUCTIONS).toContain('REUSE')
	})
})
