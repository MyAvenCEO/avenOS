import { expect, test } from 'bun:test'
import {
	parseStudioCase,
	reviseStudioCase,
	type StudioCase,
	simulateStudioCase
} from '../src/studio/case'
import { newStudioSkillV2 } from '../src/studio/edit'
import { parseStudioSkillV2 } from '../src/studio/v2'

const example = (): StudioCase => ({
	title: 'Weekly brief',
	situation: 'An email arrives',
	outcome: 'A reviewed brief',
	evidence: [
		{
			id: 'mail',
			kind: 'recollection',
			sourceId: 'user',
			locator: '',
			quote: 'I used to read the email and write a brief.',
			interpretation: 'Manual procedure, not an Actor receipt.'
		}
	],
	steps: [
		{
			id: 'read',
			label: 'Read email',
			evidenceIds: ['mail'],
			kind: 'action',
			capabilityId: 'ceo.aven:capability:studio.email-brief:create@1'
		},
		{
			id: 'gap',
			label: 'Assess urgency',
			evidenceIds: [],
			kind: 'ideal',
			needs: 'Email text',
			produces: 'Urgency',
			acceptance: 'Flag the urgent regression example'
		},
		{
			id: 'use',
			label: 'Use assessment',
			evidenceIds: [],
			kind: 'action',
			capabilityId: 'ceo.aven:capability:studio.email-brief:create@1'
		}
	],
	uncertainties: ['The old urgency rule is unknown.']
})
test('small case revisions preserve evidence, other steps and the immutable original', () => {
	const original = example(),
		before = JSON.stringify(original)
	const revised = reviseStudioCase(original, {
		stepUpdates: [{ id: 'gap', acceptance: 'Keep uncertain cases visible for review.' }]
	})
	expect(revised.evidence).toEqual(original.evidence)
	expect(revised.steps[0]).toEqual(original.steps[0])
	expect(revised.steps[1]).toEqual({
		...original.steps[1],
		acceptance: 'Keep uncertain cases visible for review.'
	})
	expect(revised.steps[2]).toEqual(original.steps[2])
	expect(JSON.stringify(original)).toBe(before)
	for (const changes of [
		{},
		{ status: 'confirmed' },
		{ stepUpdates: [] },
		{ stepUpdates: [{ id: 'missing', label: 'No' }] },
		{ stepUpdates: [{ id: 'gap' }] },
		{ stepUpdates: [{ id: 'read', needs: 'Cannot turn an action into an ideal node' }] },
		{ stepUpdates: [{ id: 'gap', acceptance: '' }] }
	])
		expect(() => reviseStudioCase(original, changes)).toThrow()
})
test('case what-if is non-executing and dependent steps remain hypothetical', () => {
	const c = example(),
		before = JSON.stringify(c)
	const result = simulateStudioCase(c)
	expect(result).toMatchObject({
		mode: 'structural-what-if',
		executes: false,
		result: 'hypothetical',
		gaps: 1
	})
	expect(result.steps.map((s) => s.status)).toEqual([
		'not-executed',
		'needs-implementation',
		'depends-on-ideal'
	])
	expect(JSON.stringify(c)).toBe(before)
})
test('case rejects absent evidence, dangling references, duplicate steps and mixed node fields', () => {
	const c = example()
	expect(() => parseStudioCase({ ...c, evidence: [] })).toThrow()
	expect(() =>
		parseStudioCase({ ...c, steps: [{ ...c.steps[0], evidenceIds: ['invented'] }] })
	).toThrow()
	expect(() => parseStudioCase({ ...c, steps: [c.steps[0], c.steps[0]] })).toThrow()
	expect(() =>
		parseStudioCase({ ...c, steps: [{ ...c.steps[1], capabilityId: 'fake' }] })
	).toThrow()
})
test('ideal nodes cannot enter the executable grammar; exact case provenance survives parsing', () => {
	const skill = newStudioSkillV2('Brief'),
		caseArtifactId = crypto.randomUUID()
	expect(parseStudioSkillV2({ ...skill, caseArtifactId }).caseArtifactId).toBe(caseArtifactId)
	expect(() => parseStudioSkillV2({ ...skill, steps: example().steps })).toThrow()
	expect(() => parseStudioSkillV2({ ...skill, caseArtifactId: 'made-up' })).toThrow()
})
