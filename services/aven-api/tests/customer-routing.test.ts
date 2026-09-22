import { randomUUID } from 'node:crypto'
import { verifyTenantGrant } from '@avenos/aven-customer-contracts'
import type { IdentityClaims } from '@avenos/aven-identity'
import { generateKeyPair } from 'jose'
import type pg from 'pg'
import { expect, test } from 'vitest'
import { CustomerHandler } from '../src/customers/handler.js'
import { CustomerStore } from '../src/customers/store.js'
import { createFacadeHandler } from '../src/facade.js'
import { testConfig } from './helpers.js'

test.each([
	['credentials', '/commands', 'ceo.aven:component:data:credentials@1', 'credentials:write'],
	[
		'actor-runs',
		`/${randomUUID()}/reviews/${randomUUID()}`,
		'os.aven:component:actors:run-repository@1',
		'actor-runs:write'
	]
])(
	'interactive %s validates origin before the private handoff',
	async (segment, suffix, componentRef, action) => {
		const environment = randomUUID(),
			subject = randomUUID(),
			keys = await generateKeyPair('EdDSA')
		const identity = {
			sub: subject,
			sid: 'interactive-session',
			role: 'user',
			scope: 'services:access',
			amr: ['passkey']
		} as IdentityClaims
		const pool = {
			query: async () => ({
				rows: [
					{
						database_name: `cust_${environment.replaceAll('-', '')}`,
						runtime_id: 'primary',
						movement_id: null,
						routing_generation: 1,
						desired_state: 'ready',
						observed_state: 'ready',
						component_state: 'ready',
						membership_role: 'owner'
					}
				]
			})
		} as unknown as pg.Pool
		const store = new CustomerStore(pool, 'https://api.aven.ceo')
		let calls = 0
		const handler = createFacadeHandler(
			testConfig({
				CORS_ORIGINS: 'tauri://localhost',
				CUSTOMER_DOWNSTREAMS_JSON: JSON.stringify([
					{
						segment,
						baseUrl: 'http://private.test',
						targetPrefix: `/api/${segment}`,
						bearerToken: 'p'.repeat(32),
						componentRef,
						readAction: action.replace(':write', ':read'),
						writeAction: action
					}
				])
			}),
			{ verify: async () => identity },
			async (request) => {
				calls++
				expect(request.headers.has('origin')).toBe(false)
				expect(request.headers.has('cookie')).toBe(false)
				expect(request.headers.get('x-aven-subject')).toBe(subject)
				expect(request.headers.get('x-aven-identity-token')).toBe('interactive-identity')
				const grant = await verifyTenantGrant(
					request.headers.get('x-aven-tenant-grant')!,
					keys.publicKey,
					{ issuer: 'https://api.aven.ceo', audience: componentRef, action }
				)
				expect(grant.environmentId).toBe(environment)
				return Response.json({ saved: true })
			},
			undefined,
			new CustomerHandler(store, store, 'e'.repeat(32), keys.privateKey)
		)
		const send = (headers: Record<string, string>) =>
			handler(
				new Request(`https://api.aven.ceo/api/environments/${environment}/${segment}${suffix}`, {
					method: 'POST',
					headers: {
						authorization: 'Bearer interactive-identity',
						'content-type': 'application/json',
						...headers
					},
					body: '{}'
				})
			)
		for (const origin of ['https://api.aven.ceo', 'tauri://localhost'])
			expect((await send({ origin, 'x-aven-subject': 'forged' })).status).toBe(200)
		const deniedHeaders: Array<Record<string, string>> = [
			{ origin: 'https://attacker.test' },
			{ origin: 'null' },
			{ cookie: 'session=forged' },
			{ 'x-aven-work-grant': 'delegated' }
		]
		for (const headers of deniedHeaders) expect((await send(headers)).status).toBe(403)
		expect(calls).toBe(2)
	}
)

test('the same signed-in customer follows the current directory and a held or unknown destination fails closed', async () => {
	const environment = randomUUID()
	const subject = randomUUID()
	const identity = {
		sub: subject,
		sid: 'unchanged-session',
		role: 'user',
		scope: 'services:access',
		amr: ['passkey']
	} as IdentityClaims
	let runtimeId = 'primary'
	let generation = 1
	let movement: string | null = null
	const keys = await generateKeyPair('EdDSA')
	const pool = {
		query: async (_sql: string, args: string[]) => {
			expect(args.slice(0, 2)).toEqual([environment, subject])
			return {
				rows: [
					{
						database_name: `cust_${environment.replaceAll('-', '')}`,
						runtime_id: runtimeId,
						movement_id: movement,
						routing_generation: generation,
						desired_state: 'ready',
						observed_state: 'ready',
						component_state: 'ready',
						membership_role: 'owner'
					}
				]
			}
		}
	} as unknown as pg.Pool
	const store = new CustomerStore(pool, 'https://api.aven.ceo')
	const customers = new CustomerHandler(store, store, 't'.repeat(32), keys.privateKey)
	const target = {
		segment: 'intents',
		baseUrl: 'http://blue.internal',
		targetPrefix: '/api/intents',
		bearerToken: 'b'.repeat(32),
		componentRef: 'ceo.aven:component:data:intents@1',
		readAction: 'intents:read',
		writeAction: 'intents:write'
	}
	const config = testConfig({
		CUSTOMER_DOWNSTREAMS_JSON: JSON.stringify([target]),
		CUSTOMER_RUNTIMES_JSON: JSON.stringify([
			{
				id: 'green',
				targets: [{ ...target, baseUrl: 'http://green.internal', bearerToken: 'g'.repeat(32) }],
				artifactStoreBaseUrl: 'http://green-artifacts.internal',
				artifactStoreBearerToken: 'a'.repeat(32)
			}
		])
	})
	let calls = 0
	const handler = createFacadeHandler(
		config,
		{ verify: async () => identity },
		async (request) => {
			calls++
			expect(new URL(request.url).hostname).toBe(
				runtimeId === 'primary' ? 'blue.internal' : 'green.internal'
			)
			expect(request.headers.get('authorization')).toBe(
				`Bearer ${(runtimeId === 'primary' ? 'b' : 'g').repeat(32)}`
			)
			expect(request.headers.get('x-aven-runtime')).toBeNull()
			const grant = await verifyTenantGrant(
				request.headers.get('x-aven-tenant-grant') ?? '',
				keys.publicKey,
				{
					issuer: 'https://api.aven.ceo',
					audience: target.componentRef,
					action: 'intents:read'
				}
			)
			expect(grant.environmentId).toBe(environment)
			expect(grant.routingGeneration).toBe(generation)
			return Response.json({ items: [] })
		},
		undefined,
		customers
	)
	const request = () =>
		handler(
			new Request(`https://api.aven.ceo/api/environments/${environment}/intents`, {
				headers: { authorization: 'Bearer unchanged-identity', 'x-aven-runtime': 'untrusted' }
			})
		)
	expect((await request()).status).toBe(200)
	runtimeId = 'green'
	generation = 2
	expect((await request()).status).toBe(200)
	movement = randomUUID()
	expect((await request()).status).toBe(503)
	movement = null
	runtimeId = 'unconfigured'
	expect((await request()).status).toBe(503)
	expect(calls).toBe(2)
})
