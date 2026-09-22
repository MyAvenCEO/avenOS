import type { StoredArtifact } from '@avenos/artifact-store'
import type { TenantGrantClaims, TenantGrantKey } from '@avenos/aven-customer-contracts'
import { admitCustomerRequest, CustomerAdmissionError } from '@avenos/aven-customer-runtime'
import type { IdentityVerifier } from '@avenos/aven-identity'
import { CredentialStoreError, type CredentialUse } from '@avenos/credential-storage/contracts'
import type { CredentialUseStore } from '@avenos/credential-storage/postgres'
import { BodyLimitError, readBoundedBytes } from '@avenos/http-boundary'
import { z } from 'zod'
import type { ConnectionArtifacts } from './artifacts'
import { createProtectedHttpExchange, type HttpExecutorPorts } from './http'
import { createProtectedImapOperation, type ImapExecutorPorts } from './imap'
import { withCredentialExecution } from './lifecycle'

type BoundPorts = Omit<ImapExecutorPorts, 'verify' | 'onClaim' | 'store'> & {
	store: CredentialUseStore
	artifacts: ConnectionArtifacts
}
export interface ConnectionExecutorHost {
	/** Fixed protocol-specific signer audience; no caller-selected verifier. */
	verify(token: string): Promise<CredentialUse>
	/** Verified placement only. Never accepts URLs, keys or callback code in JSON. */
	forGrant(
		grant: TenantGrantClaims,
		identityToken: string,
		authorization: string
	): Promise<BoundPorts>
}
const bodySchema = z.object({ authorization: z.string().min(1).max(49152) }).strict()
const json = (status: number, body: unknown) =>
	Response.json(body, {
		status,
		headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
	})
const receipt = (outcome: 'published' | 'retained', artifacts: StoredArtifact[]) => ({
	outcome,
	artifacts: artifacts.map((artifact) => ({
		artifactId: artifact.artifactId,
		artifactDigest: artifact.artifactSha256,
		type: artifact.typeKey,
		version: artifact.typeVersion
	}))
})

/** Private fixed-protocol endpoint. No plaintext, raw response or usable authority
 * is returned to the caller. The host separately rechecks live entitlement/parent
 * execution through authorize; these admission tokens alone do not replace it. */
export function createConnectionExecutorHandler(
	config: {
		protocol: 'http' | 'imap'
		serviceToken: string
		issuer: string
		key: TenantGrantKey
		maximumConcurrent?: number
	},
	verifier: Pick<IdentityVerifier, 'verify'>,
	host: ConnectionExecutorHost
) {
	const maximum = config.maximumConcurrent ?? 8
	if (
		!['http', 'imap'].includes(config.protocol) ||
		config.serviceToken.length < 32 ||
		!Number.isSafeInteger(maximum) ||
		maximum < 1 ||
		maximum > 32
	)
		throw Error('CONNECTION_CONFIG_INVALID')
	const active = new Map<AbortController, Promise<Response>>()
	let closing = false
	const execute = async (request: Request, shutdown: AbortSignal): Promise<Response> => {
		try {
			const url = new URL(request.url)
			if (url.pathname !== '/internal/connection/execute' || request.method !== 'POST')
				return json(404, { code: 'ROUTE_NOT_FOUND' })
			if (
				url.search ||
				['origin', 'cookie', 'x-aven-work-grant'].some((name) => request.headers.has(name))
			)
				throw new CustomerAdmissionError()
			const admitted = await admitCustomerRequest(request, {
				serviceToken: config.serviceToken,
				identityVerifier: verifier,
				tenantGrantIssuer: config.issuer,
				tenantGrantPublicKey: config.key,
				componentRef: 'ceo.aven:component:data:credentials@1',
				requiredAction: 'credentials:read'
			})
			if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json')
				return json(415, { code: 'JSON_REQUIRED' })
			const bytes = await readBoundedBytes(request, 50 * 1024)
			let token: string
			try {
				token = bodySchema.parse(
					JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
				).authorization
			} finally {
				bytes.fill(0)
			}
			const verify = async (value: string) => {
				const use = await host.verify(value)
				if (
					use.protocol !== config.protocol ||
					use.environmentId !== admitted.tenant.environmentId ||
					use.publicationScopeId !== admitted.tenant.environmentId ||
					use.generation !== admitted.tenant.routingGeneration ||
					use.subjectId !== admitted.identity.sub ||
					use.sessionId !== admitted.identity.sid ||
					Date.now() >= 1000 * Math.min(admitted.identity.exp, admitted.tenant.exp) ||
					Date.parse(use.expiresAt) > 1000 * Math.min(admitted.identity.exp, admitted.tenant.exp)
				)
					throw new CustomerAdmissionError()
				return use
			}
			const use = await verify(token)
			const signal = AbortSignal.any([request.signal, shutdown])
			signal.throwIfAborted()
			const ports = await host.forGrant(admitted.tenant, admitted.identityToken, token)
			const artifactAccess = ports.artifacts.withSignal(signal)
			await ports.authorize(use)
			const existing = await artifactAccess.lookup(use)
			if (existing) return json(200, receipt('retained', existing))
			return await withCredentialExecution(ports.store, use, async (onClaim) => {
				const shared = { ...ports, verify, onClaim, store: async () => ports.store }
				const observation =
					config.protocol === 'http'
						? await createProtectedHttpExchange(shared as HttpExecutorPorts)(token, signal)
						: await createProtectedImapOperation(shared)(token, signal)
				if (
					observation &&
					typeof observation === 'object' &&
					'outcome' in observation &&
					observation.outcome === 'already-claimed'
				) {
					const retained = await artifactAccess.lookup(use)
					return retained
						? json(200, receipt('retained', retained))
						: json(409, { code: 'CONNECTION_CAPTURE_UNSETTLED', retryable: false })
				}
				signal.throwIfAborted()
				await verify(token)
				const artifacts =
					config.protocol === 'http'
						? await artifactAccess.publishHttp(
								use,
								observation as Awaited<ReturnType<ReturnType<typeof createProtectedHttpExchange>>>
							)
						: await artifactAccess.publishImap(use, observation)
				return json(201, receipt('published', artifacts))
			})
		} catch (error) {
			if (
				error instanceof CustomerAdmissionError ||
				(error instanceof CredentialStoreError && error.code === 'CREDENTIAL_AUTHORITY_INVALID')
			)
				return json(403, { code: 'CONNECTION_ACCESS_DENIED', retryable: false })
			if (error instanceof BodyLimitError) return json(error.status, { code: error.code })
			if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof TypeError)
				return json(400, { code: 'CONNECTION_INPUT_INVALID', retryable: false })
			return json(503, { code: 'CONNECTION_UNAVAILABLE', retryable: false })
		}
	}
	return {
		handle(request: Request): Promise<Response> {
			if (closing || active.size >= maximum)
				return Promise.resolve(json(503, { code: 'CONNECTION_BUSY', retryable: true }))
			const abort = new AbortController()
			const pending = execute(request, abort.signal).finally(() => active.delete(abort))
			active.set(abort, pending)
			return pending
		},
		/** Stop admission, cancel all local operations, wait for shutdown accounting.
		 * Forced process termination instead leaves durable markers for reconciliation. */
		async close() {
			closing = true
			for (const abort of active.keys()) abort.abort()
			await Promise.allSettled([...active.values()])
		}
	}
}
