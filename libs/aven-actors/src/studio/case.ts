/** A case is evidence and an intended procedure, never an executable program. */
export interface StudioCaseEvidence {
	id: string
	kind: 'artifact' | 'message' | 'intent' | 'recollection'
	sourceId: string
	locator: string
	quote: string
	interpretation: string
}
export type StudioCaseStep = {
	id: string
	label: string
	evidenceIds: string[]
} & (
	| { kind: 'action'; capabilityId: string }
	| { kind: 'skill'; artifactId: string }
	| { kind: 'ideal'; needs: string; produces: string; acceptance: string }
)
export interface StudioCase {
	title: string
	situation: string
	outcome: string
	evidence: StudioCaseEvidence[]
	steps: StudioCaseStep[]
	uncertainties: string[]
}
export interface StudioCaseRecord {
	case: StudioCase
	status: 'proposed' | 'confirmed'
	predecessorArtifactId: string | null
	recordedBy: string
}
export class StudioCaseError extends Error {}
const stringField = (maxLength: number, minLength = 1) => ({ type: 'string', minLength, maxLength })
const acceptanceField = {
	...stringField(2000),
	description:
		"Testable conditions that must ALL hold before this ideal step is complete. Preserve the user's mandatory requirements; never introduce an alternative that bypasses a required check, approval or input. A warning, unknown value or unreviewed result does not satisfy a required human check. A human may leave a question unresolved AFTER reviewing it, but the recorded review remains required. If a condition cannot yet be met, keep it mandatory and identify the missing capability in needs. Do not add a mandatory gate the user did not request. This describes intended behavior, not an implemented guarantee."
}
const closed = (properties: Record<string, unknown>) => ({
	type: 'object',
	additionalProperties: false,
	properties,
	required: Object.keys(properties)
})
const stepBase = {
	id: stringField(80),
	label: stringField(160),
	evidenceIds: { type: 'array', maxItems: 32, items: stringField(80) }
}
/** The same contract is shown to human/agent authors; no undocumented required fields. */
export const studioCaseJsonSchema = {
	...closed({
		title: stringField(160),
		situation: stringField(2000),
		outcome: stringField(2000),
		evidence: {
			type: 'array',
			minItems: 1,
			maxItems: 32,
			items: {
				oneOf: ['artifact', 'message', 'intent', 'recollection'].map((kind) =>
					closed({
						id: stringField(80),
						kind: { type: 'string', const: kind },
						sourceId:
							kind === 'artifact'
								? {
										type: 'string',
										format: 'uuid',
										description:
											'Exact existing artifact UUID returned by the store. Catalog results are not historical artifacts; never invent their IDs.'
									}
								: {
										...stringField(256),
										description:
											'Exact source reference, or an attributed current user recollection. Never label a catalog observation as historical evidence.'
									},
						locator: stringField(256, 0),
						quote: stringField(4000),
						interpretation: stringField(2000, 0)
					})
				)
			}
		},
		steps: {
			type: 'array',
			maxItems: 32,
			items: {
				oneOf: [
					closed({ ...stepBase, kind: { const: 'action' }, capabilityId: stringField(256) }),
					closed({
						...stepBase,
						kind: { const: 'skill' },
						artifactId: { type: 'string', format: 'uuid' }
					}),
					closed({
						...stepBase,
						kind: { const: 'ideal' },
						needs: stringField(2000),
						produces: stringField(2000),
						acceptance: acceptanceField
					})
				]
			}
		},
		uncertainties: { type: 'array', maxItems: 16, items: stringField(2000) }
	}),
	description:
		'Complete case JSON object with all six fields: title, situation, outcome, evidence, steps, uncertainties. For a revision, retain the previous case and change the requested fields. An existing evidence ID keeps its kind, sourceId and exact quote unchanged. Add new statements or corrected source quotations with a new evidence ID; never merge later words into an old quote. Never supply a string, a steps array, patch notation or code in place of this object.'
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const studioCaseChangesJsonSchema = {
	type: 'object',
	additionalProperties: false,
	minProperties: 1,
	description:
		'Small revision of an existing case. Omitted fields and steps are preserved. stepUpdates changes fields on exact existing step IDs, not the entire step. For adding/removing/reordering steps use a complete case instead.',
	properties: {
		title: stringField(160),
		situation: stringField(2000),
		outcome: stringField(2000),
		uncertainties: { type: 'array', maxItems: 16, items: stringField(2000) },
		stepUpdates: {
			type: 'array',
			minItems: 1,
			maxItems: 32,
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['id'],
				minProperties: 2,
				properties: {
					id: stringField(80),
					label: stringField(160),
					needs: stringField(2000),
					produces: stringField(2000),
					acceptance: acceptanceField
				}
			}
		}
	}
}

