import { createHash } from 'node:crypto'
import {
	type ArtifactJson,
	ArtifactRunStore,
	type ArtifactStoreClient,
	canonicalArtifactJson,
	clientRunIdentity
} from '@avenos/artifact-store'

export {
	artifactRecord as studioObject,
	type RunArtifactDraft as StudioDraftArtifact,
	type StoredArtifact as StudioArtifact
} from '@avenos/artifact-store'
export const studioIdentity = (scope: string, ...parts: unknown[]) =>
	clientRunIdentity(JSON.stringify(['studio-v2', scope, ...parts]))
export const studioPlanDigest = (program: unknown) =>
	createHash('sha256')
		.update(canonicalArtifactJson(program as ArtifactJson))
		.digest('hex')
export class StudioArtifacts extends ArtifactRunStore {
	constructor(client: ArtifactStoreClient, scope: string) {
		super(client, scope)
	}
	override publish(options: Parameters<ArtifactRunStore['publish']>[0]) {
		return super.publish({
			...options,
			executor: options.executor ?? { kind: 'service', id: 'studio' },
			implementation: options.implementation ?? { adapter: 'studio-v2', version: 2 },
			artifacts: options.artifacts.map((a) => ({
				...a,
				mediaType: a.mediaType ?? (a.type === 'studio.email' ? 'message/rfc822' : 'text/plain')
			}))
		})
	}
}
