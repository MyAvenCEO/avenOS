import { studioRequest } from '../skills/studio.svelte'
import { Actor } from './actor'

const string = { type: 'string' }
const uuid = { type: 'string', format: 'uuid' }
const definition = {
	type: 'object',
	description:
		'Studio v1 definition. Start with the definition returned by studio_explore, or inspect an existing Skill. Change its typed inputs, fixed capability / exact child Skill / open goal steps, output binding and policy. No arbitrary executable code.'
}
const inputs = {
	type: 'object',
	additionalProperties: uuid,
	description: 'Map each named input port to an exact committed artifact ID.'
}
const revision = { type: 'integer', minimum: 1 }
const methods = [
	{
		operation: 'state',
		description:
			'Inspect saved drafts, exact published Skills, Sources, subscriptions, pending arrivals and recent runs. Read-only.',
		properties: {},
		required: []
	},
	{
		operation: 'explore',
		description:
			'Explore what an exact artifact can become using the installed solver catalog. Returns editable program definitions, conditional findings and honest coverage limits. Does not run anything.',
		properties: { artifactId: uuid },
		required: ['artifactId']
	},
	{
		operation: 'inspect',
		description:
			'Inspect any artifact payload and its causal inputs, including Skills, child calls, source captures and outputs. Follow input IDs to preserve the complete provenance chain.',
		properties: { artifactId: uuid },
		required: ['artifactId']
	},
	{
		operation: 'preview',
		description:
			'Validate and resolve a partially specified program with the solver. Checks exact child revisions, bindings, cycles, budgets and model policy. Planning only; no Actor calls or publications.',
		properties: { definition },
		required: ['definition']
	},
	{
		operation: 'compare',
		description:
			'Simulate what-if changes to a program, e.g. a different goal, nesting or call budget. Returns baseline and up to four feasibility previews. Does not predict actual document findings or perform effects.',
		properties: {
			baseline: definition,
			variants: { type: 'array', items: definition, maxItems: 4 }
		},
		required: ['baseline', 'variants']
	},
	{
		operation: 'draft',
		description:
			'Create or change a shared persistent draft. Use a new UUID and revision 0 to create; use the exact current revision to edit. Conflicts never overwrite the other client. This saves but does not publish or execute.',
		properties: { id: uuid, revision: { type: 'integer', minimum: 0 }, definition },
		required: ['id', 'revision', 'definition']
	},
	{
		operation: 'publish',
		description:
			'Publish the exact draft revision as an immutable studio.skill artifact. Preserve the returned artifact ID for child calls, runs and subscriptions. No execution.',
		properties: { id: uuid, revision },
		required: ['id', 'revision']
	},
	{
		operation: 'start',
		description:
			'Execute a published Skill with committed inputs under the current customer session. This writes real result artifacts and may call a model if the Skill permits. Only do this with user authorization. Reuse requestId on uncertain responses; a new requestId is a distinct activation.',
		properties: { requestId: uuid, skillArtifactId: uuid, inputs },
		required: ['requestId', 'skillArtifactId', 'inputs']
	},
	{
		operation: 'sample',
		description:
			'Capture a synthetic email and text attachment into the real artifact store and dispatch matching subscriptions. Does not contact IMAP. Requires authorization to create artifacts. Retain both requestId and observedAt when retrying.',
		properties: { requestId: uuid, observedAt: { type: 'string', format: 'date-time' } },
		required: ['requestId', 'observedAt']
	},
	{
		operation: 'connect',
		description:
			'Save and optionally enable a durable subscription to future committed artifacts. Exact Skill revision, trigger input, fixed companion inputs, optional synthetic Source filter. Enabling permits automatic execution while this authenticated client syncs. Ask the user before enabling automation. Live IMAP/HTTP and unattended service credentials are not implemented.',
		properties: {
			id: uuid,
			name: string,
			skillArtifactId: uuid,
			sourceArtifactId: {
				type: ['string', 'null'],
				description:
					'Exact Source artifact, or null for any committed artifact of the trigger type.'
			},
			inputPort: string,
			fixedInputs: inputs,
			enabled: { type: 'boolean' }
		},
		required: [
			'id',
			'name',
			'skillArtifactId',
			'sourceArtifactId',
			'inputPort',
			'fixedInputs',
			'enabled'
		]
	},
	{
		operation: 'control',
		description:
			'Pause or resume an existing subscription using its current revision. Resume retains the cursor and processes backlog; pausing does not cancel already accepted runs.',
		properties: { id: uuid, revision, enabled: { type: 'boolean' } },
		required: ['id', 'revision', 'enabled']
	},
	{
		operation: 'run-control',
		description:
			'Cancel an accepted Studio run or retry a failed run under the same activation. Only your own runs are controllable. Reuse requestId after an uncertain response.',
		properties: {
			runId: uuid,
			requestId: uuid,
			action: { type: 'string', enum: ['retry', 'cancel'] }
		},
		required: ['runId', 'requestId', 'action']
	},
	{
		operation: 'sync',
		description:
			'Advance enabled subscriptions using durable publication-feed checkpoints and admit pending work under the current authenticated session. May execute enabled Skills. Safe to repeat; no unattended credentials are persisted.',
		properties: {},
		required: []
	}
]

/** Agent parity is a transport adapter, not a second authoring or execution engine. */
export class StudioActor extends Actor {
	constructor() {
		super({
			id: 'studio',
			authority: 'ceo.aven',
			namespace: 'skills.studio',
			version: '1',
			name: 'Skill Studio',
			description:
				'Explore artifact opportunities, compose and nest typed Skills with the solver, compare what-if plans, inspect provenance and manage explicit automatic connections. Human and agent share revision-checked drafts.',
			tags: ['skills', 'planning', 'artifacts'],
			methods: methods.map((m) => ({
				name: 'studio_' + m.operation.replaceAll('-', '_'),
				description: m.description,
				parameters: {
					type: 'object',
					additionalProperties: false,
					properties: m.properties,
					required: m.required
				}
			}))
		})
		this.bind(
			Object.fromEntries(
				methods.map((m) => [
					'studio_' + m.operation.replaceAll('-', '_'),
					async (data: Record<string, unknown>) => {
						const result = await studioRequest(m.operation, data)
						return { record: JSON.stringify(result), wire: JSON.stringify(result) }
					}
				])
			)
		)
	}
}
