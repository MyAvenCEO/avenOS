import type { ArtifactStoreClient } from './client'

export interface StoredArtifact {
	artifactId: string
	scopeId: string
	artifactSha256: string
	typeKey: string
	typeVersion: number
	payload: Record<string, unknown>
	scopeSequence: number
	publicationId: string
	committedAt: string
	producerRunId?: string | null
}
export interface RunArtifactDraft {
	key: string
	type: string
	version?: number
	payload: unknown
	bytes?: Uint8Array
	mediaType?: string
	output?: { role: string; ordinal: number }
	references?: Array<{ role: string; id?: string; local?: string }>
}
export function artifactRecord(value: unknown): Record<string, any> {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new Error('Invalid artifact response.')
	return value as Record<string, any>
}
export class ArtifactRunStore {
	constructor(
		readonly client: ArtifactStoreClient,
		readonly scope: string
	) {}
	async context() {
		return artifactRecord(await this.client.context())
	}
	async get(id: string): Promise<StoredArtifact> {
		const envelope = artifactRecord(await this.client.artifact(this.scope, id))
		if (envelope.scopeId !== this.scope || envelope.artifactId !== id)
			throw new Error('Artifact scope mismatch.')
		return envelope as StoredArtifact
	}
	async list(typeKey: string) {
		return artifactRecord(await this.client.queryArtifacts(this.scope, { typeKey, limit: 128 }))
	}
	async feed(epoch: string, after: number, limit = 20) {
		return artifactRecord(await this.client.feed(this.scope, epoch, after, limit))
	}
	async highWater(): Promise<{ epoch: string; sequence: number }> {
		const context = await this.context()
		// Query snapshots include the scope high-water mark even when the filter is empty.
		const page = artifactRecord(
			await this.client.queryArtifacts(this.scope, { typeKey: 'core.file', limit: 1 })
		)
		if ((await this.context()).storeEpoch !== context.storeEpoch)
			throw new Error('The store changed during activation. Try again.')
		if (!Number.isSafeInteger(page.snapshotSequence) || page.snapshotSequence < 0)
			throw new Error('Invalid store checkpoint.')
		return { epoch: context.storeEpoch, sequence: page.snapshotSequence }
	}
	async lookup(publicationId: string) {
		const response = await this.client.publication(this.scope, publicationId)
		if (!response) return null
		const pub = artifactRecord(artifactRecord(response).publication)
		return Promise.all(
			(pub.artifacts as Array<{ artifactId: string }>).map((a) => this.get(a.artifactId))
		)
	}
	async publish(options: {
		id: string
		procedure: string
		principal: string
		inputs: Array<{ id: string; role: string }>
		parameters: unknown
		artifacts: RunArtifactDraft[]
		epoch?: string
		procedureVersion?: string
		executor?: { kind: 'service' | 'agent'; id: string }
		implementation?: unknown
		receipt?: unknown
		evidence?: unknown[]
		/** Recheck authority after staging bytes, immediately before commit. */
		beforeCommit?: () => Promise<void>
	}): Promise<StoredArtifact[]> {
		const epoch = options.epoch ?? (await this.context()).storeEpoch
		const counts = new Map<string, number>()
		const inputs = options.inputs.map(({ id, role }) => {
			const ordinal = counts.get(role) ?? 0
			counts.set(role, ordinal + 1)
			return { artifactId: id, role, ordinal }
		})
		const blobAuthorities: Record<string, unknown> = {}
		const artifacts = []
		for (const [ordinal, a] of options.artifacts.entries()) {
			let blob = null
			if (a.bytes) {
				blob = {
					sha256: Array.from(
						new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(a.bytes))),
						(byte) => byte.toString(16).padStart(2, '0')
					).join(''),
					length: a.bytes.length
				}
				const claimId = await this.client.stagePublicationBlob(
					this.scope,
					options.id,
					a.key,
					{
						...blob,
						declaredMediaType: a.mediaType ?? 'application/octet-stream'
					},
					Uint8Array.from(a.bytes).buffer
				)
				blobAuthorities[a.key] = { kind: 'upload-claim', claimId }
			}
			const roles = new Map<string, number>()
			artifacts.push({
				localKey: a.key,
				typeKey: a.type,
				typeVersion: a.version ?? 1,
				payload: a.payload,
				blob,
				output: a.output ?? { role: 'result', ordinal },
				references: (a.references ?? []).map((r) => {
					const index = roles.get(r.role) ?? 0
					roles.set(r.role, index + 1)
					return {
						role: r.role,
						ordinal: index,
						target: r.local
							? { kind: 'local', localKey: r.local }
							: { kind: 'existing', artifactId: r.id },
						attributes: {}
					}
				})
			})
		}
		await options.beforeCommit?.()
		const response = artifactRecord(
			await this.client.publish(this.scope, options.id, epoch, {
				intent: {
					commandVersion: 1,
					publicationId: options.id,
					scopeId: this.scope,
					kind: 'run',
					run: {
						procedureKey: options.procedure,
						procedureVersion: options.procedureVersion ?? '1',
						initiator: { kind: 'user', id: `user:${options.principal}` },
						executor: options.executor ?? { kind: 'service', id: 'actor-runner' },
						inputs,
						parameters: options.parameters,
						implementation: options.implementation ?? { adapter: 'artifact-run', version: 1 },
						receipt: options.receipt ?? { outcome: 'succeeded' }
					},
					artifacts,
					evidence: options.evidence ?? []
				},
				blobAuthorities
			} as unknown as Parameters<ArtifactStoreClient['publish']>[3])
		)
		return Promise.all(
			(response.artifacts as Array<{ artifactId: string }>).map((a) => this.get(a.artifactId))
		)
	}
}
