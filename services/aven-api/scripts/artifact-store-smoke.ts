const scopeId = process.env.ARTIFACT_STORE_SCOPE_ID ?? '11111111-1111-4111-8111-111111111111'
const databaseName = process.env.ARTIFACT_STORE_DATABASE_NAME ?? 'cust_artifact_local'
const bearerToken =
	process.env.ARTIFACT_STORE_BEARER_TOKEN ?? 'artifact-local-coordinator-token-0001'
const baseUrl = (
	process.env.ARTIFACT_STORE_BASE_URL ??
	`http://127.0.0.1:${process.env.ARTIFACT_STORE_PORT ?? '8087'}`
).replace(/\/$/, '')

const authorization = `Bearer ${bearerToken}`
const wrongScopeId = '99999999-9999-4999-8999-999999999999'

async function request(path: string, init: RequestInit = {}): Promise<Response> {
	const headers = new Headers(init.headers)
	headers.set('authorization', authorization)
	headers.set('x-aven-artifact-database', databaseName)
	const response = await fetch(`${baseUrl}${path}`, { ...init, headers })
	if (response.ok) return response

	const detail = await response.text()
	throw new Error(`${init.method ?? 'GET'} ${path} failed (${response.status}): ${detail}`)
}

async function json(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
	return (await (await request(path, init)).json()) as Record<string, unknown>
}

async function expectRejected(path: string, database: string): Promise<void> {
	const response = await fetch(`${baseUrl}${path}`, {
		headers: {
			authorization,
			'x-aven-artifact-database': database
		}
	})
	if (response.ok) throw new Error(`Expected ${path} with database ${database} to fail closed`)
	await response.body?.cancel()
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

const publicationBody = JSON.stringify({
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
const publicationInit = {
	method: 'PUT',
	headers: {
		'content-type': 'application/json',
		'if-artifact-store-epoch': storeEpoch
	},
	body: publicationBody
} satisfies RequestInit
const publication = await json(
	`/v1/scopes/${scopeId}/publications/${publicationId}`,
	publicationInit
)
const replay = await json(`/v1/scopes/${scopeId}/publications/${publicationId}`, publicationInit)
if (replay.replayed !== true || replay.scopeSequence !== publication.scopeSequence) {
	throw new Error('Idempotent publication replay returned a different result')
}

await expectRejected('/v1/context', 'not_a_customer_database')
await expectRejected('/v1/context', 'cust_missing_for_smoke')
await expectRejected(
	`/v1/scopes/${wrongScopeId}/publications?storeEpoch=${storeEpoch}&afterSequence=0&limit=1`,
	databaseName
)

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
			databaseName,
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
