import { randomUUID } from 'node:crypto'
import { draftFor } from '@avenos/actors/studio'
import { databaseNameForEnvironment } from '@avenos/aven-customer-contracts'
import type { IdentityClaims } from '@avenos/aven-identity'
import { generateKeyPair } from 'jose'
import type pg from 'pg'
import { expect, test, vi } from 'vitest'
import { facadeConfigSchema } from '../../aven-api/src/config'
import { CustomerHandler } from '../../aven-api/src/customers/handler'
import type { CustomerStore } from '../../aven-api/src/customers/store'
import { createFacadeHandler } from '../../aven-api/src/facade'
import { createActorRunnerHandler } from '../src/handler'
import { MemoryPlanRunner } from '../src/memory-runner'
import { StudioArtifacts } from '../src/studio-artifacts'
import { StudioService } from '../src/studio-service'
import { studioStoreFixture } from './support/studio-store'

test('facade grants Studio previews only read access; runner rejects mutation and forged context on that path', async () => {
	const wire = studioStoreFixture()
	const subject = randomUUID()
	const identity = {
		sub: subject,
		sid: 'studio-session',
		role: 'user',
		scope: 'services:access',
		amr: ['passkey']
	} as IdentityClaims
	const keys = await generateKeyPair('EdDSA')
	const component = 'os.aven:component:actors:run-repository@1'
	const serviceToken = 'synthetic-studio-service-'.repeat(3)
	const actions: string[][] = []
	const authorize = async (
		_claims: unknown,
		environmentId: string,
		componentRef: string,
		requested: string[]
	) => {
		actions.push(requested)
		return {
			iss: 'https://api.aven.ceo',
			aud: componentRef,
			sub: subject,
			sid: identity.sid,
			role: 'user',
			membershipRole: 'owner',
			environmentId,
			databaseName: databaseNameForEnvironment(environmentId),
			runtimeId: 'primary',
			routingGeneration: 1,
			componentRef,
			actions: requested
		}
	}
	const customerStore = { authorize } as unknown as CustomerStore
	const customers = new CustomerHandler(
		customerStore,
		customerStore,
		't'.repeat(32),
		keys.privateKey
	)
	const runner = new MemoryPlanRunner()
	const writes = vi.fn(() => {
		throw new Error('No database write is permitted')
	})
	const studio = new StudioService(
		{ query: writes } as unknown as pg.Pool,
		new StudioArtifacts(wire.client, wire.scope),
		runner
	)
	const handler = createActorRunnerHandler(
		{ forGrant: async () => runner, studioForGrant: async () => studio },
		{ verify: async () => identity },
		{
			serviceToken,
			tenantGrantIssuer: 'https://api.aven.ceo',
			tenantGrantPublicKey: keys.publicKey
		}
	)
	const config = facadeConfigSchema.parse({
		DATABASE_URL: 'postgres://synthetic:test@database/fixture',
		SITE_HOST_DIRECTORY_BEARER_TOKEN: 'd'.repeat(32),
		CUSTOMER_ENTITLEMENT_TOKEN: 'e'.repeat(32),
		TENANT_GRANT_PRIVATE_KEY: 'unused-fixture-key-'.repeat(8),
		IDENTITY_ISSUER: 'https://aven.id',
		CUSTOMER_DOWNSTREAMS_JSON: JSON.stringify([
			{
				segment: 'actor-runs',
				baseUrl: 'http://runner.internal',
				targetPrefix: '/api/actor-runs',
				bearerToken: serviceToken,
				componentRef: component,
				readAction: 'actor-runs:read',
				writeAction: 'actor-runs:write'
			}
		])
	})
	const facade = createFacadeHandler(
		config,
		{ verify: async () => identity },
		handler,
		undefined,
		customers
	)
	const send = (path: string, command: unknown) =>
		facade(
			new Request(
				'https://api.aven.ceo/api/environments/' + wire.scope + '/actor-runs/studio/' + path,
				{
					method: 'POST',
					headers: {
						authorization: 'Bearer synthetic-user',
						'content-type': 'application/json',
						'x-aven-subject': randomUUID(),
						'x-aven-tenant-grant': 'forged'
					},
					body: JSON.stringify(command)
				}
			)
		)
	const definition = draftFor({ key: 'core.file', version: 1 }, { key: 'studio.brief', version: 1 })
	const preview = await send('query', { operation: 'preview', data: { definition } })
	expect(preview.status).toBe(200)
	expect(await preview.json()).toMatchObject({ ok: true })
	expect(actions.at(-1)).toEqual(['actor-runs:read'])
	const mutate = await send('query', {
		operation: 'sample',
		data: { requestId: randomUUID(), observedAt: new Date().toISOString() }
	})
	expect(mutate.status).toBe(409)
	expect(wire.publications.size).toBe(0)
	const forged = await send('command', {
		operation: 'draft',
		data: {
			id: randomUUID(),
			revision: 0,
			definition,
			security: { principal: { subjectId: randomUUID() } }
		}
	})
	expect(forged.status).toBe(400)
	expect(actions.at(-1)).toEqual(['actor-runs:write'])
	expect(writes).not.toHaveBeenCalled()
})
