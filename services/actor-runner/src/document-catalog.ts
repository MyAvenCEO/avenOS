import {
	ActorRegistry,
	type ActorAuthorizer,
	type PlanRunSecurityContext,
	type TrustedActorInstallations
} from '@avenos/actors'
import { DOCUMENT_ACTOR_MANIFESTS } from '@avenos/document-ingest/actors/registry'
import type { StudioCatalogSource } from './studio-service.js'

/**
 * Release-owned, read-only document inventory. No factory, projector, Store
 * publisher, or credential use is installed through this projection.
 */
export function createDocumentCatalogSource(
	scopeId: string,
	installations?: TrustedActorInstallations
): StudioCatalogSource {
	const registry = new ActorRegistry()
	for (const manifest of DOCUMENT_ACTOR_MANIFESTS) registry.registerManifest(manifest)
	for (const installation of installations?.list() ?? [])
		registry.registerDefinition(installation.definition)
	const permitted = new Set<string>(registry.snapshot().definitions.map((definition) => definition.ref))
	return {
		registry: () => registry.snapshot(),
		authorizer: (security: PlanRunSecurityContext): ActorAuthorizer => ({
			decide: (request) => {
				const visible = security.principal.kind === 'user' &&
					request.principal.kind === 'user' &&
					security.principal.subjectId === request.principal.subjectId &&
					security.principal.sessionId === request.principal.sessionId &&
					security.access.tenantId === scopeId && request.access.tenantId === scopeId &&
					permitted.has(request.definitionRef) && request.action === 'discover'
				return visible
					? { allow: true as const, decisionId: 'document-contract-discover' }
					: { allow: false as const, decisionId: 'document-contract-deny',
						reasonCode: 'DOCUMENT_EXECUTION_UNAVAILABLE' }
			}
		}),
		installationFor: (actorId) => installations?.get(actorId),
		runtimeSupports: (actorId, capabilityId) =>
			!!installations
				?.get(actorId)
				?.descriptor.procedures.some((procedure) => procedure.capabilityId === capabilityId)
	}
}
