import { type ArtifactJson, canonicalArtifactJson, parseArtifactJson } from './canonical'

export interface ArtifactStoreClientOptions {
	readonly baseUrl: string
	readonly bearerToken: () => string | Promise<string>
	readonly requestHeaders?: () => HeadersInit | Promise<HeadersInit>
	readonly fetch?: typeof globalThis.fetch
}

export interface UploadDeclaration {
	readonly sha256: string
	readonly length: number
	readonly declaredMediaType: string
}

export interface PublicationSubmission {
	readonly intent: ArtifactJson
	readonly blobAuthorities: ArtifactJson
}

export class ArtifactStoreProblem extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string
	) {
		super(message)
	}
}

export class ArtifactStoreClient {
	readonly #baseUrl: string
	readonly #bearerToken: ArtifactStoreClientOptions['bearerToken']
	readonly #requestHeaders?: ArtifactStoreClientOptions['requestHeaders']
	readonly #fetch: typeof globalThis.fetch

	constructor(options: ArtifactStoreClientOptions) {
		this.#baseUrl = options.baseUrl.replace(/\/$/, '')
		this.#bearerToken = options.bearerToken
		this.#requestHeaders = options.requestHeaders
		this.#fetch = options.fetch ?? globalThis.fetch
	}

	context(): Promise<ArtifactJson> {
		return this.#json('/v1/context')
	}

	type(typeKey: string, version: number): Promise<ArtifactJson> {
		return this.#json(`/v1/types/${encodeURIComponent(typeKey)}/versions/${version}`)
	}

	async upload(
		scopeId: string,
		claimId: string,
		declaration: UploadDeclaration,
		bytes: Uint8Array
	): Promise<ArtifactJson> {
		return this.uploadBody(scopeId, claimId, declaration, Uint8Array.from(bytes).buffer)
	}

	/**
	 * Stream a declared blob without forcing an application proxy to buffer a
	 * second complete copy. The store remains authoritative for hash and length
	 * verification.
	 */
	async uploadBody(
		scopeId: string,
		claimId: string,
		declaration: UploadDeclaration,
		body: BodyInit
	): Promise<ArtifactJson> {
		return this.#json(`/v1/scopes/${scopeId}/uploads/${claimId}`, {
			method: 'PUT',
			headers: {
				'content-type': declaration.declaredMediaType,
				'content-length': String(declaration.length),
				'x-expected-sha256': declaration.sha256
			},
			body
		})
	}

	publish(
		scopeId: string,
		publicationId: string,
		storeEpoch: string,
		submission: PublicationSubmission
	): Promise<ArtifactJson> {
		return this.#json(`/v1/scopes/${scopeId}/publications/${publicationId}`, {
			method: 'PUT',
			headers: {
				'content-type': 'application/json',
				'if-artifact-store-epoch': storeEpoch
			},
			body: Uint8Array.from(canonicalArtifactJson(submission as unknown as ArtifactJson)).buffer
		})
	}

	artifact(scopeId: string, artifactId: string): Promise<ArtifactJson> {
		return this.#json(`/v1/scopes/${scopeId}/artifacts/${artifactId}`)
	}

	producerInputs(scopeId: string, artifactId: string): Promise<ArtifactJson> {
		return this.#json(`/v1/scopes/${scopeId}/artifacts/${artifactId}/producer-inputs`)
	}

	supportingEvidence(scopeId: string, artifactId: string): Promise<ArtifactJson> {
		return this.#json(`/v1/scopes/${scopeId}/artifacts/${artifactId}/supporting-evidence`)
	}

	async content(scopeId: string, artifactId: string): Promise<Uint8Array> {
		const response = await this.#request(`/v1/scopes/${scopeId}/artifacts/${artifactId}/content`)
		return new Uint8Array(await response.arrayBuffer())
	}

	feed(scopeId: string, storeEpoch: string, afterSequence = 0, limit = 100): Promise<ArtifactJson> {
		const query = new URLSearchParams({
			storeEpoch,
			afterSequence: String(afterSequence),
			limit: String(limit)
		})
		return this.#json(`/v1/scopes/${scopeId}/publications?${query}`)
	}

	async #json(path: string, init?: RequestInit): Promise<ArtifactJson> {
		const response = await this.#request(path, init)
		return parseArtifactJson(new Uint8Array(await response.arrayBuffer()), true)
	}

	async #request(path: string, init: RequestInit = {}): Promise<Response> {
		const token = await this.#bearerToken()
		const headers = new Headers(await this.#requestHeaders?.())
		for (const [name, value] of new Headers(init.headers)) headers.set(name, value)
		headers.set('authorization', `Bearer ${token}`)
		const requestInit: RequestInit & { duplex?: 'half' } = { ...init, headers }
		if (init.body instanceof ReadableStream) requestInit.duplex = 'half'
		const response = await this.#fetch(`${this.#baseUrl}${path}`, requestInit)
		if (response.ok) return response
		let code = 'UNKNOWN'
		let detail = `Artifact Store request failed with HTTP ${response.status}`
		try {
			const problem = (await response.json()) as { code?: string; detail?: string }
			code = problem.code ?? code
			detail = problem.detail ?? detail
		} catch {
			// The status and generic detail remain safe when a proxy returned non-JSON.
		}
		throw new ArtifactStoreProblem(response.status, code, detail)
	}
}
