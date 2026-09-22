import { expect, test } from 'bun:test'
import { KNOWLEDGE_PARAMETERS } from '../src/knowledge'
import { parseStudioPublicParametersSchema, parseStudioSkillParameters } from '../src/studio/v2'

test('knowledge query has the same bounded authorable schema in chat and Skills', () => {
	expect(parseStudioPublicParametersSchema(KNOWLEDGE_PARAMETERS)).toEqual(KNOWLEDGE_PARAMETERS)
	const parameters = {
		collection: 'invoices',
		view: 'summary',
		measure: 'grossMinor',
		where: [{ field: 'supplier', op: 'not-in', values: ['Alder Labs'] }],
		snapshot_sequence: 12,
		store_epoch: '00000000-0000-4000-8000-000000000001'
	}
	expect(
		parseStudioSkillParameters({ parametersSchema: KNOWLEDGE_PARAMETERS }, parameters)
	).toEqual(parameters)
	expect(() =>
		parseStudioSkillParameters(
			{ parametersSchema: KNOWLEDGE_PARAMETERS },
			{ ...parameters, snapshot_sequence: Infinity }
		)
	).toThrow()
})
