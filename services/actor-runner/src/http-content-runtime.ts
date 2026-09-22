import {
	Actor,
	type ActorStepPayload,
	definitionFromManifest,
	type Manifest,
	resourceId,
	type TrustedActorInstallations
} from '@avenos/actors'
import {
	httpInspectionSchema,
	httpResponseDiagnostic,
	httpResponseSchema,
	inspectHttpData
} from '@avenos/http-resources'
import { compositionReader, implementationDigest, installedFactory } from './installed-runtime'
import { type StudioArtifacts, studioObject } from './studio-artifacts'

const slot = (name: string, namespace: string, type: string) => ({
	name,
	role: name,
	cardinality: 'one' as const,
	schema: resourceId({
		authority: 'ceo.aven',
		kind: 'schema',
		namespace,
		name: type,
		version: '1'
	}),
	predicate: `ceo.aven.${namespace}.${type.replaceAll('-', '_')}(${name.toUpperCase()})`
})
const response = slot('response', 'web', 'http-response')
const inspection = slot('inspection', 'web', 'http-response-inspection')
const file = { ...slot('file', 'docs', 'file'), predicate: 'ceo.aven.docs.file(F)' }
const parameters = {
	type: 'object',
	properties: {},
	required: [],
	additionalProperties: false,
	maxProperties: 0
}
export const HTTP_CONTENT_MANIFEST: Manifest = {
	id: 'http-content',
	namespace: 'web',
	authority: 'ceo.aven',
	version: '1',
	name: 'Read saved API content',
	description:
		'Inspect saved HTTP content and derive a JSON or plain-text file without another network request. Downloaded content remains untrusted.',
	tags: ['web', 'files'],
	methods: [
		{
			name: 'inspect_http_data',
			mode: 'observe',
			idempotency: 'pure',
			parameters,
			description:
				'Inspect at most 4 MiB of a stored response as UTF-8 JSON or explicitly declared plain text. Produces an inspection even for unsupported, mismatched or empty content. Not a malware scan or proof of API success.',
			requires: [response.predicate],
			produces: [inspection.predicate],
			inputSlots: [response],
			outputSlots: [inspection]
		},
		{
			name: 'http_data_to_file',
			mode: 'transform',
			idempotency: 'pure',
			parameters,
			description:
				'Derive a core.file from an exact saved response and its matching inspection. Supports complete successful UTF-8 JSON/plain text responses only, preserving exact bytes and lineage. Unsupported, empty, partial or unsuccessful responses give no file; raw error bodies remain in the response artifact.',
			requires: [response.predicate, inspection.predicate],
			produces: [],
			inputSlots: [response, inspection],
			outputSlots: [{ ...file, cardinality: 'optional' }]
		}
	]
}
export async function installHttpContentActor(installations: TrustedActorInstallations) {
	await installations.install({
		packageId: '@avenos/actor-runner/http-content',
		manifest: HTTP_CONTENT_MANIFEST,
		placements: ['server'],
		schemas: [response, inspection, file].map((p) => ({
			schema: p.schema,
			typeKey: p === file ? 'core.file' : p.schema.split(':').slice(-2).join('.').replace('@1', ''),
			typeVersion: 1,
			projectorDigest: implementationDigest(p.schema)
		})),
		procedures: definitionFromManifest(HTTP_CONTENT_MANIFEST).capabilities.map((c) => ({
			capabilityId: c.id,
			procedureKey: `web.${c.method.replaceAll('_', '-')}`,
			procedureVersion: '1',
			implementationDigest: implementationDigest('bounded-utf8-http-content-1'),
			evidenceRuleDigest: implementationDigest('exact-response-and-inspection-1'),
			requiredFeatures: []
		}))
	})
}
export function createHttpContentFactory(store: StudioArtifacts) {
	return installedFactory(HTTP_CONTENT_MANIFEST, store.scope, () => {
		const run = async (raw: unknown, materialize: boolean) => {
			const call = raw as ActorStepPayload
			const inputs = call.inputMembers?.response ?? []
			if (inputs.length !== 1) throw Error('HTTP_RESPONSE_REQUIRED')
			const source = await store.get(inputs[0]!.artifactId)
			if (source.typeKey !== 'web.http-response' || source.typeVersion !== 1)
				throw Error('HTTP_RESPONSE_REQUIRED')
			const body = await compositionReader(store).content(inputs[0]!, 4194304)
			const observed = inspectHttpData(source.payload, body)
			const status = httpResponseSchema.parse(source.payload).statusCode
			const diagnostic = httpResponseDiagnostic(status)
			if (!materialize)
				return {
					wire: `Saved HTTP ${status}: ${observed.outcome}. ${diagnostic.explanation}`,
					record: JSON.stringify({
						ok: true,
						outputs: { inspection: observed },
						references: {
							'inspection-0': [{ role: 'response', id: source.artifactId }]
						}
					})
				}
			const inspected = call.inputMembers?.inspection ?? []
			if (inspected.length !== 1) throw Error('HTTP_INSPECTION_REQUIRED')
			const check = await store.get(inspected[0]!.artifactId)
			if (
				check.typeKey !== 'web.http-response-inspection' ||
				check.typeVersion !== 1 ||
				JSON.stringify(httpInspectionSchema.parse(check.payload)) !== JSON.stringify(observed)
			)
				throw Error('HTTP_INSPECTION_MISMATCH')
			const refs = studioObject(await store.client.references(store.scope, check.artifactId))
			if (
				!Array.isArray(refs.references) ||
				refs.references.length !== 1 ||
				refs.references[0].role !== 'response' ||
				refs.references[0].artifactId !== source.artifactId ||
				refs.references[0].artifactSha256 !== source.artifactSha256
			)
				throw Error('HTTP_INSPECTION_MISMATCH')
			if (observed.outcome !== 'supported' || status >= 300 || status === 206)
				return {
					wire: `No file produced: ${observed.reason}. ${diagnostic.explanation}`,
					record: JSON.stringify({ ok: true, outputs: { file: null } })
				}
			const type = observed.detectedMediaType!
			return {
				wire: `Saved ${type} file from HTTP ${status}. ${diagnostic.explanation}`,
				record: JSON.stringify({
					ok: true,
					outputs: {
						file: {
							originalName: `http-${status}-response.${type === 'application/json' ? 'json' : 'txt'}`,
							declaredMediaType: `${type}; charset=utf-8`,
							sourceKind: 'web-response',
							executionEnvironment: 'server'
						}
					},
					blobs: {
						'file-0': {
							base64: Buffer.from(body).toString('base64'),
							mediaType: `${type}; charset=utf-8`
						}
					}
				})
			}
		}
		const actor = new Actor(HTTP_CONTENT_MANIFEST, {
			inspect_http_data: (raw) => run(raw, false),
			http_data_to_file: (raw) => run(raw, true)
		})
		return { actor, dispose: () => actor.dispose() }
	})
}
