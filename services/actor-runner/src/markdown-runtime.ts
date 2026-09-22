import {
	Actor,
	type ActorStepPayload,
	CALCULATION_SCHEMA,
	definitionFromManifest,
	LLM_RESULT_SCHEMA,
	type Manifest,
	resourceId,
	type TrustedActorInstallations
} from '@avenos/actors'
import { compositionReader, implementationDigest, installedFactory } from './installed-runtime'
import type { StudioArtifacts } from './studio-artifacts'

const schema = resourceId({
	authority: 'ceo.aven',
	kind: 'schema',
	namespace: 'docs',
	name: 'file',
	version: '1'
})
const text = { type: 'string', maxLength: 65_536 }
const output = {
	name: 'document',
	predicate: 'ceo.aven.docs.file(F)',
	schema,
	role: 'document',
	cardinality: 'one' as const
}
export const MARKDOWN_MANIFEST: Manifest = {
	id: 'markdown',
	authority: 'ceo.aven',
	namespace: 'artifacts',
	version: '1',
	name: 'Markdown documents',
	description:
		'Write Markdown or patch an exact immutable revision. Every edit produces a new artifact with its history.',
	tags: ['documents', 'writing'],
	methods: [
		{
			name: 'write',
			description:
				'Create a Markdown artifact from required title and content. To save generated content, bind the optional source completion and set content to {kind:"input-field",port:"source",path:"/text"}; this keeps its provenance. For an exact calculation bind the calculation port and use its /text field. Saving alone does not attach a file to an Intent.',
			mode: 'transform',
			idempotency: 'pure',
			parameters: {
				type: 'object',
				properties: { title: { type: 'string', minLength: 1, maxLength: 200 }, content: text },
				required: ['title', 'content'],
				additionalProperties: false,
				maxProperties: 2
			},
			requires: [],
			produces: [output.predicate],
			inputSlots: [
				{
					name: 'source',
					schema: LLM_RESULT_SCHEMA,
					predicate: 'ceo.aven.ai.completion(C)',
					role: 'source',
					cardinality: 'optional'
				},
				{
					name: 'calculation',
					schema: CALCULATION_SCHEMA,
					predicate: 'ceo.aven.values.calculation(C)',
					role: 'calculation',
					cardinality: 'optional'
				}
			],
			outputSlots: [output]
		},
		{
			name: 'patch',
			description:
				'Apply exact, unique text replacements to a Markdown artifact. Ambiguous or missing text aborts the entire patch; the original is preserved.',
			mode: 'transform',
			idempotency: 'pure',
			parameters: {
				type: 'object',
				properties: {
					edits: {
						type: 'array',
						minItems: 1,
						maxItems: 16,
						items: {
							type: 'object',
							properties: { find: { ...text, minLength: 1 }, replace: text },
							required: ['find', 'replace'],
							additionalProperties: false,
							maxProperties: 2
						}
					}
				},
				required: ['edits'],
				additionalProperties: false,
				maxProperties: 1
			},
			requires: [output.predicate],
			produces: [output.predicate],
			inputSlots: [{ ...output, mediaTypes: ['text/markdown'] }],
			outputSlots: [output]
		}
	]
}

export async function installMarkdownRuntimeActor(installations: TrustedActorInstallations) {
	await installations.install({
		packageId: '@avenos/actor-runner/markdown',
		manifest: MARKDOWN_MANIFEST,
		placements: ['server'],
		schemas: [
			{
				schema: CALCULATION_SCHEMA,
				typeKey: 'values.calculation',
				typeVersion: 2,
				projectorDigest: implementationDigest('values.calculation@2')
			},
			{
				schema: LLM_RESULT_SCHEMA,
				typeKey: 'ai.completion',
				typeVersion: 1,
				projectorDigest: implementationDigest('ai.completion@1')
			},
			{
				schema,
				typeKey: 'core.file',
				typeVersion: 1,
				projectorDigest: implementationDigest('core.file@1')
			}
		],
		procedures: definitionFromManifest(MARKDOWN_MANIFEST).capabilities.map((c) => ({
			capabilityId: c.id,
			procedureKey: 'artifacts.markdown.' + c.method,
			procedureVersion: '1',
			implementationDigest: implementationDigest('markdown-immutable-exact-patch-1'),
			evidenceRuleDigest: implementationDigest(
				'causal-input:document;new-immutable-output:document'
			),
			requiredFeatures: []
		}))
	})
}

export function createMarkdownRuntimeFactory(store: StudioArtifacts) {
	return installedFactory(MARKDOWN_MANIFEST, store.scope, () => {
		const reader = compositionReader(store)
		const actor = new Actor(
			MARKDOWN_MANIFEST,
			Object.fromEntries(
				MARKDOWN_MANIFEST.methods.map((method) => [
					method.name,
					async (raw) => {
						const call = raw as unknown as ActorStepPayload
						let title = String(call.parameters.title ?? ''),
							content = String(call.parameters.content ?? '')
						if (method.name === 'patch') {
							const input = call.inputMembers?.document
							if (input?.length !== 1) throw Error('MARKDOWN_BASE_REQUIRED')
							const base = await store.get(input[0]!.artifactId)
							if (
								base.typeKey !== 'core.file' ||
								base.typeVersion !== 1 ||
								!/^text\/markdown(?:;|$)/i.test(String(base.payload.declaredMediaType))
							)
								throw Error('MARKDOWN_BASE_TYPE_MISMATCH')
							title = String(base.payload.originalName)
							content = new TextDecoder('utf-8', { fatal: true }).decode(
								await reader.content(input[0]!, 262_144)
							)
							const edits = call.parameters.edits as Array<{ find: string; replace: string }>
							if (!Array.isArray(edits) || !edits.length || edits.length > 16)
								throw Error('MARKDOWN_EDITS_INVALID')
							for (const edit of edits) {
								if (typeof edit.find !== 'string' || !edit.find || typeof edit.replace !== 'string')
									throw Error('MARKDOWN_EDITS_INVALID')
								const at = content.indexOf(edit.find)
								if (at < 0) throw Error('MARKDOWN_PATCH_TEXT_NOT_FOUND')
								if (content.indexOf(edit.find, at + 1) >= 0) throw Error('MARKDOWN_PATCH_AMBIGUOUS')
								content = content.slice(0, at) + edit.replace + content.slice(at + edit.find.length)
								if (content.length > 65_536) throw Error('MARKDOWN_CONTENT_LIMIT')
							}
						}
						if (!title.trim() || content.length > 65_536) throw Error('MARKDOWN_CONTENT_INVALID')
						const originalName = title.endsWith('.md') ? title : title + '.md'
						return {
							wire:
								method.name === 'patch'
									? 'Saved a new Markdown revision; the original remains available.'
									: 'Markdown document created.',
							record: JSON.stringify({
								ok: true,
								outputs: {
									document: {
										originalName,
										declaredMediaType: 'text/markdown; charset=utf-8',
										sourceKind: 'actor-authored',
										executionEnvironment: 'server'
									}
								},
								blobs: {
									'document-0': {
										base64: Buffer.from(content, 'utf8').toString('base64'),
										mediaType: 'text/markdown; charset=utf-8'
									}
								}
							})
						}
					}
				])
			)
		)
		return { actor, dispose: () => actor.dispose() }
	})
}
