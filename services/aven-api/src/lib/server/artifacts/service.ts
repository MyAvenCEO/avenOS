import { randomUUID } from 'node:crypto'
import {
	type ArtifactJson,
	ArtifactStoreClient,
	ArtifactStoreProblem
} from '@avenos/artifact-store'
import type { ArtifactStoreConfig } from '../config.js'
import { AppError } from '../errors.js'

export const MAX_ARTIFACT_FILE_BYTES = 25 * 1024 * 1024

export interface PublishFileInput {
	userId: string
	databaseName: string
	scopeId: string
	publicationId: string
	intentId: string
	observedAt: string
	originalName: string
	mediaType: string
	sha256: string
	length: number
	body: BodyInit
}

export interface PublishedFile {
	publicationId: string
	intentId: string
	intentDeclarationArtifactId: string
	artifactId: string
	originalName: string
	mediaType: string
	sha256: string
	length: number
	scopeSequence: number
	replayed: boolean
}

export interface BrowsedArtifact {
	artifactId: string
	localKey: string
	publicationOrdinal: number
	typeKey: string
	typeVersion: number
	artifactSha256: string
	producerRunId: string | null
	output: ArtifactJson
	publicationId: string
	scopeSequence: number
	publicationKind: string
	runId: string | null
	committedAt: string
}

export interface ArtifactBrowseResult {
	storeEpoch: string
	artifacts: BrowsedArtifact[]
	truncated: boolean
}

function record(value: ArtifactJson, label: string): { readonly [key: string]: ArtifactJson } {
	if (value === null || Array.isArray(value) || typeof value !== 'object') {
		throw new AppError(502, 'ARTIFACT_STORE_INVALID_RESPONSE', `${label} was not an object.`)
	}
	return value as { readonly [key: string]: ArtifactJson }
}

function stringField(value: ArtifactJson, key: string, label: string): string {
	const field = record(value, label)[key]
	if (typeof field !== 'string') {
		throw new AppError(502, 'ARTIFACT_STORE_INVALID_RESPONSE', `${label}.${key} was invalid.`)
	}
	return field
}

function numberField(value: ArtifactJson, key: string, label: string): number {
	const field = record(value, label)[key]
	if (typeof field !== 'number') {
		throw new AppError(502, 'ARTIFACT_STORE_INVALID_RESPONSE', `${label}.${key} was invalid.`)
	}
	return field
}

function booleanField(value: ArtifactJson, key: string, label: string): boolean {
	const field = record(value, label)[key]
	if (typeof field !== 'boolean') {
		throw new AppError(502, 'ARTIFACT_STORE_INVALID_RESPONSE', `${label}.${key} was invalid.`)
	}
	return field
}

export class ArtifactFileService {
	readonly #baseUrl: string
	readonly #bearerToken: string
	readonly #fetch?: typeof globalThis.fetch

	private constructor(baseUrl: string, bearerToken: string, fetch?: typeof globalThis.fetch) {
		this.#baseUrl = baseUrl
		this.#bearerToken = bearerToken
		this.#fetch = fetch
	}

	static fromConfig(
		config: ArtifactStoreConfig,
		fetch?: typeof globalThis.fetch
	): ArtifactFileService | null {
		if (!config.ARTIFACT_STORE_BASE_URL || !config.ARTIFACT_STORE_BEARER_TOKEN) {
			return null
		}
		return new ArtifactFileService(
			config.ARTIFACT_STORE_BASE_URL,
			config.ARTIFACT_STORE_BEARER_TOKEN,
			fetch
		)
	}

