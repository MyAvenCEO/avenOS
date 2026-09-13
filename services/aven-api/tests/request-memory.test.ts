import type { TenantGrantClaims } from '@avenos/aven-customer-contracts'
import type { IdentityClaims } from '@avenos/aven-identity'
import { expect, test } from 'vitest'
import { ArtifactHandler } from '../src/artifacts/handler'
import type { ArtifactFileService } from '../src/lib/server/artifacts/service'
import { RequestMemoryBudget } from '../src/request-memory'

const MIB = 1024 * 1024
const request = (body = '{}', declared?: string) =>
	new Request('http://test.local', {
		method: 'POST',
		body,
		headers: declared === undefined ? {} : { 'content-length': declared }
	})

test('reserves unknown bodies before reading and retains admission through downstream completion', async () => {
	const budget = new RequestMemoryBudget(4 * MIB)
	const entered = Promise.withResolvers<void>(),
		release = Promise.withResolvers<void>()
	const first = budget.json(request(), 3 * MIB, async () => {
		entered.resolve()
		await release.promise
	})
	await entered.promise
	let pulled = false,
		cancelled = false
	const body = new ReadableStream(
		{
			pull() {
				pulled = true
			},
			cancel() {
				cancelled = true
			}
		},
		{ highWaterMark: 0 }
	)
	await expect(
		budget.json(
			new Request('http://test.local', { method: 'POST', body, duplex: 'half' } as RequestInit),
			3 * MIB,
			async () => {}
		)
	).rejects.toMatchObject({ status: 503, code: 'REQUEST_CAPACITY_EXHAUSTED' })
	expect(pulled).toBe(false)
	expect(cancelled).toBe(true)
	// Known small requests can still proceed while a large request owns a reservation.
	await expect(budget.json(request('{}', '2'), MIB, async () => 'small')).resolves.toBe('small')
	release.resolve()
	await first
	await expect(budget.json(request(), 3 * MIB, async () => 'retry')).resolves.toBe('retry')
})

test('understated lengths, malformed JSON and downstream errors release admission', async () => {
	const budget = new RequestMemoryBudget(MIB)
	await expect(
		budget.json(request('{"more":true}', '2'), MIB, async () => {})
	).rejects.toMatchObject({ status: 413 })
	await expect(budget.json(request('{'), MIB, async () => {})).rejects.toBeInstanceOf(SyntaxError)
	await expect(
		budget.json(request(), MIB, async () => {
			throw new Error('downstream')
		})
	).rejects.toThrow('downstream')
	await expect(budget.json(request(), MIB, async () => 'available')).resolves.toBe('available')
})

test('rejects excessive JSON object expansion before parsing while preserving quoted punctuation', async () => {
	const budget = new RequestMemoryBudget(4 * MIB)
	for (const body of ['['.repeat(65) + '0' + ']'.repeat(65), '[' + '0,'.repeat(1_000_001) + '0]'])
		await expect(budget.json(request(body), 4 * MIB, async () => {})).rejects.toMatchObject({
			status: 400,
			code: 'REQUEST_JSON_STRUCTURE_TOO_LARGE'
		})
	const value = { quoted: '\\"' + '[{,:}]'.repeat(1000) }
	await expect(
		budget.json(request(JSON.stringify(value)), MIB, async (body) => body)
	).resolves.toEqual(value)
})

test('client publications use the shared model budget and preserve body-limit status', async () => {
	const budget = new RequestMemoryBudget(MIB)
	const entered = Promise.withResolvers<void>(),
		release = Promise.withResolvers<void>()
	const held = budget.json(request(), MIB, async () => {
		entered.resolve()
		await release.promise
	})
	await entered.promise
	let publications = 0
	const handler = new ArtifactHandler({
		publishClientRun: async () => {
			publications++
			return {}
		}
	} as unknown as ArtifactFileService)
	const tenant = {
		databaseName: 'cust_test',
		environmentId: '11111111-1111-4111-8111-111111111111',
		routingGeneration: 1
	} as TenantGrantClaims
	const identity = { sub: 'test' } as IdentityClaims
	const suffix = '/client-runs/11111111-1111-4111-8111-111111111111'
	const busy = await handler.user(request('{}', '2'), identity, tenant, suffix, budget)
	expect(busy.status).toBe(503)
	expect(await busy.json()).toMatchObject({ retryable: true, code: 'REQUEST_CAPACITY_EXHAUSTED' })
	expect(publications).toBe(0)
	release.resolve()
	await held
	expect((await handler.user(request('{}', '2'), identity, tenant, suffix, budget)).status).toBe(
		201
	)
	expect(publications).toBe(1)
	expect(
		(await handler.user(request('{"extra":true}', '2'), identity, tenant, suffix, budget)).status
	).toBe(413)
	expect(publications).toBe(1)
})