/** Pure editing only. The caller must load an authorized immutable predecessor
 * and publish the result through the same case proposal/confirmation boundary. */
export function reviseStudioCase(raw: unknown, changes: unknown): StudioCase {
	const original = parseStudioCase(raw)
	const change = object(
		changes,
		['title', 'situation', 'outcome', 'uncertainties', 'stepUpdates'],
		[]
	)
	if (!Object.keys(change).length) throw new StudioCaseError('Supply at least one case change.')
	const { stepUpdates, ...fields } = change
	const steps = original.steps.map((step) => ({ ...step }))
	if (stepUpdates !== undefined) {
		const seen = new Set<string>()
		const updates = list(
			stepUpdates,
			32,
			(update) => object(update, ['id', 'label', 'needs', 'produces', 'acceptance'], ['id']),
			'stepUpdates'
		)
		if (!updates.length) throw new StudioCaseError('Supply at least one step update.')
		for (const update of updates) {
			const id = text(update.id, 80),
				index = steps.findIndex((step) => step.id === id)
			if (index < 0 || seen.has(id))
				throw new StudioCaseError('Step update needs a distinct existing step ID.')
			if (Object.keys(update).length === 1)
				throw new StudioCaseError('Supply a field to change, not only the step ID.')
			seen.add(id)
			steps[index] = { ...steps[index]!, ...update } as StudioCaseStep
		}
	}
	return parseStudioCase({ ...original, ...fields, steps })
}
/** Evidence identity survives a case revision. Interpretation and selection may
 * change, but a different source or quotation is a different piece of evidence.
 * The immutable predecessor retains evidence explicitly removed from a revision. */
