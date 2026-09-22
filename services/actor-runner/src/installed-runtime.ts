import { createHash } from 'node:crypto'
import {
	type Actor,
	type ActorAuthorizer,
	type ActorFactory,
	type ActorFactoryOffer,
	ActorRegistry,
	type ActorStepInput,
	definitionFromManifest,
	type Manifest,
	resourceId,
	type TrustedActorInstallations
} from '@avenos/actors'
import type { DocumentCompositionReader } from '@avenos/document-ingest/composition'
import { type StudioArtifacts, studioObject } from './studio-artifacts'

export const implementationDigest = (value: string) =>
	createHash('sha256').update(value).digest('hex')

export function installedOffer(manifest: Manifest): ActorFactoryOffer {
	const definition = definitionFromManifest(manifest)
	return {
		offerId: resourceId({
			authority: manifest.authority!,
			kind: 'offer',
			namespace: manifest.namespace!,
			name: manifest.id + '-server',
			version: manifest.version!
		}),
		factoryId: resourceId({
			authority: manifest.authority!,
			kind: 'factory',
			namespace: manifest.namespace!,
			name: manifest.id + '-server',
			version: manifest.version!
		}),
		definitionRef: definition.ref,
		label: manifest.name + ' · server',
		capabilityIds: definition.capabilities.map((c) => c.id),
		executionEnvironment: 'server',
		lifetime: 'step'
	}
}

export function installedFactory(
	manifest: Manifest,
	scope: string,
	spawn: () => { actor: Actor; dispose(): void }
): ActorFactory {
	const offer = installedOffer(manifest)
	return {
		offer,
		async assess(request) {
			if (
				request.principal.kind !== 'user' ||
				request.access.tenantId !== scope ||
				request.offerId !== offer.offerId ||
				Object.keys(request.configuration).length ||
				request.requestedCapabilities.some((c) => !offer.capabilityIds.includes(c))
			)
				return {
					admitted: false,
					decisionId: 'installed-runtime-denied',
					reasonCode: 'ACTOR_SCOPE_OR_CONFIGURATION_INVALID'
				}
			return {
				admitted: true,
				admissionId: request.requestId,
				expiresAt: new Date(Date.now() + 60_000).toISOString(),
				grantedCapabilities: request.requestedCapabilities,
				normalizedConfiguration: {}
			}
		},
		async spawn(request) {
			const instance = spawn()
			return {
				actor: instance.actor,
				advertisement: {
					instanceId: instance.actor.uuid,
					definitionRef: offer.definitionRef,
					label: offer.label,
					address: { kind: 'worker', value: 'actor-runner' },
					capabilityIds: request.requestedCapabilities,
					status: 'available',
					executionEnvironment: 'server'
				},
				release: () => instance.dispose()
			}
		}
	}
}

export function installedRegistry(
	installations: TrustedActorInstallations,
	offers: ActorFactoryOffer[]
): ActorRegistry {
	const registry = new ActorRegistry()
	for (const installation of installations.list())
		registry.registerDefinition(installation.definition)
	for (const offer of offers) registry.publishOffer(offer)
	return registry
}

export function installedAuthorizer(
	scope: string,
	installations: TrustedActorInstallations
): ActorAuthorizer {
	return {
		decide(request) {
			const installed = installations.get(request.definitionRef)
			return request.principal.kind === 'user' &&
				request.access.tenantId === scope &&
				installed &&
				(!request.capabilityId ||
					installed.descriptor.procedures.some((p) => p.capabilityId === request.capabilityId))
				? { allow: true, decisionId: `installed:${request.action}:${installed.digest}` }
				: {
						allow: false,
						decisionId: 'installed-denied',
						reasonCode: 'ACTOR_SCOPE_OR_INSTALLATION_INVALID'
					}
		}
	}
}

/** Bounded, scope-bound reads. The graph is used for lineage, never to substitute an input. */
export function compositionReader(store: StudioArtifacts): DocumentCompositionReader {
	const producers = new Map<
		string,
		Promise<{ runId: string; inputs: Array<{ artifactId: string; role: string }> }>
	>()
	const producer = (input: ActorStepInput) => {
		let result = producers.get(input.artifactId)
		if (!result) {
			result = (async () => {
				await store.get(input.artifactId)
				const response = studioObject(
					await store.client.producerInputs(store.scope, input.artifactId)
				)
				if (!response.producerRunId || !Array.isArray(response.inputs))
					throw Error('DOCUMENT_LINEAGE_UNAVAILABLE')
				return { runId: String(response.producerRunId), inputs: response.inputs }
			})()
			producers.set(input.artifactId, result)
		}
		return result
	}
	return {
		async content(input, maxBytes) {
			const envelope = studioObject(await store.client.artifact(store.scope, input.artifactId))
			if (
				envelope.scopeId !== store.scope ||
				envelope.artifactId !== input.artifactId ||
				!Number.isSafeInteger(envelope.blob?.length) ||
				envelope.blob.length < 0 ||
				envelope.blob.length > maxBytes
			)
				throw Error('ACTOR_INPUT_BLOB_LIMIT')
			const bytes = await store.client.content(store.scope, input.artifactId)
			if (bytes.length !== envelope.blob.length) throw Error('ACTOR_INPUT_BLOB_CHANGED')
			if (createHash('sha256').update(bytes).digest('hex') !== envelope.blob.sha256)
				throw Error('ACTOR_INPUT_BLOB_CHANGED')
			return bytes
		},
		producer,
		async ownedPages(input) {
			const queue = [input.artifactId],
				visited = new Set<string>(),
				pages = new Set<number>()
			while (queue.length) {
				const id = queue.shift()!
				if (visited.has(id)) continue
				if (visited.size >= 256) throw Error('DOCUMENT_LINEAGE_LIMIT')
				visited.add(id)
				const artifact = await store.get(id)
				if (artifact.typeKey === 'docs.page') {
					const page = artifact.payload.sourcePage
					if (
						typeof page !== 'number' ||
						!Number.isSafeInteger(page) ||
						page < 1 ||
						pages.has(page)
					)
						throw Error('DOCUMENT_CHUNK_PAGES_OVERLAP')
					pages.add(page)
					continue
				}
				const row = await producer({ ...input, artifactId: id })
				const owned = row.inputs.filter((i) => i.role === 'page' || i.role === 'candidate')
				if (!owned.length) throw Error('DOCUMENT_CHUNK_PAGE_LINEAGE_REQUIRED')
				queue.push(...owned.map((i) => i.artifactId))
			}
			if (!pages.size) throw Error('DOCUMENT_CHUNK_PAGE_LINEAGE_REQUIRED')
			return [...pages].sort((a, b) => a - b)
		},
		async assertSource(input, sourceId) {
			const queue = [input.artifactId],
				visited = new Set<string>()
			while (queue.length) {
				const id = queue.shift()!
				if (id === sourceId) return
				if (visited.has(id)) continue
				if (visited.size >= 256) throw Error('DOCUMENT_LINEAGE_LIMIT')
				visited.add(id)
				const row = await producer({ ...input, artifactId: id })
				queue.push(
					...row.inputs
						.filter((i) => !['activation', 'program'].includes(i.role))
						.map((i) => i.artifactId)
				)
			}
			throw Error('DOCUMENT_INPUT_SOURCE_MISMATCH')
		}
	}
}
