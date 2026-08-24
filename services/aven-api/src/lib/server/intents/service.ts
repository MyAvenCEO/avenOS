import type { IntentServiceConfig } from '../config.js'
import { AppError } from '../errors.js'

export class IntentService {
	readonly #baseUrl: string
	readonly #bearerToken: string
	readonly #fetch: typeof globalThis.fetch

	private constructor(baseUrl: string, bearerToken: string, fetch: typeof globalThis.fetch) {
		this.#baseUrl = baseUrl.replace(/\/$/, '')
		this.#bearerToken = bearerToken
		this.#fetch = fetch
	}

	static fromConfig(config: IntentServiceConfig, fetch = globalThis.fetch): IntentService | null {
		if (!config.INTENT_SERVICE_BASE_URL || !config.INTENT_SERVICE_BEARER_TOKEN) return null
		return new IntentService(
			config.INTENT_SERVICE_BASE_URL,
			config.INTENT_SERVICE_BEARER_TOKEN,
			fetch
		)
	}

	list(databaseName: string, scopeId: string) {
		return this.#json(databaseName, scopeId, '/intents')
	}

	detail(databaseName: string, scopeId: string, intentId: string) {
		return this.#json(databaseName, scopeId, `/intents/${encodeURIComponent(intentId)}`)
	}

	create(databaseName: string, scopeId: string, body: unknown) {
		return this.#json(databaseName, scopeId, '/intents', bodyInit('POST', body))
	}

	update(databaseName: string, scopeId: string, intentId: string, body: unknown) {
		return this.#json(
			databaseName,
			scopeId,
			`/intents/${encodeURIComponent(intentId)}`,
			bodyInit('PATCH', body)
		)
	}

	contribute(databaseName: string, scopeId: string, intentId: string, body: unknown) {
		return this.#json(
			databaseName,
			scopeId,
			`/intents/${encodeURIComponent(intentId)}/contributions`,
			bodyInit('POST', body)
		)
	}

	lifecycle(
		databaseName: string,
		scopeId: string,
		intentId: string,
		action: 'archive' | 'restore' | 'merge',
		body: unknown
	) {
		return this.#json(
			databaseName,
			scopeId,
			`/intents/${encodeURIComponent(intentId)}/${action}`,
			bodyInit('POST', body)
		)
	}

	delete(databaseName: string, scopeId: string, intentId: string, body: unknown) {
		return this.#json(
			databaseName,
			scopeId,
			`/intents/${encodeURIComponent(intentId)}`,
			bodyInit('DELETE', body),
			true
		)
	}

	async #json(
		databaseName: string,
		scopeId: string,
		path: string,
		init: RequestInit = {},
		allowEmpty = false
	): Promise<unknown> {
		let response: Response
		try {
			response = await this.#fetch(
				`${this.#baseUrl}/v1/scopes/${encodeURIComponent(scopeId)}${path}`,
				{
					...init,
					signal: init.signal ?? AbortSignal.timeout(15_000),
					headers: {
						...init.headers,
						authorization: `Bearer ${this.#bearerToken}`,
						'x-aven-artifact-database': databaseName
					}
				}
			)
		} catch {
			throw new AppError(502, 'INTENT_SERVICE_UNAVAILABLE', 'Intent state is unavailable.')
		}
		if (response.status === 404)
			throw new AppError(404, 'INTENT_NOT_FOUND', 'The requested intent does not exist.')
		if (response.status === 409)
			throw new AppError(
				409,
				'INTENT_VERSION_CONFLICT',
				'The intent changed or the transition is invalid.'
			)
		if (response.status === 400 || response.status === 422)
			throw new AppError(400, 'INTENT_INPUT_INVALID', 'The intent request is invalid.')
		if (!response.ok)
			throw new AppError(502, 'INTENT_SERVICE_UNAVAILABLE', 'Intent state is unavailable.')
		if (allowEmpty && response.status === 204) return null
		try {
			return await response.json()
		} catch {
			throw new AppError(
				502,
				'INTENT_SERVICE_INVALID_RESPONSE',
				'Intent Service returned invalid data.'
			)
		}
	}
}

function bodyInit(method: string, body: unknown): RequestInit {
	return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}
