import { Actor, type ActorCallContext, ActorCommandRejected } from '../actor'
import { authorStudioDraft } from './author'
import {
	assertStudioCaseEvidenceIdentity,
	parseStudioCase,
	reviseStudioCase,
	studioCaseChangesJsonSchema,
	studioCaseJsonSchema
} from './case'
import { isStudioReadOperation } from './operations'

export type StudioAgentRequest = <Value>(
	operation: string,
	data: Record<string, unknown>,
	context?: ActorCallContext
) => Promise<Value>

const string = { type: 'string' }
const identifier = { type: 'string', pattern: '^[a-z][a-z0-9_-]{0,63}$' }
const uuid = { type: 'string', format: 'uuid' }
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
	description:
		'Every edit requires its own kind discriminator, separate from action.kind and binding.kind. For a fixed setting: {"kind":"set-parameter-binding","stepId":"step_id","parameter":"setting_name","binding":{"kind":"literal","value":"value"}}. Do not omit the edit kind.',
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
		closedEdit('move-step', { stepId: string, beforeStepId: { type: ['string', 'null'] } }, [
			'stepId',
			'beforeStepId'
		]),
		closedEdit(
			'set-after',
			{ stepId: string, after: { type: 'array', items: string, maxItems: 64 } },
			['stepId', 'after']
		),
		closedEdit('expose-output', { name: identifier, stepId: identifier, port: identifier }, [
			'name',
			'stepId',
			'port'
		]),
		closedEdit('remove-input', { name: identifier }, ['name']),
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
						},
						{
							type: 'object',
							additionalProperties: false,
							properties: {
								kind: { const: 'input-field' },
								port: identifier,
								path: { type: 'string', minLength: 2, maxLength: 257 }
							},
							required: ['kind', 'port', 'path']
						}
					]
				}
			},
			['stepId', 'parameter', 'binding']
		),
		closedEdit(
			'set-output',
			{
				name: string,
				output: {
					type: 'object',
					additionalProperties: false,
					properties: {
						schema: string,
						type: {
							type: 'object',
							additionalProperties: false,
							properties: { key: string, version: { type: 'integer', minimum: 1 } },
							required: ['key', 'version']
						},
						predicate: string,
						role: string,
						cardinality: { enum: ['one', 'optional', 'many'] },
						from: portBinding
					},
					required: ['schema', 'type', 'predicate', 'role', 'cardinality', 'from'],
					description:
						'Copy the exact port descriptor from the selected step output and add from. A binding alone is not an output descriptor.'
				}
			},
			['name', 'output']
		),
		closedEdit('remove-output', { name: string }, ['name']),
		{
			...closedEdit(
				'set-public-parameter',
				{ name: string, schema: {}, required: { type: 'boolean' } },
				['name', 'schema', 'required']
			),
			description:
				'Add a NEW public setting or deliberately change its schema. Composing and copying already declare and wire public settings; keep those schemas unchanged unless a different shape is requested. To fix a value, use set-parameter-binding instead. Array schemas have type, items, minItems, maxItems only; additionalProperties belongs only to object schemas.'
		},
		{
			...closedEdit('remove-public-parameter', { name: string }, ['name']),
			description:
				'Remove the public setting and all parameter/configuration bindings to it. Literal bindings are preserved. Preview afterward: a required Actor or child parameter still needs a replacement.'
		}
	]
}
const inputs = {
	type: 'object',
	maxProperties: 16,
	additionalProperties: {
		oneOf: [uuid, { type: 'array', items: uuid, maxItems: 256 }, { type: 'null' }]
	},
	description:
		'Map named ports to exact committed artifact IDs: one ID for a single input, an ordered array for a collection, or null for an empty optional input. Missing optional/collection ports are empty.'
}
const revision = { type: 'integer', minimum: 1 }
const methods = [
	{
		operation: 'items',
		description:
			'Find committed artifacts of any registered type, including intermediate document text and financial records not shown in the recent sidebar. Read-only bounded pages. For later pages of ONE search retain snapshotSequence and pass nextAfter as after. A snapshot is frozen: OMIT snapshotSequence for a fresh search. For execution results use studio_run_status, never guess result type names or poll an old snapshot. Inspect exact IDs before binding them; type matches alone do not prove source lineage or semantic relevance.',
		properties: {
			typeKey: { type: 'string', pattern: '^[a-zA-Z0-9._-]{1,128}$' },
			snapshotSequence: { type: 'integer', minimum: 0 },
			after: uuid,
			limit: { type: 'integer', minimum: 1, maximum: 128 }
		},
		required: ['typeKey']
	},
	{
		operation: 'case-propose',
		description:
			'Create a NEW immutable real-case proposal after reading evidence and inspecting capabilities. Use studio_case_revise to refine ANY saved case, including structural rewrites, rather than creating an unlinked replacement. Supply a complete case JSON object. Use exact catalog IDs for actions; mark missing capabilities as ideal. Attribute user recollection, never invent historical records. Shows the proposal for human confirmation; cannot confirm it.',
		properties: { case: studioCaseJsonSchema },
		required: ['case']
	},
	{
		operation: 'case-revise',
		description:
			'Refine a saved real-case plan while preserving its provenance. predecessorArtifactId is the exact case artifact being revised, never a draft or Skill ID. For a small refinement supply changes (for example stepUpdates with exact step id and acceptance); untouched evidence and steps remain. For structural changes supply a full case object instead. Step IDs are stable identities, not positions: adding or moving steps does not rename or renumber retained steps. Preserve the kind, sourceId and exact quote of every retained evidence ID; new statements need new evidence IDs. Every revision is a new immutable proposal requiring fresh human confirmation. No execution.',
		properties: {
			predecessorArtifactId: uuid,
			changes: studioCaseChangesJsonSchema,
			case: studioCaseJsonSchema
		},
		required: ['predecessorArtifactId']
	},
	{
		operation: 'case-what-if',
		description:
			'Inspect a saved, editable case plan without executing anything. This is the what-if prototype for a Skill with ideal nodes: it can be saved and revised before its missing Actors exist. Shows missing implementations and hypothetical downstream steps. No model calls, output artifacts or side effects. Clearly distinguish this plan from an executable Skill.',
		properties: { artifactId: uuid },
		required: ['artifactId']
	},
	{
		operation: 'case-build',
		description:
			'Build and save an editable Skill from a user-confirmed case with no ideal steps. Resolves exact authorized actions or nested Skills and retains the immutable case reference. Does not publish or execute. Missing capabilities require revising the case, not silently dropping steps.',
		properties: { artifactId: uuid },
		required: ['artifactId']
	},
	{
		operation: 'author',
		description:
			'Build or refine a shared saved draft using small typed commands, NEVER by copying definition JSON. Renaming or refining the SAME Skill edits its existing draft, even after publication: use its id and current revision with action kind edit. Publishing again produces an immutable successor. create with copyArtifactId is only for a separate variant, not a routine revision. For create use a new UUID id and revision 0; optionally copy an exact published Skill or retain a CONFIRMED caseArtifactId (confirmation creates a new ID). A behavioral variant must embed its differing settings or steps: changing only a name or label does not specialize execution. Bind the requested focus as a literal setting and remove an unused public parameter rather than asking the user to repeat the specialization each run. link-case updates that association without discarding the draft. Every successful change returns the next revision. operations auto-wires a batch of known catalog capabilities; child nests a published Skill. A collectionAlternative cue requires a loop: publish a small parameter-free child for the one-item action, then repeat-step replaces the provisional action, preserves its downstream wires and removes its orphaned item input. for-each appends a new loop instead. edit applies atomic semantic edits. expose-output derives the exact contract from stepId/port. preview checks feasibility without running. Read studio_state after a conflict or uncertain response. Publishing and execution are separate tools and require appropriate user authorization.',
		properties: {
			id: {
				...uuid,
				description:
					'Draft UUID at the top level beside action, never inside action. For create, generate a new UUID.'
			},
			revision: {
				type: 'integer',
				minimum: 0,
				description:
					'Draft revision at the top level beside action, never inside action. Use 0 for create, otherwise the latest returned revision.'
			},
			action: {
				description:
					'Only kind and the fields allowed for that action go here. Example envelope: {"id":"new-draft-uuid","revision":0,"action":{"kind":"create","name":"Document register"}}. Replace new-draft-uuid with an actual UUID.',
				oneOf: [
					{
						type: 'object',
						additionalProperties: false,
						properties: {
							kind: { const: 'create' },
							name: string,
							copyArtifactId: {
								...uuid,
								description:
									'For a variant or refinement, copy the exact published source Skill here. This records immutable origin provenance; rebuilding its steps from scratch loses that relationship.'
							},
							caseArtifactId: uuid
						},
						required: ['kind', 'name']
					},
					closedEdit('operation', { capabilityId: string }, ['capabilityId']),
					closedEdit('link-case', { caseArtifactId: uuid }, ['caseArtifactId']),
					closedEdit(
						'repeat-step',
						{ stepId: string, skillArtifactId: uuid, collection: portBinding, itemPort: string },
						['stepId', 'skillArtifactId', 'collection', 'itemPort']
					),
					closedEdit(
						'operations',
						{ capabilityIds: { type: 'array', items: string, minItems: 1, maxItems: 16 } },
						['capabilityIds']
					),
					closedEdit('child', { skillArtifactId: uuid }, ['skillArtifactId']),
					closedEdit(
						'for-each',
						{ skillArtifactId: uuid, collection: portBinding, itemPort: string },
						['skillArtifactId', 'collection', 'itemPort']
					),
					closedEdit(
						'edit',
						{ edits: { type: 'array', minItems: 1, maxItems: 16, items: semanticEdit } },
						['edits']
					),
					closedEdit('preview', {}, [])
				]
			}
		},
		required: ['id', 'revision', 'action']
	},
	{
		operation: 'catalog',
		description:
			'Explore visible Actor and Skill capabilities under your current session. Search for the needed function, page with the returned snapshot cursor and viewToken. A snapshot belongs to that exact search: OMIT cursor and viewToken when changing search or starting over. Readiness and reasons are explicit. Reuse capabilities already read during this task instead of repeatedly listing the catalog. Read-only.',
		properties: {
			search: string,
			cursor: string,
			viewToken: uuid,
			limit: { type: 'integer', minimum: 1, maximum: 100 }
		},
		required: []
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
			'Inspect any artifact payload and its causal inputs, including Skills, child calls, source captures and outputs. Copy an exact artifact UUID returned by an earlier tool or supplied by the user; never invent, shorten, pad or complete an ID. If no ID is known, discover it with studio_items or workspace_search first. Follow input IDs to preserve the complete provenance chain. Several page, OCR, native-text or assembled artifacts can derive from ONE original document; they do not prove repeated historical work. Keep current processing evidence separate from attributed user recollection.',
		properties: { artifactId: uuid },
		required: ['artifactId']
	},
	{
		operation: 'publish',
		description:
			'Publish the exact draft revision as an immutable studio.skill artifact. The draft remains editable: refining or renaming this same Skill uses its existing draft id, then publishes a successor. Preserve the returned artifact ID for child calls, runs and subscriptions, not as a draft id. No execution. Confirm the Skill name, requested change and whether it ran; leave internal revisions and wiring in the inspectable receipt unless asked. A user-requested structural check followed by publication is complete without a trial when execution was excluded. State that it was not run, without adding an unsolicited testing tutorial or next-step offer; retain any genuine unresolved requirement.',
		properties: { id: uuid, revision },
		required: ['id', 'revision']
	},
	{
		operation: 'start',
		description:
			'Execute a published Skill with committed inputs under the current customer session. This writes real result artifacts and may call a model if the Skill permits. Only do this with user authorization. Reuse requestId on uncertain responses; a new requestId is a distinct activation. Accepted is not completed: use studio_run_status with the returned runId and waitMs 30000 to obtain exact result IDs. Do not poll artifact lists.',
		properties: {
			requestId: uuid,
			skillArtifactId: uuid,
			inputs,
			parameters: { type: 'object', additionalProperties: true }
		},
		required: ['requestId', 'skillArtifactId', 'inputs']
	},
	{
		operation: 'run-status',
		description:
			'Read one exact Studio run and its named output artifact IDs. Read-only; waitMs up to 30000 waits while accepted/planning/running without asking the model to poll. Use after studio_start. runRevision versions the execution record, NOT the published Skill. On a still-running response, report progress; do not repeatedly search catalogs or artifact snapshots. This never retries or starts work.',
		properties: { runId: uuid, waitMs: { type: 'integer', minimum: 0, maximum: 30000 } },
		required: ['runId']
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
					'Exact Source artifact UUID, or JSON null for any committed artifact of the trigger type. Use the literal null, never strings such as "None", "null" or an empty string.'
			},
			inputPort: string,
			origin: {
				oneOf: [
					{ type: 'null' },
					{
						type: 'object',
						additionalProperties: false,
						properties: {
							procedureKey: string,
							procedureVersion: {
								...string,
								description:
									'Use * for the same processing stage across device, server and Skill execution; use an exact version only when the user explicitly wants one implementation.'
							}
						},
						required: ['procedureKey', 'procedureVersion']
					}
				],
				description:
					'Copy the exact procedureKey from studio_inspect.production.run to watch a processing stage, such as completed document assembly rather than intermediate page extraction. Use procedureVersion: * for ordinary arrivals: device, server and manually executed Skills have different implementation-version labels for the SAME stage. Pin an exact version only if that implementation restriction is explicitly requested. The trigger artifact type/version still matches exactly. Null origin matches any producer; never guess procedure keys.'
			},
			collection: {
				type: 'object',
				additionalProperties: false,
				properties: {
					mode: { type: 'string', enum: ['each', 'accumulate'] },
					initial: { type: 'array', items: uuid, maxItems: 256 }
				},
				required: ['mode', 'initial'],
				description:
					'each runs on one arrival. accumulate requires a many input: every run receives the selected initial items plus all matching arrivals since activation, as an immutable ordered snapshot. Snapshots run sequentially; failures hold later snapshots. Bounds stop, never drop, excess arrivals.'
			},
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
			'origin',
			'collection',
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
	constructor(request: StudioAgentRequest, presentCase?: (artifactId: string) => void) {
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
				mode: isStudioReadOperation(m.operation) ? 'observe' : 'effect',
				description: m.description,
				parameters: {
					type: 'object',
					additionalProperties: false,
					properties: m.properties,
					required: m.required,
					...(m.operation === 'case-revise'
						? {
								oneOf: [
									{ required: ['case'], not: { required: ['changes'] } },
									{ required: ['changes', 'predecessorArtifactId'], not: { required: ['case'] } }
								]
							}
						: {})
				}
			}))
		})
		this.bind(
			Object.fromEntries(
				methods.map((m) => [
					'studio_' + m.operation.replaceAll('-', '_'),
					async (data: Record<string, unknown>, context?: ActorCallContext) => {
						let effectDispatched = false
						try {
							const scopedRequest = <Value>(operation: string, args: Record<string, unknown>) => {
								context?.signal?.throwIfAborted()
								// Track the transport boundary, not the advertised tool mode:
								// authoring validates and reads before its single draft write.
								if (!isStudioReadOperation(operation)) effectDispatched = true
								return request<Value>(operation, args, context)
							}
							if (m.operation === 'case-propose' || m.operation === 'case-revise') {
								if (
									m.operation === 'case-propose' &&
									(data.predecessorArtifactId !== undefined || data.changes !== undefined)
								)
									throw Error('Use studio_case_revise for an existing case.')
								if (m.operation === 'case-revise' && typeof data.predecessorArtifactId !== 'string')
									throw Error('A revision requires its exact predecessorArtifactId.')
								if (data.changes !== undefined) {
									if (data.case !== undefined || typeof data.predecessorArtifactId !== 'string')
										throw Error(
											'Use changes with predecessorArtifactId, or a complete case; never both.'
										)
									const previous = await scopedRequest<{
										artifact: { payload: { case: unknown } }
									}>('inspect', { artifactId: data.predecessorArtifactId })
									const { changes, ...base } = data
									data = {
										...base,
										case: reviseStudioCase(previous.artifact.payload.case, changes)
									}
								} else {
									const value = parseStudioCase(data.case)
									if (m.operation === 'case-revise') {
										const previous = await scopedRequest<{
											artifact: { payload: { case: unknown } }
										}>('inspect', { artifactId: data.predecessorArtifactId })
										assertStudioCaseEvidenceIdentity(
											parseStudioCase(previous.artifact.payload.case),
											value
										)
									}
									data = { ...data, case: value }
								}
							}
							let result =
								m.operation === 'author'
									? await authorStudioDraft(data, scopedRequest)
									: await scopedRequest(
											m.operation === 'case-revise' ? 'case-propose' : m.operation,
											data
										)
							if (m.operation === 'publish') result = publicationReceipt(result)
							if (
								['case-propose', 'case-revise'].includes(m.operation) &&
								context?.canPresent?.() !== false
							)
								presentCase?.((result as { artifactId: string }).artifactId)
							return { record: JSON.stringify(result), wire: JSON.stringify(result) }
						} catch (error) {
							// Local validation/read failure cannot have saved anything. Once
							// a write crosses the boundary, only a trusted receipt/rejection
							// may settle it; never infer safety from an error message/status.
							if (effectDispatched || error instanceof ActorCommandRejected) throw error
							throw new ActorCommandRejected(
								error instanceof Error ? error.message : 'Studio command rejected before saving.'
							)
						}
					}
				])
			)
		)
	}
}

/** Keep one exact immutable definition, not two copies that push the editable
 * draft handle out of bounded conversation history. UI commands still receive
 * the full service result; this is the agent's publication receipt. */
export function publicationReceipt(value: unknown) {
	const result = value as {
		draft?: {
			id: string
			revision: number
			definition: { name: string }
			publishedArtifactId: string
			publishedRevision: number
		}
		artifact?: unknown
	}
	if (!result?.draft?.definition || !result.artifact) return value
	const { draft, artifact } = result
	return {
		draft: {
			id: draft.id,
			revision: draft.revision,
			name: draft.definition.name,
			publishedArtifactId: draft.publishedArtifactId,
			publishedRevision: draft.publishedRevision
		},
		artifact,
		published: true,
		executed: false,
		next: 'Rename or refine this same Skill with studio_author using this draft id and revision. Publishing its next revision creates an immutable successor, not a separate Skill. Create a copy only for an explicitly requested independent variant.'
	}
}

function closedEdit(
	kind: string,
	properties: Record<string, unknown>,
	required: string[]
): Record<string, unknown> {
	return {
		type: 'object',
		additionalProperties: false,
		properties: { kind: { type: 'string', const: kind }, ...properties },
		required: ['kind', ...required]
	}
}
