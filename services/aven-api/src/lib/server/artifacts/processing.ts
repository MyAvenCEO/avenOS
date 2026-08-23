import type { ArtifactProcessorConfig } from '../config.js'
import { AppError } from '../errors.js'

export class ArtifactProcessingService {
	readonly #baseUrl: string
	readonly #bearerToken: string
	readonly #fetch: typeof globalThis.fetch

	private constructor(
		baseUrl: string,
		bearerToken: string,
		fetch: typeof globalThis.fetch = globalThis.fetch
	) {
		this.#baseUrl = baseUrl.replace(/\/$/, '')
		this.#bearerToken = bearerToken
		this.#fetch = fetch
	}

	static fromConfig(
		config: ArtifactProcessorConfig,
		fetch?: typeof globalThis.fetch
	): ArtifactProcessingService | null {
		if (!config.ARTIFACT_PROCESSOR_BASE_URL || !config.ARTIFACT_PROCESSOR_BEARER_TOKEN) return null
		return new ArtifactProcessingService(
			config.ARTIFACT_PROCESSOR_BASE_URL,
			config.ARTIFACT_PROCESSOR_BEARER_TOKEN,
			fetch
		)
	}

	async status(databaseName: string, scopeId: string, artifactId: string): Promise<unknown> {
		let response: Response
		try {
			response = await this.#fetch(
				`${this.#baseUrl}/v1/scopes/${encodeURIComponent(scopeId)}/artifacts/${encodeURIComponent(artifactId)}/processing`,
				{
					headers: {
						authorization: `Bearer ${this.#bearerToken}`,
						'x-aven-artifact-database': databaseName
					}
				}
			)
		} catch {
			throw new AppError(
				502,
				'ARTIFACT_PROCESSOR_UNAVAILABLE',
				'Artifact processing status is unavailable.'
			)
		}
		if (response.status === 404) {
			throw new AppError(404, 'ARTIFACT_PROCESSING_NOT_FOUND', 'No processing case exists yet.')
		}
		if (!response.ok) {
			throw new AppError(
				502,
				'ARTIFACT_PROCESSOR_UNAVAILABLE',
				'Artifact processing status is unavailable.'
			)
		}
		try {
			return await response.json()
		} catch {
			throw new AppError(
				502,
				'ARTIFACT_PROCESSOR_INVALID_RESPONSE',
				'Artifact processor returned invalid status.'
			)
		}
	}
}