	#client(databaseName: string): ArtifactStoreClient {
		return new ArtifactStoreClient({
			baseUrl: this.#baseUrl,
			bearerToken: () => this.#bearerToken,
			requestHeaders: () => ({ 'x-aven-artifact-database': databaseName }),
			fetch: this.#fetch
		})
	}

	async artifact(databaseName: string, scopeId: string, artifactId: string): Promise<ArtifactJson> {
		return this.#client(databaseName).artifact(scopeId, artifactId)
	}

	async content(databaseName: string, scopeId: string, artifactId: string): Promise<Uint8Array> {
		return this.#client(databaseName).content(scopeId, artifactId)
	}

	/**
	 * Debug-oriented scope browser. The store feed is forward-only, so walk it
	 * in large pages and retain a bounded tail of the newest artifacts.
	 */
	async browse(databaseName: string, scopeId: string): Promise<ArtifactBrowseResult> {
		try {
			return await this.#browse(databaseName, scopeId)
		} catch (error) {
			if (error instanceof AppError) throw error
			if (error instanceof ArtifactStoreProblem) {
				throw new AppError(502, error.code, error.message)
			}
			throw new AppError(502, 'ARTIFACT_STORE_UNAVAILABLE', 'Artifact Store is unavailable.')
		}
	}

	async #browse(databaseName: string, scopeId: string): Promise<ArtifactBrowseResult> {
		const client = this.#client(databaseName)
		const context = record(await client.context(), 'context')
		const storeEpoch = stringField(context, 'storeEpoch', 'context')
		const artifacts: BrowsedArtifact[] = []
		let afterSequence = 0
		let publicationsRead = 0
		let truncated = false
		const pageLimit = 1_000
		const maximumPublications = 10_000
		const maximumArtifacts = 2_000

		while (publicationsRead < maximumPublications) {
			const page = record(
				await client.feed(scopeId, storeEpoch, afterSequence, pageLimit),
				'publication feed'
			)
			const items = page.items
			if (!Array.isArray(items)) {
				throw new AppError(
					502,
					'ARTIFACT_STORE_INVALID_RESPONSE',
					'Artifact Store publication feed was invalid.'
				)
			}
			for (const itemValue of items) {
				const item = record(itemValue, 'publication')
				const published = item.artifacts
				if (!Array.isArray(published)) continue
				for (const artifactValue of published) {
					const artifact = record(artifactValue, 'feed artifact')
					artifacts.push({
						artifactId: stringField(artifact, 'artifactId', 'feed artifact'),
						localKey: stringField(artifact, 'localKey', 'feed artifact'),
						publicationOrdinal: numberField(artifact, 'publicationOrdinal', 'feed artifact'),
						typeKey: stringField(artifact, 'typeKey', 'feed artifact'),
						typeVersion: numberField(artifact, 'typeVersion', 'feed artifact'),
						artifactSha256: stringField(artifact, 'artifactSha256', 'feed artifact'),
						producerRunId:
							typeof artifact.producerRunId === 'string' ? artifact.producerRunId : null,
						output: artifact.output ?? null,
						publicationId: stringField(item, 'publicationId', 'publication'),
						scopeSequence: numberField(item, 'scopeSequence', 'publication'),
						publicationKind: stringField(item, 'kind', 'publication'),
						runId: typeof item.runId === 'string' ? item.runId : null,
						committedAt: stringField(item, 'committedAt', 'publication')
					})
				}
			}
			if (artifacts.length > maximumArtifacts) {
				artifacts.splice(0, artifacts.length - maximumArtifacts)
			}
			publicationsRead += items.length
			const next = page.nextAfterSequence
			if (typeof next !== 'number' || next <= afterSequence || items.length === 0) break
			afterSequence = next
			if (publicationsRead >= maximumPublications) truncated = true
		}

		return { storeEpoch, artifacts: artifacts.reverse(), truncated }
	}

	async publishFile(input: PublishFileInput): Promise<PublishedFile> {
		try {
			const client = this.#client(input.databaseName)
			const context = await client.context()
			const storeEpoch = stringField(context, 'storeEpoch', 'context')
			const claimId = randomUUID()
			const upload = await client.uploadBody(
				input.scopeId,
				claimId,
				{
					sha256: input.sha256,
					length: input.length,
					declaredMediaType: input.mediaType
				},
				input.body
			)
			if (
				stringField(upload, 'sha256', 'upload') !== input.sha256 ||
				numberField(upload, 'length', 'upload') !== input.length
			) {
				throw new AppError(
					502,
					'ARTIFACT_STORE_INVALID_RESPONSE',
					'Artifact Store confirmed different upload bytes.'
				)
			}

			const publication = await client.publish(input.scopeId, input.publicationId, storeEpoch, {
				intent: {
					commandVersion: 1,
					publicationId: input.publicationId,
					scopeId: input.scopeId,
					kind: 'roots',
					rootActor: { kind: 'user', id: `user:${input.userId}` },
					artifacts: [
						{
							localKey: 'file',
							typeKey: 'core.file',
							typeVersion: 1,
							payload: {
								originalName: input.originalName,
								declaredMediaType: input.mediaType,
								sourceKind: 'desktop-drop'
							},
							blob: { sha256: input.sha256, length: input.length },
							references: [],
							output: null
						},
						{
							localKey: 'intent',
							typeKey: 'intent.declaration',
							typeVersion: 1,
							payload: {
								intentId: input.intentId,
								title: input.originalName,
								triggerKind: 'file-upload',
								observedAt: input.observedAt
							},
							blob: null,
							references: [],
							output: null
						}
					],
					evidence: []
				},
				blobAuthorities: { file: { kind: 'upload-claim', claimId } }
			})
			const artifacts = record(publication, 'publication').artifacts
			if (!Array.isArray(artifacts) || artifacts.length !== 2) {
				throw new AppError(
					502,
					'ARTIFACT_STORE_INVALID_RESPONSE',
					'Artifact Store did not return the file and intent declaration.'
				)
			}
			const artifact = artifacts[0] as ArtifactJson
			if (stringField(artifact, 'localKey', 'artifact') !== 'file') {
				throw new AppError(
					502,
					'ARTIFACT_STORE_INVALID_RESPONSE',
					'Artifact Store returned an unexpected local key.'
				)
			}
			const intentArtifact = artifacts[1] as ArtifactJson
			if (stringField(intentArtifact, 'localKey', 'intentArtifact') !== 'intent') {
				throw new AppError(
					502,
					'ARTIFACT_STORE_INVALID_RESPONSE',
					'Artifact Store returned an unexpected intent local key.'
				)
			}
			return {
				publicationId: stringField(publication, 'publicationId', 'publication'),
				intentId: input.intentId,
				intentDeclarationArtifactId: stringField(intentArtifact, 'artifactId', 'intentArtifact'),
				artifactId: stringField(artifact, 'artifactId', 'artifact'),
				originalName: input.originalName,
				mediaType: input.mediaType,
				sha256: input.sha256,
				length: input.length,
				scopeSequence: numberField(publication, 'scopeSequence', 'publication'),
				replayed: booleanField(publication, 'replayed', 'publication')
			}
		} catch (error) {
			if (error instanceof AppError) throw error
			if (error instanceof ArtifactStoreProblem) {
				const status = error.status === 409 ? 409 : error.status === 413 ? 413 : 502
				throw new AppError(status, error.code, error.message)
			}
			throw new AppError(502, 'ARTIFACT_STORE_UNAVAILABLE', 'Artifact Store is unavailable.')
		}
	}
}
