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
		return this.#json(
			databaseName,
			scopeId,
			`/artifacts/${encodeURIComponent(artifactId)}/processing`
		)
	}

	async intents(databaseName: string, scopeId: string): Promise<unknown> {
		return this.#json(databaseName, scopeId, '/intents')
	}

	async intent(databaseName: string, scopeId: string, intentId: string): Promise<unknown> {
		return this.#json(databaseName, scopeId, `/intents/${encodeURIComponent(intentId)}`)
	}

	async appendContribution(
		databaseName: string,
		scopeId: string,
		intentId: string,
		body: unknown
	): Promise<unknown> {
		return this.#json(databaseName, scopeId, `/intents/${encodeURIComponent(intentId)}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		})
	}

	async #json(
		databaseName: string,
		scopeId: string,
		path: string,
		init: RequestInit = {}
	): Promise<unknown> {
		let response: Response
		try {
			response = await this.#fetch(
				`${this.#baseUrl}/v1/scopes/${encodeURIComponent(scopeId)}${path}`,
				{
					...init,
					headers: {
						...init.headers,
						authorization: `Bearer ${this.#bearerToken}`,
						'x-aven-artifact-database': databaseName
					}
				}
			)
		} catch {
			throw new AppError(
				502,
				'ARTIFACT_PROCESSOR_UNAVAILABLE',
				'Artifact processing or intent state is unavailable.'
			)
		}
		if (response.status === 404) {
			throw new AppError(
				404,
				'ARTIFACT_PROCESSING_NOT_FOUND',
				'The requested projection does not exist yet.'
			)
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
