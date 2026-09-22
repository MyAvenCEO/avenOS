import { definitionFromManifest, type TrustedActorInstallations } from '@avenos/actors'
import { DOCUMENT_SCHEMA_BINDINGS, type DocumentDecoder } from '@avenos/document-ingest'
import {
	createDocumentActors,
	DOCUMENT_ACTOR_MANIFESTS
} from '@avenos/document-ingest/actors/registry'
import { createDocumentCompositionActor } from '@avenos/document-ingest/composition'
import type { DocumentModelGateway } from '@avenos/document-ingest/model'
import { DOCUMENT_PROCEDURES } from '@avenos/document-ingest/provenance'
import { ServerDocumentDecoder } from '@avenos/document-ingest/server'
import { compositionReader, implementationDigest, installedFactory } from './installed-runtime'
import type { StudioArtifacts } from './studio-artifacts'

export async function installDocumentRuntimeActors(installations: TrustedActorInstallations) {
	for (const manifest of DOCUMENT_ACTOR_MANIFESTS) {
		const procedure = Object.entries(DOCUMENT_PROCEDURES).find(
			([name, p]) => p.actor === manifest.id && !name.startsWith('client.merge-')
		)!
		if (!procedure && manifest.id !== 'document-merger')
			throw Error('DOCUMENT_PROCEDURE_NOT_INSTALLED:' + manifest.id)
		await installations.install({
			packageId: '@avenos/document-ingest',
			manifest,
			placements: ['server'],
			schemas: Object.values(DOCUMENT_SCHEMA_BINDINGS)
				.filter((b, i, all) => all.findIndex((c) => c.schema === b.schema) === i)
				.map((b) => ({
					schema: b.schema,
					typeKey: b.typeKey,
					typeVersion: b.typeVersion,
					projectorDigest: implementationDigest(JSON.stringify(b))
				})),
			procedures: definitionFromManifest(manifest).capabilities.map((c) => ({
				capabilityId: c.id,
				procedureKey:
					(
						{
							document_merge_kinds: 'client.merge-document-kinds',
							document_merge_invoice: 'client.merge-invoice-chunks',
							document_merge_statement: 'client.merge-statement-chunks'
						} as Record<string, string>
					)[c.method] ?? procedure![0],
				procedureVersion: 'studio-1',
				implementationDigest: implementationDigest(
					'document-composition-1:' + JSON.stringify(manifest)
				),
				evidenceRuleDigest: implementationDigest('document-evidence:exact-causal-inputs-1'),
				requiredFeatures: !procedure || procedure[1].deterministic ? [] : ['model']
			}))
		})
	}
}

export function createDocumentRuntimeFactories(
	store: StudioArtifacts,
	model?: DocumentModelGateway,
	options: { decoder?: () => DocumentDecoder; signal?: AbortSignal } = {}
) {
	return DOCUMENT_ACTOR_MANIFESTS.map((manifest) =>
		installedFactory(manifest, store.scope, () => {
			const decoder = options.decoder?.() ?? new ServerDocumentDecoder()
			const boundModel = model
				? {
						status: () => model.status(),
						complete: (request: import('@avenos/document-ingest/model').DocumentModelRequest) => {
							options.signal?.throwIfAborted()
							return model.complete(request, { signal: options.signal })
						}
					}
				: undefined
			const actors = createDocumentActors(decoder, boundModel)
			try {
				const actor = createDocumentCompositionActor(
					manifest,
					actors,
					decoder,
					compositionReader(store)
				)
				return {
					actor,
					dispose() {
						actor.dispose()
						for (const a of actors.all) a.dispose()
					}
				}
			} catch (error) {
				for (const a of actors.all) a.dispose()
				throw error
			}
		})
	)
}
