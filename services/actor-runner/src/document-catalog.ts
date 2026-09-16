import {
	type ActorAuthorizer,
	ActorRegistry,
	type PlanRunSecurityContext,
	type TrustedActorInstallations
} from '@avenos/actors'
import { DOCUMENT_ACTOR_MANIFESTS } from '@avenos/document-ingest/actors/registry'
import { createStudioRuntimeAuthorizer, studioRuntimeOffer } from './studio-runtime.js'
import type { StudioCatalogSource } from './studio-service.js'

/**
 * Release-owned document inventory plus the actually installed Studio runtime offer.
 * Manifest-only document methods stay discoverable but cannot be planned or invoked.
 */
export function createDocumentCatalogSource(
	scopeId: string,
	installations?: TrustedActorInstallations
): StudioCatalogSource {
	const registry = new ActorRegistry()
	for (const manifest of DOCUMENT_ACTOR_MANIFESTS) registry.registerManifest(manifest)
	for (const installation of installations?.list() ?? [])
		registry.registerDefinition(installation.definition)
	const installedOffer = studioRuntimeOffer()
	const runnable = !!installations
		?.get(installedOffer.definitionRef)
		?.descriptor.procedures.some((procedure) =>
			installedOffer.capabilityIds.includes(procedure.capabilityId)
		)
	if (runnable) registry.publishOffer(installedOffer)
	const permitted = new Set<string>(
		registry.snapshot().definitions.map((definition) => definition.ref)
	)
	return {
		registry: () => registry.snapshot(),
		authorizer: (security: PlanRunSecurityContext): ActorAuthorizer => ({
			decide: (request) => {
				const scoped =
					security.principal.kind === 'user' &&
					request.principal.kind === 'user' &&
					security.principal.subjectId === request.principal.subjectId &&
					security.principal.sessionId === request.principal.sessionId &&
					security.access.tenantId === scopeId &&
					request.access.tenantId === scopeId &&
					permitted.has(request.definitionRef)
				if (scoped && runnable && request.definitionRef === installedOffer.definitionRef)
					return createStudioRuntimeAuthorizer(scopeId).decide(request)
				return scoped && request.action === 'discover'
					? { allow: true as const, decisionId: 'document-contract-discover' }
					: {
							allow: false as const,
							decisionId: 'document-contract-deny',
							reasonCode: 'DOCUMENT_EXECUTION_UNAVAILABLE'
						}
			}
		}),
		installationFor: (actorId) => installations?.get(actorId),
		runtimeSupports: (actorId, capabilityId) =>
			runnable &&
			actorId === installedOffer.definitionRef &&
			installedOffer.capabilityIds.some((id) => id === capabilityId)
	}
}
