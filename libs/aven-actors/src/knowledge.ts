import { Actor, type Manifest } from './actor'
import { resourceId } from './ids'
import { moneyFromMinor } from './money'
import { parseStudioSkillParameters } from './studio/v2'

export const KNOWLEDGE_SCHEMA = resourceId({
	authority: 'ceo.aven',
	kind: 'schema',
	namespace: 'knowledge',
	name: 'result',
	version: '1'
})
export const KNOWLEDGE_PARAMETERS = {
	type: 'object',
	additionalProperties: false,
	maxProperties: 10,
	properties: {
		purpose: { type: 'string', minLength: 1, maxLength: 240 },
		collection: {
			type: 'string',
			maxLength: 32,
			enum: ['documents', 'invoices', 'statements', 'transactions', 'line-items']
		},
		view: { type: 'string', maxLength: 16, enum: ['schema', 'rows', 'summary'] },
		where: {
			type: 'array',
			maxItems: 8,
			items: {
				type: 'object',
				additionalProperties: false,
				maxProperties: 3,
				properties: {
					field: { type: 'string', minLength: 1, maxLength: 64 },
					op: { type: 'string', maxLength: 16, enum: ['present', 'eq', 'not-in'] },
					values: {
						type: 'array',
						maxItems: 16,
						items: { type: 'string', minLength: 1, maxLength: 256 }
					}
				},
				required: ['field', 'op', 'values']
			}
		},
		measure: { type: 'string', minLength: 1, maxLength: 64 },
		search: { type: 'string', maxLength: 512 },
		after: { type: 'string', maxLength: 4096 },
		limit: { type: 'integer', minimum: 1, maximum: 100 },
		snapshot_sequence: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
		store_epoch: { type: 'string', minLength: 36, maxLength: 36 }
	},
	required: ['collection', 'view']
}
export const KNOWLEDGE_MANIFEST: Manifest = {
	id: 'knowledge',
	authority: 'ceo.aven',
	namespace: 'knowledge',
	version: '1',
	name: 'Workspace knowledge',
	tags: ['analysis', 'knowledge'],
	description:
		'Inspect the available schema, select recorded observations, or count and sum a whole selection without reading source files.',
	methods: [
		{
			name: 'knowledge_query',
			mode: 'observe',
			idempotency: 'none',
			description:
				'Include purpose: one short user-facing sentence explaining why this query helps with the current request. Describe the intended check, not a promised result. ' +
				'For a count-only question use summary directly and answer with the count and its meaning, not a list of files. Distinct artifact IDs identify stored records; they do not establish content uniqueness or prove distinct underlying transactions. ' +
				'Query recorded observations without reading source files. ONE call with collection:documents, view:schema returns the complete catalog for ALL collections; do not repeat it per collection. Use rows for examples/evidence or summary for WHOLE-selection counts and currency-separated sums. Filters are ANDed {field,op,values}: present [], eq one value, not-in 1–16. Missing/null/unknown NEVER match, including not-in. Integer-minor properties use canonical integer strings in values. Only catalog properties exist; no arbitrary relations or ownership inference. summary optionally accepts measure and sums INTEGER MINOR UNITS, not major currency units. Counts are strings. Receipt totals are not established outstanding balances. Results include validation status, exact source/representation IDs, storeEpoch and snapshotSequence. To reuse that boundary supply BOTH store_epoch and snapshot_sequence parameters; pass nextAfter as after to page rows. No records does not prove no documents exist: extraction coverage is limited. Skills expose /data and /text with inspectable provenance.',
			parameters: KNOWLEDGE_PARAMETERS,
			requires: [],
			produces: ['ceo.aven.knowledge.result(K)'],
			inputSlots: [],
			outputSlots: [
				{
					name: 'result',
					schema: KNOWLEDGE_SCHEMA,
					predicate: 'ceo.aven.knowledge.result(K)',
					role: 'result',
					cardinality: 'one'
				}
			]
		}
	]
}

