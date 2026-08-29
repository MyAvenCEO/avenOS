import { createServer, type Server } from 'node:http'
import { ACTOR_RUN_PROTOCOL, type PlanRunRecord } from '@avenos/actors'
import { databaseNameForEnvironment, signTenantGrant } from '@avenos/aven-customer-contracts'
import { IdentityVerifier } from '@avenos/aven-identity'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { afterEach, describe, expect, test } from 'vitest'
import { facadeConfigSchema } from '../../aven-api/src/config.js'
import { CustomerHandler } from '../../aven-api/src/customers/handler.js'
import type { CustomerStore } from '../../aven-api/src/customers/store.js'
import { createFacadeHandler } from '../../aven-api/src/facade.js'
import { createActorRunnerHandler } from '../src/handler.js'
import { MemoryPlanRunner } from '../src/memory-runner.js'

const subject = '3f7b0f1e-7850-4902-a7b0-093f8604a0dd'
const sourceArtifactId = '11111111-1111-4111-8111-111111111111'
const resultArtifactId = '22222222-2222-4222-8222-222222222222'
const serviceToken = 'runner-service-token-0000000000000001'
const environmentId = '99999999-9999-4999-8999-999999999999'
const servers: Server[] = []

afterEach(async () => {
	await Promise.all(
		servers
			.splice(0)
			.map(
				(server) =>
					new Promise<void>((resolve, reject) =>
						server.close((error) => (error ? reject(error) : resolve()))
					)
			)
	)
})

async function serve(
	handler: (request: Request) => Response | Promise<Response>
): Promise<{ server: Server; url: URL }> {
	const server = createServer(async (incoming, outgoing) => {
		try {
			const chunks: Buffer[] = []
			for await (const chunk of incoming) chunks.push(Buffer.from(chunk))
			const address = server.address()
			if (!address || typeof address === 'string') throw new Error('test server has no address')
			const body = Buffer.concat(chunks)
			const response = await handler(
				new Request(`http://127.0.0.1:${address.port}${incoming.url ?? '/'}`, {
					method: incoming.method,
					headers: incoming.headers as HeadersInit,
					...(body.length > 0 && { body })
				})
			)
			outgoing.statusCode = response.status
			for (const [name, value] of response.headers) outgoing.setHeader(name, value)
			outgoing.end(Buffer.from(await response.arrayBuffer()))
		} catch (error) {
			outgoing.statusCode = 500
			outgoing.end(error instanceof Error ? error.message : String(error))
		}
	})
	servers.push(server)
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject)
		server.listen(0, '127.0.0.1', resolve)
	})
	const address = server.address()
	if (!address || typeof address === 'string') throw new Error('test server has no address')
	return { server, url: new URL(`http://127.0.0.1:${address.port}`) }
}

async function identityFixture() {
	const { privateKey, publicKey } = await generateKeyPair('EdDSA')
	const key = {
		...(await exportJWK(publicKey)),
		kid: 'identity-test-key',
		use: 'sig',
		alg: 'EdDSA'
	}
	const identity = await serve((request) => {
		if (new URL(request.url).pathname === '/api/auth/jwks') {
			return Response.json({ keys: [key] })
		}
		return new Response(null, { status: 404 })
	})
	const issuer = identity.url.toString().replace(/\/$/, '')
	const token = await new SignJWT({
		sid: 'session-e2e',
		email: 'runner@example.test',
		email_verified: true,
		role: 'user',
		amr: ['passkey'],
		scope: 'openid services:access'
	})
		.setProtectedHeader({ alg: 'EdDSA', kid: key.kid })
		.setSubject(subject)
		.setIssuer(issuer)
		.setAudience('aven-services')
		.setIssuedAt()
		.setExpirationTime('5m')
		.sign(privateKey)
	return { issuer, token }
}

function command() {
	return {
		protocol: ACTOR_RUN_PROTOCOL,
		requestId: 'request-e2e-1',
		idempotencyKey: 'document-e2e-1',
		requestedAt: new Date().toISOString(),
		skillRef: 'ceo.aven:skill:docs.ingest:document-ingest@1',
		executionEnvironment: 'server',
		ingredients: [
			{
				predicate: 'ceo.aven.docs.document(document_1)',
				artifactId: sourceArtifactId
			}
		],
		goals: ['ceo.aven.docs.content_description(document_1)'],
		parameters: {}
	}
}

