/** Actual private HTTP ingress and JWT/JWKS verification. Test identity/tenant
 * signing is deliberate fixture authority, not a production policy/login proof. */
import { randomUUID } from 'node:crypto'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import {
	databaseNameForEnvironment,
	signTenantGrant
} from '../../libs/aven-customer-contracts/src/index'
import { IdentityVerifier } from '../../libs/aven-identity/src/index'
import {
	type ConnectionExecutorHost,
	createConnectionExecutorHandler
} from '../../services/credential-executor/src/handler'

export async function connectionIngressFixture(
	scope: { environmentId: string; subjectId: string; generation: number; sessionId: string },
	protocol: 'http' | 'imap',
	host: ConnectionExecutorHost
) {
	const pair = await generateKeyPair('EdDSA'),
		jwk = await exportJWK(pair.publicKey)
	const identity = Bun.serve({
		hostname: '127.0.0.1',
		port: 0,
		fetch: () => Response.json({ keys: [{ ...jwk, kid: 'proof', alg: 'EdDSA', use: 'sig' }] })
	})
	let server: ReturnType<typeof Bun.serve> | undefined
	let handler: ReturnType<typeof createConnectionExecutorHandler> | undefined
	const close = async () => {
		await handler?.close()
		await server?.stop(true)
		await identity.stop(true)
	}
	try {
		const issuer = `http://127.0.0.1:${identity.port}`,
			serviceToken = randomUUID() + randomUUID()
		const token = await new SignJWT({
			sid: scope.sessionId,
			email: 'synthetic-workshop@example.test',
			email_verified: true,
			role: 'user',
			amr: ['passkey'],
			scope: 'services:access'
		})
			.setProtectedHeader({ alg: 'EdDSA', kid: 'proof' })
			.setSubject(scope.subjectId)
			.setIssuer(issuer)
			.setAudience('aven-services')
			.setIssuedAt()
			.setExpirationTime('10m')
			.sign(pair.privateKey)
		handler = createConnectionExecutorHandler(
			{ protocol, serviceToken, issuer, key: pair.publicKey },
			new IdentityVerifier({ issuer }),
			host
		)
		server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: handler.handle })
		const base = `http://127.0.0.1:${server.port}`
		return {
			close,
			async execute(
				authorization: string,
				patch: Record<string, string> = {},
				signal?: AbortSignal
			) {
				const component = 'ceo.aven:component:data:credentials@1'
				const grant = await signTenantGrant(
					{
						iss: issuer,
						aud: component,
						componentRef: component,
						sub: scope.subjectId,
						sid: scope.sessionId,
						role: 'user',
						membershipRole: 'owner',
						environmentId: scope.environmentId,
						databaseName: databaseNameForEnvironment(scope.environmentId),
						routingGeneration: scope.generation,
						actions: ['credentials:read']
					},
					pair.privateKey
				)
				return fetch(`${base}/internal/connection/execute`, {
					method: 'POST',
					signal,
					headers: {
						'content-type': 'application/json',
						authorization: `Bearer ${serviceToken}`,
						'x-aven-identity-token': token,
						'x-aven-tenant-grant': grant,
						'x-aven-subject': scope.subjectId,
						'x-aven-role': 'user',
						'x-aven-session': scope.sessionId,
						...patch
					},
					body: JSON.stringify({ authorization })
				})
			}
		}
	} catch (error) {
		await close()
		throw error
	}
}
