import {
	type ActorFactoryOffer,
	ActorRegistry,
	type TrustedActorInstallations
} from '@avenos/actors'
import { DOCUMENT_ACTOR_MANIFESTS } from '@avenos/document-ingest/actors/registry'
import { installedAuthorizer } from './installed-runtime'
import { studioRuntimeOffer } from './studio-runtime'
import type { StudioCatalogSource } from './studio-service'

/** Inventory and executable offers are separate; only installed factories authorize execution. */
export function createDocumentCatalogSource(
	scopeId: string,
	installations?: TrustedActorInstallations,
	offers: ActorFactoryOffer[] = [studioRuntimeOffer()]
): StudioCatalogSource {
	const registry = new ActorRegistry()
	for (const manifest of DOCUMENT_ACTOR_MANIFESTS) registry.registerManifest(manifest)
	for (const installation of installations?.list() ?? [])
		registry.registerDefinition(installation.definition)
	const installedOffers = offers.filter((offer) => installations?.get(offer.definitionRef))
	for (const offer of installedOffers) registry.publishOffer(offer)
	const visible = new Set<string>(registry.snapshot().definitions.map((d) => d.ref))
	return {
		registry: () => registry.snapshot(),
		authorizer: (security) => ({
			decide(request) {
				const scoped =
					security.principal.kind === 'user' &&
					request.principal.kind === 'user' &&
					security.principal.subjectId === request.principal.subjectId &&
					security.principal.sessionId === request.principal.sessionId &&
					security.access.tenantId === scopeId &&
					request.access.tenantId === scopeId &&
					visible.has(request.definitionRef)
				if (
					scoped &&
					installations &&
					installedOffers.some((o) => o.definitionRef === request.definitionRef)
				)
					return installedAuthorizer(scopeId, installations).decide(request)
				return scoped && request.action === 'discover'
					? { allow: true, decisionId: 'document-contract-discover' }
					: {
							allow: false,
							decisionId: 'document-contract-deny',
							reasonCode: 'DOCUMENT_EXECUTION_UNAVAILABLE'
						}
			}
		}),
		installationFor: (actorId) => installations?.get(actorId),
		runtimeSupports: (actorId, capabilityId) =>
			installedOffers.some(
				(o) => o.definitionRef === actorId && o.capabilityIds.some((id) => id === capabilityId)
			)
	}
}
