import { composeAuthorizedStudioOperation } from './compose-authorized'
import { composeSkillArtifact, composeSkillCollection, repeatSkillStep } from './composer'
import { editStudioSkillV2Batch, newStudioSkillV2 } from './edit'
import {
	parseStudioSkillV2,
	STUDIO_SKILL_ARTIFACT_VERSION,
	type StudioPortBinding,
	type StudioSkillV2
} from './v2'

type Request = <T>(operation: string, data: Record<string, unknown>) => Promise<T>
type Draft = {
	id: string
	revision: number
	definition: StudioSkillV2
	originArtifactId?: string | null
}

/** Small agent commands over the same authorized catalog, composer and CAS drafts as the UI. */
export async function authorStudioDraft(data: Record<string, unknown>, request: Request) {
	const action = data.action as Record<string, unknown>
	if (!action || typeof action.kind !== 'string')
		throw new Error('Choose a typed authoring action.')
	const fields: Record<string, string[]> = {
		create: ['kind', 'name', 'copyArtifactId', 'caseArtifactId'],
		'link-case': ['kind', 'caseArtifactId'],
		'repeat-step': ['kind', 'stepId', 'skillArtifactId', 'collection', 'itemPort'],
		operation: ['kind', 'capabilityId'],
		operations: ['kind', 'capabilityIds'],
		child: ['kind', 'skillArtifactId'],
		'for-each': ['kind', 'skillArtifactId', 'collection', 'itemPort'],
		edit: ['kind', 'edits'],
		preview: ['kind']
	}
	const allowed = fields[action.kind]
	if (!allowed)
		throw new Error('Unknown authoring action. Use one of: ' + Object.keys(fields).join(', '))
	const unknown = Object.keys(action).filter((key) => !allowed.includes(key))
	if (unknown.length)
		throw new Error(
			`Unknown action fields: ${unknown.join(', ')}. ${action.kind} accepts: ${allowed.join(', ')}. Keep id and revision at the top level, beside action. No changes were saved.`
		)
	if (Object.keys(data).some((key) => !['id', 'revision', 'action'].includes(key)))
		throw new Error('Authoring accepts only id, revision and action.')
	let id: string, revision: number, definition: StudioSkillV2
	if (action.kind === 'create') {
		if (data.revision !== 0) throw new Error('Create requires a new draft ID and revision 0.')
		if (typeof action.name !== 'string' || !action.name.trim())
			throw new Error('Name the new Skill.')
		id = String(data.id)
		revision = 0
		definition = action.copyArtifactId
			? await readableSkill(String(action.copyArtifactId), request)
			: newStudioSkillV2(String(action.name))
		definition.name = String(action.name)
		if (action.caseArtifactId)
			definition.caseArtifactId = await confirmedCase(String(action.caseArtifactId), request)
	} else {
		const state = await request<{ drafts: Draft[] }>('state', {})
		const draft = state.drafts.find((item) => item.id === data.id)
		if (!draft) throw new Error('Draft not found. Inspect studio_state and use an exact draft ID.')
		if (draft.revision !== data.revision)
			throw new Error(
				`Draft changed. Read current revision ${draft.revision} in studio_state before making another edit.`
			)
		;({ id, revision, definition } = draft)
	}
	let details: unknown
	let hasCollectionAlternative = false
	if (action.kind === 'link-case') {
		definition.caseArtifactId = await confirmedCase(String(action.caseArtifactId), request)
	} else if (action.kind === 'operation' || action.kind === 'operations') {
		const ids = action.kind === 'operation' ? [action.capabilityId] : action.capabilityIds
		if (
			!Array.isArray(ids) ||
			ids.length < 1 ||
			ids.length > 16 ||
			ids.some((id) => typeof id !== 'string')
		)
			throw new Error('Choose 1–16 exact catalog capability IDs in execution order.')
		const composed = []
		for (const capabilityId of ids) {
			const result = await composeAuthorizedStudioOperation(definition, capabilityId, request)
			definition = result.definition
			hasCollectionAlternative ||= result.cues.some(
				(cue) => cue.collectionAlternative !== undefined
			)
			composed.push({ stepId: result.stepId, cues: result.cues })
		}
		details = { composed }
	} else if (action.kind === 'repeat-step') {
		const childId = String(action.skillArtifactId)
		const result = repeatSkillStep(
			definition,
			String(action.stepId),
			childId,
			await readableSkill(childId, request),
			action.collection as StudioPortBinding,
			String(action.itemPort)
		)
		definition = result.definition
		details = { stepId: result.stepId, cues: result.cues }
	} else if (action.kind === 'child' || action.kind === 'for-each') {
		const childId = String(action.skillArtifactId)
		const child = await readableSkill(childId, request)
		const result =
			action.kind === 'child'
				? composeSkillArtifact(definition, childId, child)
				: composeSkillCollection(
						definition,
						childId,
						child,
						action.collection as StudioPortBinding,
						String(action.itemPort)
					)
		definition = result.definition
		details = { stepId: result.stepId, cues: result.cues }
	} else if (action.kind === 'edit') {
		if (!Array.isArray(action.edits) || action.edits.length < 1 || action.edits.length > 16)
			throw new Error('Supply 1–16 semantic edits. The batch is saved only if every edit is valid.')
		const result = editStudioSkillV2Batch(definition, action.edits)
		definition = result.definition
		details = { changes: result.changes }
	} else if (action.kind === 'preview') {
		return { id, revision, preview: await request('preview', { definition }) }
	} else if (action.kind !== 'create') throw new Error('Unknown authoring action.')
	const saved = await request<Draft>('draft', {
		id,
		revision,
		definition: parseStudioSkillV2(definition),
		...(action.kind === 'create' && action.copyArtifactId
			? { originArtifactId: String(action.copyArtifactId) }
			: {})
	})
	return describeSavedStudioDraft(saved, {
		details,
		hasCollectionAlternative,
		copied: action.kind === 'create' && Boolean(action.copyArtifactId)
	})
}

