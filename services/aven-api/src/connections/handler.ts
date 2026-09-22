import { timingSafeEqual } from 'node:crypto'
import { type TenantGrantKey, verifyTenantGrant } from '@avenos/aven-customer-contracts'
import type { IdentityVerifier } from '@avenos/aven-identity'
import { credentialUseVerifier } from '@avenos/credential-storage/authority'
import { BodyLimitError, readBoundedJson } from '@avenos/http-boundary'
import { z } from 'zod'
import type { FacadeConfig } from '../config'
import type { CustomerHandler } from '../customers/handler'
import { ConnectionPolicy, type ConnectionPolicyConfig } from './policy'
import { connectionPolicyPorts } from './ports'

const selectionSchema = z
	.object({
		environmentId: z.uuid(),
		runId: z.uuid(),
		invocationId: z.uuid(),
		requestId: z.uuid(),
		bindingRef: z.uuid()
	})
	.strict()
const issueSchema = z.object({ selection: selectionSchema, reviewId: z.uuid() }).strict()
const verifySchema = z
	.object({ protocol: z.enum(['http', 'imap']), authorization: z.string().min(1).max(49152) })
	.strict()
const json = (status: number, body: unknown) =>
	Response.json(body, {
		status,
		headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
	})
const bearerMatches = (request: Request, token: string) => {
	const actual = Buffer.from(request.headers.get('authorization') ?? ''),
		expected = Buffer.from(`Bearer ${token}`)
	return actual.length === expected.length && timingSafeEqual(actual, expected)
}

/** Application-owned issuance, distinct from the private protocol executor. Runner
 * workloads may prepare/issue; executors may only verify. Both require a live user
 * session and fresh entitlement, exact runtime admission and the shared human review.
 * No endpoint decides a review, decrypts a secret or accepts a caller-supplied URL. */
export function createConnectionPolicyHandler(
	config: FacadeConfig,
	authority: {
		runnerToken: string
		executorToken: string
		issuer: string
		privateKey: CryptoKey
		publicKey: CryptoKey
		tenantPublicKey: TenantGrantKey
		policy: ConnectionPolicyConfig
	},
	verifier: Pick<IdentityVerifier, 'verify'>,
	customers: Pick<CustomerHandler, 'grant'>,
	fetcher: typeof fetch = fetch
) {
	if (
		authority.runnerToken.length < 32 ||
		authority.executorToken.length < 32 ||
		authority.runnerToken === authority.executorToken
	)
		throw Error('CONNECTION_POLICY_CONFIG_INVALID')
	const uses = {
		http: credentialUseVerifier(authority.issuer, authority.publicKey, 'http'),
		imap: credentialUseVerifier(authority.issuer, authority.publicKey, 'imap')
	}
	return async (request: Request) => {
		try {
			const url = new URL(request.url),
				operation = url.pathname.split('/').at(-1)
			if (
				request.method !== 'POST' ||
				!['prepare', 'issue', 'verify'].includes(operation ?? '') ||
				url.pathname !== `/internal/v1/connections/${operation}`
			)
				return json(404, { code: 'ROUTE_NOT_FOUND' })
			if (
				url.search ||
				['origin', 'cookie', 'x-aven-work-grant', 'x-aven-tenant-grant'].some((name) =>
					request.headers.has(name)
				) ||
				!bearerMatches(
					request,
					operation === 'verify' ? authority.executorToken : authority.runnerToken
				)
			)
				return json(403, { code: 'CONNECTION_POLICY_ACCESS_DENIED' })
			if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json')
				return json(415, { code: 'JSON_REQUIRED' })
			const identityToken = request.headers.get('x-aven-identity-token') ?? ''
			const identity = await verifier.verify(identityToken)
			if (
				!identity.amr.includes('passkey') ||
				!identity.scope.split(/\s+/).includes('services:access') ||
				identity.exp * 1000 <= Date.now()
			)
				return json(403, { code: 'CONNECTION_POLICY_ACCESS_DENIED' })
			const ports = connectionPolicyPorts(
				config,
				verifier,
				customers,
				authority.tenantPublicKey,
				identityToken,
				request.signal,
				fetcher
			)
			const policy = new ConnectionPolicy(
				authority.issuer,
				authority.privateKey,
				authority.policy,
				ports
			)
			const input = await readBoundedJson(request, operation === 'verify' ? 50 * 1024 : 2048)
			if (operation === 'prepare') {
				const result = await policy.prepare(identityToken, selectionSchema.parse(input))
				return json(200, {
					subject: result.subject,
					subjectSchema: result.subjectSchema,
					subjectDigest: result.subjectDigest,
					title: result.title
				})
			}
			if (operation === 'verify') {
				const parsed = verifySchema.parse(input),
					use = await uses[parsed.protocol](parsed.authorization)
				await policy.assertCurrent(identityToken, use)
				return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
			}
			const parsed = issueSchema.parse(input)
			const result = await policy.issue(identityToken, parsed.selection, parsed.reviewId)
			const component = 'ceo.aven:component:data:credentials@1'
			const grant = await customers.grant({
				claims: identity,
				environmentId: result.use.environmentId,
				componentRef: component,
				actions: ['credentials:read']
			})
			const checked = await verifyTenantGrant(grant.token, authority.tenantPublicKey, {
				issuer: config.API_PUBLIC_BASE_URL,
				audience: component,
				action: 'credentials:read'
			})
			if (
				checked.sub !== result.use.subjectId ||
				checked.sid !== result.use.sessionId ||
				checked.environmentId !== result.use.environmentId ||
				checked.routingGeneration !== result.use.generation ||
				checked.exp * 1000 < Date.parse(result.use.expiresAt)
			)
				throw Error('CONNECTION_AUTHORITY_CHANGED')
			request.signal.throwIfAborted()
			return json(200, { authorization: result.token, tenantGrant: grant.token })
		} catch (error) {
			if (error instanceof BodyLimitError) return json(error.status, { code: error.code })
			if (error instanceof z.ZodError || error instanceof SyntaxError)
				return json(400, { code: 'CONNECTION_POLICY_INPUT_INVALID' })
			// Never forward provider, identity, SQL or key material in diagnostics.
			return json(403, { code: 'CONNECTION_POLICY_DENIED' })
		}
	}
}
