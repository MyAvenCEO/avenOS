import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { databaseNameForEnvironment, signTenantGrant } from '@avenos/aven-customer-contracts'
import { IdentityVerifier } from '@avenos/aven-identity'
import { createCredentialSealer } from '@avenos/credential-storage'
import { CredentialAdminStore, CredentialMetadataStore } from '@avenos/credential-storage/postgres'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { credentialDatabase } from '../../../deploy/e2e/credential-database'
import { createCredentialHandler } from '../src/handler'

const url = process.env.CREDENTIAL_TEST_DATABASE_URL
const environmentId = randomUUID(),
	subjectId = randomUUID(),
	credentialRef = randomUUID(),
	serviceToken = randomUUID() + randomUUID()
let database: Awaited<ReturnType<typeof credentialDatabase>>,
	server: ReturnType<typeof createServer>
let handler: ReturnType<typeof createCredentialHandler>, identityToken: string, issuer: string
const keys = await generateKeyPair('EdDSA'),
	componentRef = 'ceo.aven:component:data:credentials@1'
const secret = randomUUID()
async function request(path: string, body?: unknown, overrides: Record<string, string> = {}) {
	const grant = await signTenantGrant(
		{
			iss: issuer,
			aud: componentRef,
			sub: subjectId,
			sid: 'synthetic-session',
			role: 'user',
			membershipRole: 'member',
			environmentId,
			databaseName: databaseNameForEnvironment(environmentId),
			routingGeneration: 1,
			componentRef,
			actions: [body === undefined ? 'credentials:read' : 'credentials:write']
		},
		keys.privateKey
	)
	return handler(
		new Request(`http://ingress.example.test/api/credentials${path}`, {
			method: body === undefined ? 'GET' : 'POST',
			headers: {
				authorization: `Bearer ${serviceToken}`,
				'x-aven-identity-token': identityToken,
				'x-aven-tenant-grant': grant,
				'x-aven-subject': subjectId,
				'x-aven-role': 'user',
				'x-aven-session': 'synthetic-session',
				'content-type': 'application/json',
				...overrides
			},
			body: body === undefined ? undefined : JSON.stringify(body)
		})
	)
}
describe.skipIf(!url)('credential ingress with actual JWTs, crypto and SQL', () => {
	beforeAll(async () => {
		if (!url) throw Error('Isolated database required')
		database = await credentialDatabase(url, environmentId)
		const key = await exportJWK(keys.publicKey)
		server = createServer((_req, res) => {
			res.setHeader('content-type', 'application/json')
			res.end(JSON.stringify({ keys: [{ ...key, kid: 'proof', alg: 'EdDSA', use: 'sig' }] }))
		})
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
		issuer = `http://127.0.0.1:${(server.address() as { port: number }).port}`
		identityToken = await new SignJWT({
			sid: 'synthetic-session',
			email: 'greenhouse@example.test',
			email_verified: true,
			role: 'user',
			amr: ['passkey'],
			scope: 'services:access'
		})
			.setProtectedHeader({ alg: 'EdDSA', kid: 'proof' })
			.setSubject(subjectId)
			.setIssuer(issuer)
			.setAudience('aven-services')
			.setIssuedAt()
			.setExpirationTime('5m')
			.sign(keys.privateKey)
		const cryptoKeys = await crypto.subtle.generateKey(
			{
				name: 'RSA-OAEP',
				modulusLength: 3072,
				publicExponent: new Uint8Array([1, 0, 1]),
				hash: 'SHA-256'
			},
			false,
			['encrypt', 'decrypt']
		)
		handler = createCredentialHandler(
			{ serviceToken, issuer, key: keys.publicKey },
			new IdentityVerifier({ issuer }),
			{
				adminFor: async (grant) =>
					new CredentialAdminStore(database.pools.set, {
						environmentId: grant.environmentId,
						subjectId: grant.sub,
						generation: grant.routingGeneration
					}),
				metadataFor: async (grant) =>
					new CredentialMetadataStore(database.pools.metadata, {
						environmentId: grant.environmentId,
						subjectId: grant.sub,
						generation: grant.routingGeneration
					})
			},
			createCredentialSealer('proof', cryptoKeys.publicKey)
		)
	}, 30000)
	afterAll(async () => {
		if (server) {
			server.closeAllConnections()
			await new Promise<void>((resolve) => server.close(() => resolve()))
		}
		await database?.close()
	})
	test('stores only sealed values and returns redacted durable receipts', async () => {
		const commandId = randomUUID(),
			command = {
				action: 'create',
				credentialRef,
				expectedVersion: 0,
				label: 'Fictional greenhouse',
				kind: 'password',
				value: secret
			}
		const response = await request('/commands', { commandId, command })
		expect(response.status).toBe(201)
		const body = await response.text()
		expect(body).not.toContain(secret)
		expect(body).not.toContain('ciphertext')
		const replay = await request('/commands', {
			commandId,
			command: { ...command, value: 'an intentionally different synthetic value' }
		})
		expect(replay.status).toBe(200)
		expect(await replay.json()).toMatchObject({
			outcome: 'previously-processed',
			receipt: { secretVersion: 1 }
		})
		const receipt = await request(`/commands/${commandId}`)
		expect(receipt.status).toBe(200)
		expect(await receipt.text()).not.toContain(secret)
		const metadata = await request('')
		expect(metadata.status).toBe(200)
		expect(await metadata.json()).toMatchObject({
			credentials: [{ credentialRef, secretVersion: 1 }],
			bindings: []
		})
	})
	test('refuses forged transport/session headers and raw-secret lookup paths', async () => {
		const invalidHeaders: Array<Record<string, string>> = [
			{ authorization: 'Bearer wrong' },
			{ 'x-aven-session': 'wrong' },
			{ origin: 'https://attacker.example.test' },
			{ 'x-aven-identity-token': 'forged' },
			{ 'x-aven-work-grant': 'not-an-interactive-user' }
		]
		for (const override of invalidHeaders)
			expect((await request('', undefined, override)).status).toBe(403)
		expect((await request(`/${credentialRef}/value`)).status).toBe(404)
		expect(
			(
				await request('/commands', {
					commandId: randomUUID(),
					command: { action: 'rotate', credentialRef, expectedVersion: 99, value: secret }
				})
			).status
		).toBe(409)
	})
	test('rotates and revokes without exposing either value', async () => {
		const rotation = await request('/commands', {
			commandId: randomUUID(),
			command: { action: 'rotate', credentialRef, expectedVersion: 1, value: randomUUID() }
		})
		expect(rotation.status).toBe(201)
		expect(await rotation.json()).toMatchObject({ receipt: { secretVersion: 2 } })
		const revoke = await request('/commands', {
			commandId: randomUUID(),
			command: { action: 'revoke', credentialRef, expectedVersion: 2 }
		})
		expect(revoke.status).toBe(201)
		expect(await revoke.json()).toMatchObject({ receipt: { enabled: false } })
		expect(
			(
				await request('/commands', {
					commandId: randomUUID(),
					command: { action: 'rotate', credentialRef, expectedVersion: 2, value: secret }
				})
			).status
		).toBe(409)
	})
})