/** Hosts supply only authorized transport; query semantics live in the Store. */
export function createKnowledgeActor(
	query: (parameters: Record<string, unknown>) => Promise<unknown>,
	parameters: (raw: Record<string, unknown>) => unknown = (raw) => raw
) {
	return new Actor(KNOWLEDGE_MANIFEST, {
		knowledge_query: async (raw) => {
			const p = parseStudioSkillParameters(
				{ parametersSchema: KNOWLEDGE_PARAMETERS },
				parameters(raw)
			)
			const data = (await query({
				...Object.fromEntries(
					Object.entries(p).filter(
						([key]) => !['purpose', 'snapshot_sequence', 'store_epoch'].includes(key)
					)
				),
				...(p.snapshot_sequence !== undefined ? { snapshotSequence: p.snapshot_sequence } : {}),
				...(p.store_epoch ? { storeEpoch: p.store_epoch } : {}),
				...(p.where ? { where: JSON.stringify(p.where) } : {})
			})) as Record<string, any>
			if (!data || typeof data !== 'object' || Array.isArray(data))
				throw Error('KNOWLEDGE_RESPONSE_INVALID')
			// Expose exact display/calculation operands rather than asking a model to
			// guess a currency scale or relabel cents as euros before dividing.
			if (Array.isArray(data.groups))
				data.groups = data.groups.map((group: any) => ({
					...group,
					sumMajor: moneyFromMinor(group.sumMinor, group.currency)
				}))
			if (Array.isArray(data.items)) {
				const fields = data.schema?.fields
				if (!fields || typeof fields !== 'object' || Array.isArray(fields))
					throw Error('KNOWLEDGE_RESPONSE_SCHEMA_MISSING')
				const moneyFields = Object.entries(fields).filter(([, kind]) => kind === 'integer-minor')
				data.items = data.items.map((item: any) => ({
					...item,
					money: Object.fromEntries(
						moneyFields.map(([field]) => [
							field,
							moneyFromMinor(item.data?.[field], item.data?.currency)
						])
					)
				}))
			}
			const ids = new Set<string>()
			for (const item of data.items ?? []) {
				for (const id of [
					item.source?.artifactId,
					item.documentId,
					...(item.representations ?? []).map((r: any) => r.artifactId)
				])
					if (typeof id === 'string') ids.add(id)
			}
			if (ids.size > 2048) throw Error('KNOWLEDGE_EVIDENCE_LIMIT')
			const result = {
				version: 1,
				query: {
					...p,
					...(data.storeEpoch
						? { storeEpoch: data.storeEpoch, snapshotSequence: data.snapshotSequence }
						: {})
				},
				data,
				text: JSON.stringify(data)
			}
			const record = JSON.stringify({
				ok: true,
				notice:
					'Stored record counts are not deduplicated business-event counts. Different artifact IDs alone do not prove distinct file contents or transactions. ' +
					'These are recorded structured observations, not retained source pages. The query receipt is available to answer verification. groups[].sumMajor and items[].money contain exact major-unit decimal values and currency units, with the original minorUnits and minorDigits retained. Use those typed values directly; do not divide them again, invent currency:EUR-minor units, or relabel raw minor units as major currency values. Null means the amount or currency scale is unknown. For a question about these recorded fields, report the observations and their limitations directly; do not inspect artifacts or read files merely to explain a missing value or manufacture a citation. Missing paid/outstanding amounts mean unknown, not zero; the reason for a review flag is unknown unless separately evidenced. Only follow exact artifact IDs present in returned rows when the requested question actually needs that detail; never invent a placeholder ID. Do not cite source artifact IDs or extracted/generated summaries as exact quotations in research_record. Use items:[] when no primary-source claim needs a checklist. If the user asks to verify against the original, use workspace_read first and quote only its returned source text.',
				outputs: { result },
				references: { 'result-0': [...ids].map((id) => ({ role: 'evidence', id })) }
			})
			return { record, wire: record }
		}
	})
}