/** Shared projection for a normal save and an exact recovered save receipt. */
export function describeSavedStudioDraft(
	saved: Draft,
	options: { details?: unknown; hasCollectionAlternative?: boolean; copied?: boolean } = {}
) {
	return {
		id: saved.id,
		revision: saved.revision,
		name: saved.definition.name,
		originArtifactId: saved.originArtifactId ?? null,
		caseArtifactId: saved.definition.caseArtifactId,
		inputs: saved.definition.inputs,
		parametersSchema: saved.definition.parametersSchema,
		outputs: saved.definition.outputs,
		policy: saved.definition.policy,
		steps: saved.definition.steps.map((step) => ({
			id: step.id,
			label: step.label,
			kind: step.kind,
			after: step.after ?? [],
			outputs: Object.fromEntries(
				Object.entries(step.outputs).map(([name, port]) => [
					name,
					{ type: port.type, cardinality: port.cardinality }
				])
			),
			...(step.kind === 'invoke'
				? { capabilityId: step.capabilityId, inputs: step.inputs, parameters: step.parameters }
				: {}),
			...(step.kind === 'skill'
				? {
						skillArtifactId: step.skillArtifactId,
						inputs: step.inputs,
						parameters: step.parameters
					}
				: {}),
			...(step.kind === 'forEach'
				? {
						childSkillArtifactId: step.childSkillArtifactId,
						collection: step.collection,
						childInputs: step.childInputs,
						failureMode: step.failureMode,
						concurrency: step.concurrency
					}
				: {})
		})),
		details: options.details,
		saved: true,
		published: false,
		executed: false,
		next: [
			'Use this id and revision for the next studio_author action. This is an inspection, not definition JSON to copy.',
			'All public settings listed above already exist and are wired. Keep their existing schemas; do not re-declare them to make them adjustable. set-public-parameter is only for adding a genuinely new setting or changing its type/constraints, not for changing a value.',
			...(options.copied
				? [
						'The copy already retains all inputs, public settings, step bindings and outputs. Change only the requested behavior; do not recreate its parameter schema.'
					]
				: []),
			'Change a setting using action:{kind:"edit",edits:[{kind:"set-parameter-binding",stepId:"exact_step_id",parameter:"setting_name",binding:{kind:"literal",value:"new value"}}]}. Each edit needs its OWN kind inside edits; edit kinds are not top-level author actions.',
			'Keep producers before consumers. Replacing or removing a step must update both its data wires and the explicit after dependencies shown above in the same edit batch. Prefer repeat-step to replace a single-item action with a reusable child loop while retaining its downstream wires.',
			...(options.hasCollectionAlternative
				? [
						'A collectionAlternative means MANY → ONE: publish a small parameter-free child for the one-item action, then repeat-step replaces the provisional action with a loop and preserves its wires. Use the published child Skill ID, not a document or draft ID.'
					]
				: []),
			'Preview before publishing. On a conflict or uncertain save, read studio_state before retrying.'
		].join(' ')
	}
}

async function readableSkill(artifactId: string, request: Request): Promise<StudioSkillV2> {
	const { artifact } = await request<{
		artifact: { artifactId: string; typeKey: string; typeVersion: number; payload: unknown }
	}>('inspect', { artifactId })
	if (
		artifact.artifactId !== artifactId ||
		artifact.typeKey !== 'studio.skill' ||
		artifact.typeVersion !== STUDIO_SKILL_ARTIFACT_VERSION
	)
		throw new Error('Choose an exact readable Skill artifact.')
	return parseStudioSkillV2(artifact.payload)
}

async function confirmedCase(artifactId: string, request: Request): Promise<string> {
	const { artifact } = await request<{
		artifact: { typeKey: string; payload: { status: string } }
	}>('inspect', { artifactId })
	if (artifact.typeKey !== 'studio.case' || artifact.payload.status !== 'confirmed')
		throw new Error(
			'Use the exact CONFIRMED case artifact ID from the current Studio case context or studio_state. Confirmation creates a new immutable artifact; the original proposal ID is not confirmed. Do not drop case provenance to bypass confirmation.'
		)
	return artifactId
}
