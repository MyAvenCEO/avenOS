import type { TenantGrantClaims } from '@avenos/aven-customer-contracts'
import type { IdentityClaims } from '@avenos/aven-identity'
import { expect, test } from 'vitest'
import { ArtifactHandler } from '../src/artifacts/handler'
import { ArtifactFileService } from '../src/lib/server/artifacts/service'

const scope = '11111111-1111-4111-8111-111111111111'
const tenant = { databaseName: 'cust_library', environmentId: scope, routingGeneration: 7 } as Omit<
	TenantGrantClaims,
	'iat' | 'exp'
>
const identity = { sub: 'user-library' } as IdentityClaims

test('library reads use the trusted database and scope and preserve encoded search/cursor', async () => {
	let captured: Request | undefined
	const service = ArtifactFileService.fromConfig(
		{ ARTIFACT_STORE_BASE_URL: 'http://store.test', ARTIFACT_STORE_BEARER_TOKEN: 'test' },
		async (input, init) => {
			captured = new Request(input, init)
			return Response.json({ storeEpoch: 'epoch', snapshotSequence: 0, items: [], nextAfter: null })
		}
	)
	if (!service) throw new Error('Fixture configuration is unavailable')
	const url = new URL('http://api.test/api/artifacts/library')
	url.search = new URLSearchParams({
		collection: 'documents',
		search: 'A & B + IBAN',
		limit: '50',
		after: '{"cursor":"a&b"}'
	}).toString()
	const response = await new ArtifactHandler(service).user(
		new Request(url),
		identity,
		tenant,
		'library'
	)
	expect(response.status).toBe(200)
	if (!captured) throw new Error('Library did not call the store')
	const upstream = new URL(captured.url)
	expect(upstream.pathname).toBe(`/v1/scopes/${scope}/library`)
	expect(upstream.searchParams.get('search')).toBe('A & B + IBAN')
	expect(upstream.searchParams.get('after')).toBe('{"cursor":"a&b"}')
	expect(captured.headers.get('x-aven-artifact-database')).toBe('cust_library')
	expect(response.headers.get('cache-control')).toBe('no-store')
})

test('library rejects caller routing, unbounded pages and unsupported collections before reading', async () => {
	let reads = 0
	const service = ArtifactFileService.fromConfig(
		{ ARTIFACT_STORE_BASE_URL: 'http://store.test', ARTIFACT_STORE_BEARER_TOKEN: 'test' },
		async () => {
			reads++
			return Response.json({})
		}
	)
	if (!service) throw new Error('Fixture configuration is unavailable')
	for (const params of [
		'collection=documents&scopeId=other',
		'collection=documents&databaseName=other',
		'collection=documents&limit=5000',
		'collection=unknown',
		'collection=artifacts',
		'collection=documents&direction=wrong'
	]) {
		const response = await new ArtifactHandler(service).user(
			new Request(`http://api.test/api/artifacts/library?${params}`),
			identity,
			tenant,
			'library'
		)
		expect(response.status).toBe(400)
	}
	expect(reads).toBe(0)
})
