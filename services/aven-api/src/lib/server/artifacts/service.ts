import { randomUUID } from 'node:crypto'
import {
	type ArtifactJson,
	ArtifactStoreClient,
	ArtifactStoreProblem
} from '@avenos/artifact-store'
import type { ArtifactStoreConfig } from '../config.js'
import { AppError } from '../errors.js'

export const MAX_ARTIFACT_FILE_BYTES = 100 * 1024 * 1024

export interface PublishFileInput {
	userId: string
	databaseName: string
	scopeId: string
	publicationId: string
	originalName: string
	mediaType: string
	sha256: string
	length: number
	body: BodyInit
}

export interface PublishedFile {
	publicationId: string
	artifactId: string
	originalName: string
	mediaType: string
	sha256: string
	length: number
	scopeSequence: number
	replayed: boolean
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

	async publishFile(input: PublishFileInput): Promise<PublishedFile> {
		try {
			const client = new ArtifactStoreClient({
				baseUrl: this.#baseUrl,
				bearerToken: () => this.#bearerToken,
				requestHeaders: () => ({ 'x-aven-artifact-database': input.databaseName }),
				fetch: this.#fetch
			})
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
						}
					],
					evidence: []
				},
				blobAuthorities: { file: { kind: 'upload-claim', claimId } }
			})
			const artifacts = record(publication, 'publication').artifacts
			if (!Array.isArray(artifacts) || artifacts.length !== 1) {
				throw new AppError(
					502,
					'ARTIFACT_STORE_INVALID_RESPONSE',
					'Artifact Store did not return exactly one file artifact.'
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
			return {
				publicationId: stringField(publication, 'publicationId', 'publication'),
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
