import { composeSkillArtifact } from '@avenos/actors/studio/composer'
import { editStudioSkillV2, newStudioSkillV2 } from '@avenos/actors/studio/edit'
import { composeAuthorizedStudioOperation } from '../skills/studio-compose'
import { authorizedStudioRequest } from '../skills/studio-request'
import { Actor } from './actor'

const string = { type: 'string' }
const uuid = { type: 'string', format: 'uuid' }
const definitionV2 = {
	type: 'object',
	description:
		'Closed Skill v2 definition with named artifact ports, bounded public parameters, exact Actor capability IDs, exact child Skill artifacts and explicit policy.'
}
const portBinding = {
	oneOf: [
		{
			type: 'object',
			additionalProperties: false,
			properties: { kind: { const: 'input' }, port: string },
			required: ['kind', 'port']
		},
		{
			type: 'object',
			additionalProperties: false,
			properties: { kind: { const: 'step' }, stepId: string, port: string },
			required: ['kind', 'stepId', 'port']
		},
		{
			type: 'object',
			additionalProperties: false,
			properties: { kind: { const: 'item' }, loopId: string },
			required: ['kind', 'loopId']
		},
		{
			type: 'object',
			additionalProperties: false,
			properties: { kind: { const: 'none' } },
			required: ['kind']
		}
	]
}
const semanticEdit = {
	oneOf: [
		closedEdit('rename', { name: string }, ['name']),
		closedEdit(
			'set-policy',
			{
				field: {
					type: 'string',
					enum: ['maxInvocations', 'maxDepth', 'maxMembers', 'maxConcurrentChildren', 'allowModel']
				},
				value: { type: ['integer', 'boolean'] }
			},
			['field', 'value']
		),
		closedEdit('set-step-label', { stepId: string, label: string }, ['stepId', 'label']),
		closedEdit('remove-step', { stepId: string }, ['stepId']),
		closedEdit('set-port-binding', { stepId: string, port: string, binding: portBinding }, [
			'stepId',
			'port',
			'binding'
		]),
		closedEdit(
			'set-parameter-binding',
			{
				stepId: string,
				parameter: string,
				binding: {
					oneOf: [
						{
							type: 'object',
							additionalProperties: false,
							properties: { kind: { const: 'literal' }, value: {} },
							required: ['kind', 'value']
						},
						{
							type: 'object',
							additionalProperties: false,
							properties: { kind: { const: 'parameter' }, name: string },
							required: ['kind', 'name']
						}
					]
				}
			},
			['stepId', 'parameter', 'binding']
		),
		closedEdit('set-output', { name: string, output: {} }, ['name', 'output']),
		closedEdit('remove-output', { name: string }, ['name']),
		closedEdit(
			'set-public-parameter',
			{ name: string, schema: {}, required: { type: 'boolean' } },
			['name', 'schema', 'required']
		),
		closedEdit('remove-public-parameter', { name: string }, ['name'])
	]
}
const inputs = {
	type: 'object',
	additionalProperties: uuid,
	description: 'Map each named input port to an exact committed artifact ID.'
}
const revision = { type: 'integer', minimum: 1 }
const methods = [
	{
		operation: 'new-definition',
		description:
			'Create a safe blank Skill v2 definition. Use catalog plus compose-operation to add capabilities, then edit-definition for bounded semantic changes. Pure authoring; nothing is saved or run.',
		properties: { name: string },
		required: ['name']
	},
	{
		operation: 'edit-definition',
		description:
			'Apply one typed semantic change to a Skill v2 definition. The complete result is reparsed and includes an inspectable before/after change. Invalid or dangling edits fail closed; nothing is saved or run.',
		properties: { definition: definitionV2, edit: semanticEdit },
		required: ['definition', 'edit']
	},
	{
		operation: 'catalog',
		description:
			'Explore visible Actor and Skill capabilities under your current session. Page with the returned snapshot cursor; readiness and reasons are explicit. Read-only.',
		properties: {
			search: string,
			cursor: string,
			viewToken: uuid,
			limit: { type: 'integer', minimum: 1, maximum: 100 }
		},
		required: []
	},
	{
		operation: 'compose-operation',
		description:
			'Add one exact visible Actor operation to a Skill v2 definition. The shared composer connects compatible outputs, exposes missing artifacts and settings as named Skill inputs, and keeps protected inputs host-side. Returns visual cues plus the complete changed definition; no save, execution or publication.',
		properties: { definition: definitionV2, capabilityId: string },
		required: ['definition', 'capabilityId']
	},
	{
		operation: 'compose-skill',
		description:
			'Nest one exact immutable Skill v2 artifact in a definition. The shared composer connects matching named ports and exposes missing inputs/settings. No save, execution or publication.',
		properties: { definition: definitionV2, skillArtifactId: uuid },
		required: ['definition', 'skillArtifactId']
	},
	{
		operation: 'present',
		description:
			'Inspect a compact, visual-ready projection of an exact saved Skill artifact. Safe for malformed or unsupported definitions and does not execute.',
		properties: { artifactId: uuid },
		required: ['artifactId']
	},
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
			'Validate a partially specified program against exact child revisions, installed Actor/Store contracts, bindings, cycles and runtime support. Authoring preview only; no Actor calls, solver execution or publications.',
		properties: { definition: definitionV2 },
		required: ['definition']
	},
	{
		operation: 'compare',
		description:
			'Simulate what-if changes to a program, e.g. a different goal, nesting or call budget. Returns baseline and up to four feasibility previews. Does not predict actual document findings or perform effects.',
		properties: {
			baseline: definitionV2,
			variants: { type: 'array', items: definitionV2, maxItems: 4 }
		},
		required: ['baseline', 'variants']
	},
	{
		operation: 'draft',
		description:
			'Create or change a shared persistent draft. Use a new UUID and revision 0 to create; use the exact current revision to edit. Conflicts never overwrite the other client. This saves but does not publish or execute.',
		properties: { id: uuid, revision: { type: 'integer', minimum: 0 }, definition: definitionV2 },
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
		properties: {
			requestId: uuid,
			skillArtifactId: uuid,
			inputs,
			parameters: { type: 'object', additionalProperties: true }
		},
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
			parameters: { type: 'object', additionalProperties: true },
			enabled: { type: 'boolean' }
		},
		required: [
			'id',
			'name',
			'skillArtifactId',
			'sourceArtifactId',
			'inputPort',
			'fixedInputs',
			'parameters',
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
	constructor(
		request: <Value>(
			operation: string,
			data: Record<string, unknown>
		) => Promise<Value> = authorizedStudioRequest
	) {
		super({
			id: 'studio',
			authority: 'ceo.aven',
			namespace: 'skills.studio',
			version: '2',
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
						const result =
							m.operation === 'new-definition'
								? newStudioSkillV2(String(data.name ?? ''))
								: m.operation === 'edit-definition'
									? editStudioSkillV2(data.definition, data.edit)
									: m.operation === 'compose-operation'
										? await composeAuthorizedStudioOperation(
												data.definition,
												String(data.capabilityId ?? ''),
												request
											)
										: m.operation === 'compose-skill'
											? await composeExactSkill(
													data.definition,
													String(data.skillArtifactId ?? ''),
													request
												)
											: await request(m.operation, data)
						return { record: JSON.stringify(result), wire: JSON.stringify(result) }
					}
				])
			)
		)
	}
}

async function composeExactSkill(
	definition: unknown,
	artifactId: string,
	request: <Value>(operation: string, data: Record<string, unknown>) => Promise<Value>
) {
	const inspected = await request<{ artifact?: Record<string, unknown> }>('inspect', { artifactId })
	const artifact = inspected.artifact
	if (
		!artifact ||
		artifact.artifactId !== artifactId ||
		artifact.typeKey !== 'studio.skill' ||
		artifact.typeVersion !== 2
	)
		throw new Error('STUDIO_CHILD_UNAVAILABLE')
	return composeSkillArtifact(definition, artifactId, artifact.payload)
}

function closedEdit(
	kind: string,
	properties: Record<string, unknown>,
	required: string[]
): Record<string, unknown> {
	return {
		type: 'object',
		additionalProperties: false,
		properties: { kind: { const: kind }, ...properties },
		required: ['kind', ...required]
	}
}
