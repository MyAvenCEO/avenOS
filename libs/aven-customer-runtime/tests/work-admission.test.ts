import { randomUUID } from 'node:crypto'
import {
	databaseNameForEnvironment,
	signTenantGrant,
	signWorkerPlacement,
	signWorkGrant,
	type TenantGrantClaims,
	verifyTenantGrant,
	type WorkGrantInput
} from '@avenos/aven-customer-contracts'
import { generateKeyPair } from 'jose'
import { describe, expect, test } from 'vitest'
import {
	admitCustomerRequest,
	admitTurnDispatchRequest,
	admitWorkerRequest,
	admitWorkRequest
} from '../src/index.js'

describe('delegated work is not a login', () => {
	async function fixture() {
		const keys = await generateKeyPair('EdDSA'),
			env = randomUUID(),
			issuer = 'https://work.example.test'
		const componentRef = 'ceo.aven:component:data:productivity@1'
		const work: WorkGrantInput = {
			iss: issuer,
			jti: randomUUID(),
			sub: randomUUID(),
			sid: randomUUID(),
			role: 'user',
			membershipRole: 'owner',
			environmentId: env,
			databaseName: databaseNameForEnvironment(env),
			routingGeneration: 1,
			kind: 'chat-turn',
			inputId: randomUUID(),
			inputRevision: 1,
			materialDigest: 'a'.repeat(64),
			permissions: [{ componentRef, actions: ['productivity:read'] }]
		}
		const grant = {
			iss: issuer,
			aud: componentRef,
			componentRef,
			sub: work.sub,
			sid: work.sid,
			role: work.role,
			membershipRole: work.membershipRole,
			environmentId: env,
			databaseName: work.databaseName,
			routingGeneration: 1,
			actions: ['productivity:read'],
			execution: {
				workId: work.jti,
				turnId: randomUUID(),
				runId: randomUUID(),
				leaseOwnerId: randomUUID()
			}
		}
		const config = {
			serviceToken: 's'.repeat(32),
			tenantGrantPublicKey: keys.publicKey,
			tenantGrantIssuer: issuer,
			componentRef,
			requiredAction: 'productivity:read'
		}
		const request = async (
			override: Partial<Omit<TenantGrantClaims, 'iat' | 'exp'>> = {},
			token?: string
		) =>
			new Request('http://worker.example.test/tasks', {
				headers: {
					authorization: `Bearer ${config.serviceToken}`,
					'x-aven-tenant-grant': await signTenantGrant({ ...grant, ...override }, keys.privateKey),
					'x-aven-work-grant': token ?? (await signWorkGrant(work, keys.privateKey))
				}
			})
		return { config, keys, work, grant, request }
	}
	test('accepts actual signatures bound to one work/turn/run/lease without an identity JWT', async () => {
		const f = await fixture(),
			result = await admitWorkRequest(await f.request(), f.config)
		expect(result.tenant.execution).toEqual(f.grant.execution)
		expect(result.work.jti).toBe(f.work.jti)
		expect(result).not.toHaveProperty('identity')
	})
	test('rejects cross-work, subject, session, membership, generation and widened permissions', async () => {
		const f = await fixture()
		const changes: Partial<Omit<TenantGrantClaims, 'iat' | 'exp'>>[] = [
			{ execution: undefined },
			{ execution: { ...f.grant.execution, workId: randomUUID() } },
			{ sub: randomUUID() },
			{ sid: randomUUID() },
			{ role: 'admin' },
			{ membershipRole: 'admin' },
			{ routingGeneration: 2 },
			{ actions: ['productivity:read', 'productivity:write'] }
		]
		const env = randomUUID()
		changes.push({ environmentId: env, databaseName: databaseNameForEnvironment(env) })
		for (const change of changes)
			await expect(admitWorkRequest(await f.request(change), f.config)).rejects.toThrow()
	})
	test('rejects another issuer/key, an expired certificate and a grant that outlives its parent', async () => {
		const f = await fixture(),
			other = await generateKeyPair('EdDSA')
		for (const token of [
			await signWorkGrant(f.work, other.privateKey),
			await signWorkGrant({ ...f.work, iss: 'https://other.example.test' }, f.keys.privateKey),
			await signWorkGrant(f.work, f.keys.privateKey, 1, Math.floor(Date.now() / 1000) - 30),
			await signWorkGrant(f.work, f.keys.privateKey, 10)
		])
			await expect(admitWorkRequest(await f.request({}, token), f.config)).rejects.toThrow()
	})
	test('rejects missing workload proof and mixed identity/work headers', async () => {
		const f = await fixture()
		for (const header of ['authorization', 'x-aven-work-grant', 'x-aven-tenant-grant']) {
			const request = await f.request()
			request.headers.delete(header)
			await expect(admitWorkRequest(request, f.config)).rejects.toThrow()
		}
		for (const header of [
			'cookie',
			'origin',
			'x-aven-worker-placement',
			'x-aven-identity-token',
			'x-aven-subject',
			'x-aven-role',
			'x-aven-session'
		]) {
			const request = await f.request()
			request.headers.set(header, 'unexpected')
			await expect(admitWorkRequest(request, f.config)).rejects.toThrow()
		}
	})
	test('worker lifecycle access requires the exact signed runtime placement, not a user or execution grant', async () => {
		const f = await fixture(),
			componentRef = 'ceo.aven:component:data:intents@1'
		const placement = {
			iss: f.config.tenantGrantIssuer,
			runtimeId: 'primary',
			componentRef,
			environmentId: f.work.environmentId,
			databaseName: f.work.databaseName,
			routingGeneration: 1
		} as const
		const config = { ...f.config, runtimeId: 'primary', componentRef } as const
		const request = (token: string) =>
			new Request('https://worker.example.test/internal/v1/work/turn/lifecycle', {
				headers: {
					authorization: `Bearer ${config.serviceToken}`,
					'x-aven-worker-placement': token
				}
			})
		const proof = await signWorkerPlacement(placement, f.keys.privateKey)
		expect((await admitWorkerRequest(request(proof), config)).environmentId).toBe(
			f.work.environmentId
		)
		for (const token of [
			await signWorkerPlacement({ ...placement, runtimeId: 'elsewhere' }, f.keys.privateKey),
			await signWorkerPlacement(
				{ ...placement, componentRef: 'os.aven:component:actors:run-repository@1' },
				f.keys.privateKey
			),
			await signWorkerPlacement(placement, (await generateKeyPair('EdDSA')).privateKey),
			await signWorkerPlacement(placement, f.keys.privateKey, Math.floor(Date.now() / 1000) - 61),
			await signWorkGrant(f.work, f.keys.privateKey),
			await signTenantGrant(f.grant, f.keys.privateKey)
		])
			await expect(admitWorkerRequest(request(token), config)).rejects.toThrow()
		for (const header of [
			'cookie',
			'origin',
			'x-aven-work-grant',
			'x-aven-tenant-grant',
			'x-aven-identity-token',
			'x-aven-subject'
		]) {
			const mixed = request(proof)
			mixed.headers.set(header, 'unexpected')
			await expect(admitWorkerRequest(mixed, config)).rejects.toThrow()
		}
		await expect(admitWorkRequest(request(proof), f.config)).rejects.toThrow()
	})
	test('pre-lease dispatch permits only turn admission, never execution or a login', async () => {
		const f = await fixture(),
			componentRef = 'os.aven:component:actors:run-repository@1'
		const work = { ...f.work, permissions: [{ componentRef, actions: ['actor-runs:write'] }] }
		const dispatch = { workId: work.jti, turnId: randomUUID(), dispatchToken: randomUUID() }
		const grant = {
			...f.grant,
			componentRef,
			aud: componentRef,
			actions: ['actor-runs:write'],
			execution: undefined,
			dispatch
		}
		const config = { ...f.config, componentRef, requiredAction: 'actor-runs:write' }
		const request = new Request('https://runner.example.test/internal/v1/work/admit', {
			headers: {
				authorization: `Bearer ${config.serviceToken}`,
				'x-aven-work-grant': await signWorkGrant(work, f.keys.privateKey),
				'x-aven-tenant-grant': await signTenantGrant(grant, f.keys.privateKey)
			}
		})
		expect((await admitTurnDispatchRequest(request, config)).tenant.dispatch).toEqual(dispatch)
		await expect(admitWorkRequest(request, config)).rejects.toThrow()
		await expect(admitTurnDispatchRequest(await f.request(), f.config)).rejects.toThrow()
		await expect(
			signTenantGrant({ ...grant, execution: f.grant.execution }, f.keys.privateKey)
		).rejects.toThrow()
		await expect(
			signTenantGrant(
				{ ...grant, actions: ['actor-runs:read', 'actor-runs:write'] },
				f.keys.privateKey
			)
		).rejects.toThrow()
		await expect(
			signTenantGrant({ ...f.grant, execution: undefined, dispatch }, f.keys.privateKey)
		).rejects.toThrow()
		request.headers.set('x-aven-subject', work.sub)
		await expect(admitTurnDispatchRequest(request, config)).rejects.toThrow()
	})
	test('an execution grant cannot enter the interactive boundary even with a valid matching login', async () => {
		const f = await fixture(),
			request = await f.request()
		request.headers.set('x-aven-identity-token', 'independent-login')
		request.headers.set('x-aven-subject', f.work.sub)
		request.headers.set('x-aven-role', f.work.role)
		request.headers.set('x-aven-session', f.work.sid)
		await expect(
			admitCustomerRequest(request, {
				...f.config,
				identityVerifier: {
					verify: async () => ({
						sub: f.work.sub,
						sid: f.work.sid,
						role: f.work.role,
						scope: 'services:access',
						amr: ['passkey'],
						iss: 'https://identity.example.test',
						aud: 'aven-services',
						iat: 1,
						exp: 9999999999,
						email: 'test@example.test',
						email_verified: true
					})
				}
			})
		).rejects.toThrow()
	})
	test('execution expiry is a hard lease deadline, not the interactive clock-tolerance window', async () => {
		const f = await fixture(),
			now = Math.floor(Date.now() / 1000)
		const token = await signTenantGrant(f.grant, f.keys.privateKey, 1, now - 1)
		// The common verifier tolerates a small identity clock skew; work admission must not.
		await expect(
			verifyTenantGrant(token, f.keys.publicKey, {
				issuer: f.config.tenantGrantIssuer,
				audience: f.config.componentRef,
				action: f.config.requiredAction
			})
		).resolves.toBeDefined()
		const request = await f.request(
			{},
			await signWorkGrant(f.work, f.keys.privateKey, 3600, now - 10)
		)
		request.headers.set('x-aven-tenant-grant', token)
		await expect(admitWorkRequest(request, f.config)).rejects.toThrow()
	})
})