export function assertStudioCaseEvidenceIdentity(previous: StudioCase, next: StudioCase): void {
	const originals = new Map(previous.evidence.map((item) => [item.id, item]))
	for (const item of next.evidence) {
		const original = originals.get(item.id)
		if (
			original &&
			(['kind', 'sourceId', 'quote'] as const).some((key) => item[key] !== original[key])
		)
			throw new StudioCaseError(
				`Evidence ${item.id} changes an existing source or quotation. Keep its kind, sourceId and quote unchanged; use a new evidence ID for a new statement or corrected quotation.`
			)
	}
}
function object(value: unknown, keys: string[], required = keys): Record<string, unknown> {
	if (
		!value ||
		typeof value !== 'object' ||
		Array.isArray(value) ||
		Object.keys(value).some((k) => !keys.includes(k))
	)
		throw new StudioCaseError(`Invalid case object. Allowed fields: ${keys.join(', ')}.`)
	const missing = required.filter((key) => !(key in value))
	if (missing.length)
		throw new StudioCaseError(
			`Missing required fields: ${missing.join(', ')}. Supply those exact fields; do not shorten unrelated quotes or labels.`
		)
	return value as Record<string, unknown>
}
function text(value: unknown, limit = 2000, empty = false, field = 'text'): string {
	if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > limit)
		throw new StudioCaseError(
			`${field} must be a ${empty ? '' : 'non-empty '}string of at most ${limit} characters.`
		)
	return value
}
function list<T>(value: unknown, max: number, parse: (v: unknown) => T, field = 'list'): T[] {
	if (!Array.isArray(value) || value.length > max)
		throw new StudioCaseError(`${field} must be a list with at most ${max} entries.`)
	return value.map((item, index) => {
		try {
			return parse(item)
		} catch (error) {
			if (error instanceof StudioCaseError)
				throw new StudioCaseError(`${field}[${index}]: ${error.message}`)
			throw error
		}
	})
}
export function parseStudioCase(raw: unknown): StudioCase {
	if ((JSON.stringify(raw)?.length ?? 0) > 100_000)
		throw new StudioCaseError('Case exceeds its size limit.')
	const c = object(raw, ['title', 'situation', 'outcome', 'evidence', 'steps', 'uncertainties'])
	const evidence = list(
		c.evidence,
		32,
		(v) => {
			const e = object(v, ['id', 'kind', 'sourceId', 'locator', 'quote', 'interpretation'])
			if (!['artifact', 'message', 'intent', 'recollection'].includes(String(e.kind)))
				throw new StudioCaseError(
					'Evidence kind must be artifact, message, intent or recollection.'
				)
			const kind = e.kind as StudioCaseEvidence['kind']
			const sourceId = text(e.sourceId, 256, false, 'sourceId')
			if (kind === 'artifact' && !uuid.test(sourceId))
				throw new StudioCaseError(
					'Use an existing artifact UUID. Catalog capabilities belong on action steps as capabilityId, not in historical artifact evidence. Remove catalog-only evidence; never invent an artifact ID.'
				)
			return {
				id: text(e.id, 80, false, 'id'),
				kind,
				sourceId,
				locator: text(e.locator, 256, true, 'locator'),
				quote: text(e.quote, 4000, false, 'quote'),
				interpretation: text(e.interpretation, 2000, true, 'interpretation')
			}
		},
		'evidence'
	)
	const ids = new Set(evidence.map((e) => e.id))
	if (ids.size !== evidence.length || !ids.size)
		throw new StudioCaseError('A case needs distinct evidence or an attributed recollection.')
	const steps = list(
		c.steps,
		32,
		(v) => {
			const s = object(
				v,
				[
					'id',
					'label',
					'evidenceIds',
					'kind',
					'capabilityId',
					'artifactId',
					'needs',
					'produces',
					'acceptance'
				],
				['id', 'label', 'evidenceIds', 'kind']
			)
			const base = {
				id: text(s.id, 80, false, 'id'),
				label: text(s.label, 160, false, 'label'),
				evidenceIds: list(s.evidenceIds, 32, (v) => text(v, 80))
			}
			if (base.evidenceIds.some((id) => !ids.has(id)))
				throw new StudioCaseError('Step cites missing evidence.')
			if (s.kind === 'action') {
				object(v, ['id', 'label', 'evidenceIds', 'kind', 'capabilityId'])
				const capabilityId = text(s.capabilityId, 256, false, 'capabilityId')
				if (
					!/^[a-z0-9][a-z0-9._-]*:capability:[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._-]*@[a-zA-Z0-9][a-zA-Z0-9._+-]*$/.test(
						capabilityId
					)
				)
					throw new StudioCaseError(
						'Copy an exact capabilityId from the catalog; placeholders are not executable steps. Use an ideal step for a genuinely missing capability.'
					)
				return { ...base, kind: 'action' as const, capabilityId }
			}
			if (s.kind === 'skill') {
				object(v, ['id', 'label', 'evidenceIds', 'kind', 'artifactId'])
				if (!uuid.test(String(s.artifactId)))
					throw new StudioCaseError('Use an exact Skill artifact ID.')
				return { ...base, kind: 'skill' as const, artifactId: String(s.artifactId) }
			}
			if (s.kind !== 'ideal')
				throw new StudioCaseError(
					'Step kind must be action, skill or ideal. An ideal step requires needs, produces and acceptance strings.'
				)
			object(v, ['id', 'label', 'evidenceIds', 'kind', 'needs', 'produces', 'acceptance'])
			return {
				...base,
				kind: 'ideal' as const,
				needs: text(s.needs, 2000, false, 'ideal.needs'),
				produces: text(s.produces, 2000, false, 'ideal.produces'),
				acceptance: text(s.acceptance, 2000, false, 'ideal.acceptance')
			}
		},
		'steps'
	)
	if (new Set(steps.map((s) => s.id)).size !== steps.length)
		throw new StudioCaseError('Step IDs must be distinct.')
	return {
		title: text(c.title, 160, false, 'title'),
		situation: text(c.situation, 2000, false, 'situation'),
		outcome: text(c.outcome, 2000, false, 'outcome'),
		evidence,
		steps,
		uncertainties: list(c.uncertainties, 16, (v) => text(v), 'uncertainties')
	}
}
/** Structural rehearsal only. No models, Actors, writes, or invented output artifacts. */
export function simulateStudioCase(raw: unknown) {
	const c = parseStudioCase(raw)
	let hypothetical = false
	return {
		mode: 'structural-what-if' as const,
		executes: false,
		result: 'hypothetical' as const,
		steps: c.steps.map((step) => {
			hypothetical ||= step.kind === 'ideal'
			return {
				...step,
				status:
					step.kind === 'ideal'
						? 'needs-implementation'
						: hypothetical
							? 'depends-on-ideal'
							: 'not-executed'
			}
		}),
		gaps: c.steps.filter((s) => s.kind === 'ideal').length,
		uncertainties: c.uncertainties
	}
}
