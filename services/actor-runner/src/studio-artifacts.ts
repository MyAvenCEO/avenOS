import { createHash, randomUUID } from 'node:crypto'
import { parseStudioDefinition, type StudioDefinition } from '@avenos/actors/studio'
import {
	type ArtifactJson,
	type ArtifactStoreClient,
	canonicalArtifactJson,
	clientRunIdentity
} from '@avenos/artifact-store'

export interface StudioArtifact {
	artifactId: string
	typeKey: string
	typeVersion: number
	payload: Record<string, unknown>
	scopeSequence: number
	publicationId: string
	committedAt: string
	producerRunId?: string | null
}
export interface StudioDraftArtifact {
	key: string
	type: string
	payload: unknown
	bytes?: Uint8Array
	references?: Array<{ role: string; id?: string; local?: string }>
}
export const studioIdentity = (scope: string, ...parts: unknown[]) =>
	clientRunIdentity(JSON.stringify(['studio-v1', scope, ...parts]))
export const studioPlanDigest = (program: unknown) =>
	createHash('sha256')
		.update(canonicalArtifactJson(program as ArtifactJson))
		.digest('hex')
export function studioObject(value: unknown): Record<string, any> {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new Error('Invalid Studio artifact response.')
	return value as Record<string, any>
}
export class StudioArtifacts {
	constructor(
		readonly client: ArtifactStoreClient,
		readonly scope: string
	) {}
	async context() {
		return studioObject(await this.client.context())
	}
	async get(id: string): Promise<StudioArtifact> {
		const envelope = studioObject(await this.client.artifact(this.scope, id))
		if (envelope.scopeId !== this.scope || envelope.artifactId !== id)
			throw new Error('Artifact scope mismatch.')
		return envelope as StudioArtifact
	}
	async library(ids: string[]): Promise<Map<string, StudioDefinition>> {
		const library = new Map<string, StudioDefinition>()
		const pending = [...ids]
		while (pending.length) {
			const id = pending.shift()!
			if (library.has(id)) continue
			if (library.size >= 64) throw new Error('The Skill dependency limit was reached.')
			const a = await this.get(id)
			if (a.typeKey !== 'studio.skill' || a.typeVersion !== 1)
				throw new Error('Expected an exact Skill artifact.')
			const definition = parseStudioDefinition(a.payload)
			library.set(id, definition)
			pending.push(...definition.steps.filter((s) => s.kind === 'skill').map((s) => s.ref!))
		}
		return library
	}
	async list(typeKey: string) {
		return studioObject(await this.client.queryArtifacts(this.scope, { typeKey, limit: 128 }))
	}
	async feed(epoch: string, after: number, limit = 20) {
		return studioObject(await this.client.feed(this.scope, epoch, after, limit))
	}
	async highWater(): Promise<{ epoch: string; sequence: number }> {
		const context = await this.context()
		// Query snapshots include the scope high-water mark even when the filter is empty.
		const page = studioObject(
			await this.client.queryArtifacts(this.scope, { typeKey: 'studio.source', limit: 1 })
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
		const pub = studioObject(studioObject(response).publication)
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
		artifacts: StudioDraftArtifact[]
		epoch?: string
	}): Promise<StudioArtifact[]> {
		const epoch = options.epoch ?? (await this.context()).storeEpoch
		const committed = options.artifacts.some((a) => a.bytes)
			? await this.client.publication(this.scope, options.id)
			: null
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
				// Claims are temporary byte authorities, not publication identities. A consumed
				// or expired claim must not prevent replay of the immutable publication.
				const claimId = randomUUID()
				blob = {
					sha256: createHash('sha256').update(a.bytes).digest('hex'),
					length: a.bytes.length
				}
				if (!committed)
					await this.client.upload(
						this.scope,
						claimId,
						{
							...blob,
							declaredMediaType: a.type === 'studio.email' ? 'message/rfc822' : 'text/plain'
						},
						a.bytes
					)
				blobAuthorities[a.key] = { kind: 'upload-claim', claimId }
			}
			const roles = new Map<string, number>()
			artifacts.push({
				localKey: a.key,
				typeKey: a.type,
				typeVersion: 1,
				payload: a.payload,
				blob,
				output: { role: 'result', ordinal },
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
		const response = studioObject(
			await this.client.publish(this.scope, options.id, epoch, {
				intent: {
					commandVersion: 1,
					publicationId: options.id,
					scopeId: this.scope,
					kind: 'run',
					run: {
						procedureKey: options.procedure,
						procedureVersion: '1',
						initiator: { kind: 'user', id: `user:${options.principal}` },
						executor: { kind: 'service', id: 'studio' },
						inputs,
						parameters: options.parameters,
						implementation: { adapter: 'studio-v1' },
						receipt: { outcome: 'succeeded' }
					},
					artifacts,
					evidence: []
				},
				blobAuthorities
			} as unknown as Parameters<ArtifactStoreClient['publish']>[3])
		)
		return Promise.all(
			(response.artifacts as Array<{ artifactId: string }>).map((a) => this.get(a.artifactId))
		)
	}
}
