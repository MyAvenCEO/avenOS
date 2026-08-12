import type { Manifest } from './actor'

/**
 * What every record-keeping actor gets on top of its declared manifest —
 * pure, so both the running actor and the tests derive it the same way.
 *
 * Three generic voice verbs ride along: `<id>_add` (the obvious verb — "put
 * the appointment in" needs a tool that SAYS it adds entries), `<id>_records`
 * and `<id>_forget`. And a fallback face, so an actor without a declared one
 * still shows what it remembered instead of a blank window.
 */
export function withRecordMethods(manifest: Manifest): Manifest {
	const methods = [...manifest.methods]
	const goal = manifest.produces?.[0]
	if (goal && !methods.some((m) => m.name === `${manifest.id}_add`)) {
		methods.push({
			name: `${manifest.id}_add`,
			description:
				`Adds one entry to ${manifest.name} (${manifest.id}): executes its goal ` +
				`${goal} with the given text as input and keeps the result as a record. ` +
				'Use this whenever the user wants to put something into this actor.',
			parameters: {
				type: 'object',
				properties: {
					text: { type: 'string', description: 'What to add, verbatim as the user said it.' }
				},
				required: ['text']
			},
			produces: [goal]
		})
	}
	if (!methods.some((m) => m.name === `${manifest.id}_records`)) {
		methods.push({
			name: `${manifest.id}_records`,
			description: `Lists the records ${manifest.name} currently keeps.`,
			parameters: { type: 'object', properties: {} }
		})
	}
	if (!methods.some((m) => m.name === `${manifest.id}_forget`)) {
		methods.push({
			name: `${manifest.id}_forget`,
			description:
				`Removes one record from ${manifest.name} by its record id ` +
				`(as ${manifest.id}_records returned it), or all of them with all=true.`,
			parameters: {
				type: 'object',
				properties: {
					record: { type: 'string', description: 'The record id to remove.' },
					all: { type: 'boolean', description: 'true = forget everything.' }
				}
			}
		})
	}
	const face = manifest.face ?? {
		elements: [
			{
				kind: 'note' as const,
				text: `${manifest.description} Speak to it — say what you want added.`
			},
			{ kind: 'records' as const }
		]
	}
	return { ...manifest, methods, face }
}
