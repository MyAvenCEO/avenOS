import { createHash } from 'node:crypto'
import type { createCredentialUnsealer } from '@avenos/credential-storage'
import type { CredentialUse } from '@avenos/credential-storage/contracts'
import { CredentialStoreError } from '@avenos/credential-storage/contracts'
import type { CredentialUseStore } from '@avenos/credential-storage/postgres'
import { PinnedHttpResourceTransport, retainedResponseHeaders } from '@avenos/http-resources'
import { httpRequestDigest, parseHttpRequestArtifact } from '@avenos/http-resources/contracts'

export interface HttpExecutorPorts {
	verify(token: string): Promise<CredentialUse>
	/** Recheck current identity/tenant/parent execution immediately before claiming.
	 * No model, Actor or caller-selected callback is admitted into this process. */
	authorize(use: CredentialUse): Promise<void>
	store(use: CredentialUse): Promise<CredentialUseStore>
	/** Protected host ownership hook; invoked only after winning the first SQL claim. */
	onClaim(use: CredentialUse): void
	/** Resolve exact occurrence + authoritative store digest under current access. */
	request(use: CredentialUse): Promise<unknown>
	unsealer: ReturnType<typeof createCredentialUnsealer>
	allowedOrigins: readonly string[]
	/** Host-only loopback TLS fixtures. Never supplied in a request or binding. */
	localTestOrigins?: readonly string[]
}

/** One fixed HTTPS exchange, never a generic secret resolver. The outer acquisition
 * controls redirects/publication, each with its own exact exchange authorization.
 * A lost response is not replayed by making a second network request. */
export function createProtectedHttpExchange(ports: HttpExecutorPorts) {
	return async (token: string, signal: AbortSignal) => {
		const use = await ports.verify(token)
		if (
			use.protocol !== 'http' ||
			use.maximumUnits !== 1 ||
			use.capabilityId !== 'ceo.aven:capability:web.http-fetch:http_fetch_authenticated@1' ||
			use.requestSchemaId !== 'ceo.aven:schema:web:http-request@1'
		)
			throw new CredentialStoreError('CREDENTIAL_USE_DENIED')
		const request = parseHttpRequestArtifact(await ports.request(use))
		if (
			httpRequestDigest(request) !== use.operationDigest ||
			request.authentication.mode === 'anonymous' ||
			request.authentication.purpose !== use.purpose
		)
			throw new CredentialStoreError('CREDENTIAL_REQUEST_MISMATCH')
		signal.throwIfAborted()
		const store = await ports.store(use)
		await ports.authorize(use)
		signal.throwIfAborted()
		const unitDigest = createHash('sha256')
			.update(JSON.stringify(['http-exchange-v1', use.operationDigest, 0]))
			.digest('hex')
		const claim = await store.claim(use, 0, unitDigest)
		if (claim.outcome === 'already-claimed') return claim
		let bytes: Uint8Array | undefined
		let dispatched = false
		try {
			ports.onClaim(use)
			if (claim.protocol !== 'http') throw new CredentialStoreError('CREDENTIAL_USE_DENIED')
			const url = new URL(request.url),
				binding = claim.profile
			const host =
				binding.host.kind === 'exact'
					? url.hostname === binding.host.value
					: url.hostname !== binding.host.value && url.hostname.endsWith(`.${binding.host.value}`)
			const path =
				binding.pathPrefix === '/' ||
				url.pathname === binding.pathPrefix ||
				url.pathname.startsWith(
					binding.pathPrefix.endsWith('/') ? binding.pathPrefix : `${binding.pathPrefix}/`
				)
			if (
				!host ||
				!path ||
				!binding.methods.includes(request.method) ||
				binding.purpose !== use.purpose ||
				!binding.ports.includes(Number(url.port || 443))
			)
				throw new CredentialStoreError('CREDENTIAL_BINDING_MISMATCH')
			bytes = await ports.unsealer.unseal(claim.envelope, {
				environmentId: use.environmentId,
				ownerSubjectId: use.subjectId,
				credentialRef: use.credentialRef,
				kind: claim.kind,
				secretVersion: use.secretVersion
			})
			signal.throwIfAborted()
			// A claim consumes authority even if a later local check fails. Unknown wire
			// outcomes stay uncertain and cannot silently reuse the same authorization.
			const transport = new PinnedHttpResourceTransport({
				allowedOrigins: ports.allowedOrigins,
				localTestOrigins: ports.localTestOrigins,
				maximumBodyBytes: use.maximumBytes,
				maximumTimeMs: Math.min(120000, Math.max(1, Date.parse(use.expiresAt) - Date.now()))
			})
			const secret = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
			dispatched = true
			const exchange = await transport.exchange({
				request,
				signal,
				credential: {
					bindingRef: use.bindingRef,
					bindingRevision: use.bindingRevision,
					credentialRef: use.credentialRef,
					secretVersion: use.secretVersion,
					requestDigest: use.operationDigest,
					rule: binding.attachment,
					secret
				}
			})
			// Reject obvious provider reflection. This does not promise detection of
			// arbitrarily encoded secrets in remote content; disclosure policy still applies.
			const body = exchange.body
				? Buffer.from(await new Response(exchange.body).arrayBuffer())
				: Buffer.alloc(0)
			if (
				body.includes(Buffer.from(bytes)) ||
				JSON.stringify([...exchange.headers]).includes(secret)
			)
				throw new CredentialStoreError('CREDENTIAL_RESPONSE_REFLECTION_BLOCKED')
			let redirectLocation: string | null = null,
				redirectBlocked = false
			if (exchange.status >= 300 && exchange.status < 400 && exchange.headers.has('location')) {
				try {
					redirectLocation = parseHttpRequestArtifact({
						method: request.method,
						url: new URL(exchange.headers.get('location')!, request.url).toString()
					}).url
				} catch {
					redirectBlocked = true
				}
			}
			// Sending and releasing are separate decisions. A cancelled parent or ended
			// identity cannot publish a late result merely because the network succeeded.
			signal.throwIfAborted()
			await ports.verify(token)
			await ports.authorize(use)
			await store.claim(use, 0, unitDigest) // Recheck binding/version/revocation; replay releases no secret.
			await store.finish(use.authorizationId, 0, unitDigest, 'succeeded')
			return {
				outcome: 'captured' as const,
				status: exchange.status,
				protocol: exchange.protocol,
				headers: retainedResponseHeaders(exchange.headers),
				body,
				capturedAt: new Date().toISOString(),
				// Redirects are observations; the caller needs a newly admitted hop.
				redirectLocation,
				redirectBlocked
			}
		} catch {
			await store
				.finish(use.authorizationId, 0, unitDigest, dispatched ? 'uncertain' : 'failed')
				.catch(() => {})
			throw new CredentialStoreError('CREDENTIAL_HTTP_EXCHANGE_FAILED')
		} finally {
			bytes?.fill(0)
		}
	}
}