describe('split identity -> facade -> os.aven runner', () => {
	test('executes and reads a server run through real HTTP boundaries', async () => {
		const { issuer, token } = await identityFixture()
		const tenantKeys = await generateKeyPair('EdDSA')
		const verifier = new IdentityVerifier({ issuer, audience: 'aven-services' })
		const runner = new MemoryPlanRunner(async (request) => {
			expect(request.security.principal.subjectId).toBe(subject)
			expect(request.security.principal.assurance).toContain('passkey')
			expect(request.executionEnvironment).toBe('server')
			return {
				artifactIds: [resultArtifactId],
				remainingGoals: [],
				registryRevision: 7,
				policyDecisionIds: ['ceo-policy-e2e']
			}
		})
		const runnerServer = await serve(
			createActorRunnerHandler({ forGrant: async () => runner }, verifier, {
				serviceToken,
				tenantGrantIssuer: 'https://api.aven.ceo',
				tenantGrantPublicKey: tenantKeys.publicKey
			})
		)
		const facadeConfig = facadeConfigSchema.parse({
			DATABASE_URL: 'postgres://aven_api:test@database/aven_api',
			SITE_HOST_DIRECTORY_BEARER_TOKEN: 'd'.repeat(32),
			CUSTOMER_ENTITLEMENT_TOKEN: 'e'.repeat(32),
			TENANT_GRANT_PRIVATE_KEY: 'unused-test-private-key-'.repeat(5),
			IDENTITY_ISSUER: issuer,
			API_PUBLIC_BASE_URL: 'https://api.aven.ceo',
			CUSTOMER_DOWNSTREAMS_JSON: JSON.stringify([
				{
					segment: 'actor-runs',
					baseUrl: runnerServer.url.toString(),
					targetPrefix: '/api/actor-runs',
					bearerToken: serviceToken,
					componentRef: 'os.aven:component:actors:run-repository@1',
					readAction: 'actor-runs:read',
					writeAction: 'actor-runs:write',
					roles: ['user', 'admin']
				}
			])
		})
		const customerStore = {
			authorize: async (
				claims: { sub: string; sid: string; role: 'user' | 'admin' },
				id: string,
				componentRef: string,
				actions: string[]
			) => ({
				iss: 'https://api.aven.ceo',
				aud: componentRef,
				sub: claims.sub,
				sid: claims.sid,
				role: claims.role,
				environmentId: id,
				databaseName: databaseNameForEnvironment(id),
				routingGeneration: 1,
				componentRef,
				actions
			})
		} as unknown as CustomerStore
		const customers = new CustomerHandler(
			customerStore,
			customerStore,
			'e'.repeat(32),
			tenantKeys.privateKey
		)
		const facadeServer = await serve(
			createFacadeHandler(facadeConfig, verifier, fetch, undefined, customers)
		)

		const start = await fetch(
			new URL(`/api/environments/${environmentId}/actor-runs`, facadeServer.url),
			{
				method: 'POST',
				headers: {
					authorization: `Bearer ${token}`,
					'content-type': 'application/json',
					'x-aven-subject': 'forged-subject',
					'x-aven-identity-token': 'forged-token'
				},
				body: JSON.stringify(command())
			}
		)
		expect(start.status).toBe(202)
		const handle = (await start.json()) as { runId: string }

		let record: PlanRunRecord | undefined
		for (let attempt = 0; attempt < 50; attempt += 1) {
			const response = await fetch(
				new URL(`/api/environments/${environmentId}/actor-runs/${handle.runId}`, facadeServer.url),
				{
					headers: { authorization: `Bearer ${token}` }
				}
			)
			expect(response.status).toBe(200)
			record = (await response.json()) as PlanRunRecord
			if (record.state === 'succeeded') break
			await new Promise((resolve) => setTimeout(resolve, 2))
		}

		expect(record).toMatchObject({
			state: 'succeeded',
			executionEnvironment: 'server',
			security: {
				principal: { subjectId: subject, kind: 'user', sessionId: 'session-e2e' },
				establishedBy: 'api.aven.ceo/actor-runner-boundary'
			}
		})
		expect(record?.checkpoints).toEqual([
			expect.objectContaining({
				artifactIds: [resultArtifactId],
				registryRevision: 7,
				policyDecisionIds: ['ceo-policy-e2e'],
				remainingGoals: []
			})
		])
	})

	test('rejects caller security assertions and inconsistent facade projections', async () => {
		const { issuer, token } = await identityFixture()
		const verifier = new IdentityVerifier({ issuer, audience: 'aven-services' })
		const tenantKeys = await generateKeyPair('EdDSA')
		const runnerServer = await serve(
			createActorRunnerHandler({ forGrant: async () => new MemoryPlanRunner() }, verifier, {
				serviceToken,
				tenantGrantIssuer: 'https://api.aven.ceo',
				tenantGrantPublicKey: tenantKeys.publicKey
			})
		)
		const tenantGrant = await signTenantGrant(
			{
				iss: 'https://api.aven.ceo',
				aud: 'os.aven:component:actors:run-repository@1',
				sub: subject,
				sid: 'session-e2e',
				role: 'user',
				environmentId,
				databaseName: databaseNameForEnvironment(environmentId),
				routingGeneration: 1,
				componentRef: 'os.aven:component:actors:run-repository@1',
				actions: ['actor-runs:write']
			},
			tenantKeys.privateKey
		)
		const directHeaders = {
			authorization: `Bearer ${serviceToken}`,
			'content-type': 'application/json',
			'x-aven-identity-token': token,
			'x-aven-tenant-grant': tenantGrant,
			'x-aven-subject': '00000000-0000-4000-8000-000000000000',
			'x-aven-role': 'user',
			'x-aven-session': 'session-e2e'
		}
		const mismatched = await fetch(new URL('/api/actor-runs', runnerServer.url), {
			method: 'POST',
			headers: directHeaders,
			body: JSON.stringify(command())
		})
		expect(mismatched.status).toBe(401)

		const asserted = await fetch(new URL('/api/actor-runs', runnerServer.url), {
			method: 'POST',
			headers: { ...directHeaders, 'x-aven-subject': subject },
			body: JSON.stringify({ ...command(), security: { principal: { subjectId: subject } } })
		})
		expect(asserted.status).toBe(400)
		expect(await asserted.json()).toMatchObject({ code: 'COMMAND_INVALID' })
	})
})
