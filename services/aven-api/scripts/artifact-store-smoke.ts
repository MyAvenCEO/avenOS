const scopeId = process.env.ARTIFACT_STORE_SCOPE_ID ?? '11111111-1111-4111-8111-111111111111'
const bearerToken = process.env.ARTIFACT_STORE_BEARER_TOKEN ?? 'artifact-local-dev-token'
const baseUrl = (
	process.env.ARTIFACT_STORE_BASE_URL ??
	`http://127.0.0.1:${process.env.ARTIFACT_STORE_PORT ?? '8087'}`
).replace(/\/$/, '')

const authorization = `Bearer ${bearerToken}`

async function request(path: string, init: RequestInit = {}): Promise<Response> {
	const headers = new Headers(init.headers)
	headers.set('authorization', authorization)
	const response = await fetch(`${baseUrl}${path}`, { ...init, headers })
	if (response.ok) return response

	const detail = await response.text()
	throw new Error(`${init.method ?? 'GET'} ${path} failed (${response.status}): ${detail}`)
}

async function json(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
	return (await (await request(path, init)).json()) as Record<string, unknown>
}

function requiredString(record: Record<string, unknown>, key: string): string {
	const value = record[key]
	if (typeof value !== 'string') throw new Error(`Response field ${key} is not a string`)
	return value
}

function requiredNumber(record: Record<string, unknown>, key: string): number {
	const value = record[key]
	if (typeof value !== 'number') throw new Error(`Response field ${key} is not a number`)
	return value
}

const context = await json('/v1/context')
const storeEpoch = requiredString(context, 'storeEpoch')
const claimId = crypto.randomUUID()
const publicationId = crypto.randomUUID()
const bytes = new TextEncoder().encode(`aven-api compose smoke ${publicationId}\n`)
const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
	.map((byte) => byte.toString(16).padStart(2, '0'))
	.join('')

await json(`/v1/scopes/${scopeId}/uploads/${claimId}`, {
	method: 'PUT',
	headers: {
		'content-length': String(bytes.byteLength),
		'content-type': 'text/plain',
		'x-expected-sha256': sha256
	},
	body: bytes
})

const publication = await json(`/v1/scopes/${scopeId}/publications/${publicationId}`, {
	method: 'PUT',
	headers: {
		'content-type': 'application/json',
		'if-artifact-store-epoch': storeEpoch
	},
	body: JSON.stringify({
		intent: {
			commandVersion: 1,
			publicationId,
			scopeId,
			kind: 'roots',
			rootActor: { kind: 'service', id: 'service:aven-api-local-smoke' },
			artifacts: [
				{
					localKey: 'file',
					typeKey: 'core.file',
					typeVersion: 1,
					payload: {
						originalName: 'compose-smoke.txt',
						declaredMediaType: 'text/plain',
						sourceKind: 'compose-smoke'
					},
					blob: { sha256, length: bytes.byteLength },
					references: [],
					output: null
				}
			],
			evidence: []
		},
		blobAuthorities: {
			file: { kind: 'upload-claim', claimId }
		}
	})
})

const artifacts = publication.artifacts
if (!Array.isArray(artifacts) || artifacts.length !== 1) {
	throw new Error('Publication did not return exactly one artifact')
}
const artifact = artifacts[0] as Record<string, unknown>
const artifactId = requiredString(artifact, 'artifactId')
const scopeSequence = requiredNumber(publication, 'scopeSequence')

const envelope = await json(`/v1/scopes/${scopeId}/artifacts/${artifactId}`)
if (requiredString(envelope, 'artifactId') !== artifactId) {
	throw new Error('Artifact lookup returned a different artifact')
}

const downloaded = new Uint8Array(
	await (await request(`/v1/scopes/${scopeId}/artifacts/${artifactId}/content`)).arrayBuffer()
)
if (
	!bytes.every((byte, index) => downloaded[index] === byte) ||
	downloaded.length !== bytes.length
) {
	throw new Error('Downloaded bytes do not match the uploaded bytes')
}

const feedQuery = new URLSearchParams({
	storeEpoch,
	afterSequence: String(scopeSequence - 1),
	limit: '10'
})
const feed = await json(`/v1/scopes/${scopeId}/publications?${feedQuery}`)
const items = feed.items
if (
	!Array.isArray(items) ||
	!items.some(
		(item) =>
			typeof item === 'object' &&
			item !== null &&
			(item as Record<string, unknown>).publicationId === publicationId
	)
) {
	throw new Error('Publication is missing from the replay feed')
}

console.log(
	JSON.stringify(
		{
			status: 'ok',
			baseUrl,
			scopeId,
			storeEpoch,
			publicationId,
			artifactId,
			scopeSequence,
			bytes: bytes.byteLength
		},
		null,
		2
	)
)
