import { ArtifactStoreClient, ArtifactStoreProblem } from '@avenos/artifact-store'
import { type TenantGrantKey, verifyTenantGrant } from '@avenos/aven-customer-contracts'
import type { WorkGrantClient } from '@avenos/aven-customer-runtime'
import { readBoundedBytes } from '@avenos/http-boundary'
import { z } from 'zod'

const component = 'ceo.aven:component:data:artifacts@1'
// The Store's Problem contract uses RESOURCE_UNAVAILABLE for an absent record,
// not the facade's ARTIFACT_NOT_FOUND. Preserve machine-readable read failures
// while replacing upstream detail, which may contain physical storage names.
const safeProblems = new Set([
	'RESOURCE_UNAVAILABLE',
	'MALFORMED_REQUEST',
	'STORE_EPOCH_CHANGED',
	'FEED_REBOOTSTRAP_REQUIRED',
	'LIMIT_EXCEEDED',
	'CONTENT_RANGE_NOT_SATISFIABLE',
	'STORE_RECONCILIATION_REQUIRED',
	'INTEGRITY_FAILURE',
	'UPLOAD_EXPIRED',
	'UPLOAD_CONFLICT',
	'PUBLICATION_CONFLICT',
	'PUBLICATION_DATA_LOST',
	'UPLOAD_DIGEST_MISMATCH',
	'INPUT_UNAVAILABLE',
	'SCHEMA_VALIDATION_FAILED',
	'INVALID_EVIDENCE',
	'LOCAL_REFERENCE_ORDER',
	'STAGING_QUOTA_EXCEEDED'
])

// The Store returns this only from its catalog precondition, before it parses or
// commits a write. Unlike an unstructured 5xx or transport loss, this response is
// positive evidence that the mutation was rejected and is safe to report as such.
const definiteWriteRejections = new Set(['STORE_RECONCILIATION_REQUIRED'])

interface ArtifactWorkHost {
	baseUrl: string
	serviceToken: string
	environmentId: string
	generation: number
	issuer: string
	publicKey: TenantGrantKey
	authority: WorkGrantClient
	signal?: AbortSignal
}
/** A transport failure after dispatch is not evidence that a publication failed.
 * The journal must resolve the original publication, never generate a new ID. */
export class ArtifactWorkOutcomeUncertain extends Error {
	readonly outcome = 'uncertain' as const
	constructor() {
		super(
			'The artifact operation may have been saved. Check its original receipt before continuing.'
		)
	}
}

/** Read transport for one admitted chat turn, not an arbitrary URL proxy.
 * The Store trusts this service credential as it trusts the interactive facade;
 * this adapter must obtain fresh, exact delegated authority before EVERY request.
 * Publication is deliberately unavailable until operation receipts are integrated.
 */
export function createWorkArtifactReader(host: ArtifactWorkHost): ArtifactStoreClient {
	return artifactWorkClient(host)
}

/** Host-only publication transport. Installed Actors retain their own stable
 * publication identity and the Store enforces exact immutable replay. This does
 * not expose publication to Chat without an operation receipt resolver. */
export function createWorkArtifactPublisher(
	host: ArtifactWorkHost & { subjectId: string }
): ArtifactStoreClient {
	z.uuid().parse(host.subjectId)
	return artifactWorkClient(host, host.subjectId)
}

function artifactWorkClient(
	host: ArtifactWorkHost,
	publisherSubject?: string
): ArtifactStoreClient {
	const base = new URL(host.baseUrl)
	z.uuid().parse(host.environmentId)
	if (
		!['http:', 'https:'].includes(base.protocol) ||
		base.username ||
		base.password ||
		base.search ||
		base.hash ||
		base.pathname !== '/' ||
		host.serviceToken.length < 32 ||
		!Number.isSafeInteger(host.generation) ||
		host.generation < 1
	)
		throw Error('Invalid artifact work transport configuration.')
	const prefix = `/v1/scopes/${host.environmentId}/`
	return new ArtifactStoreClient({
		baseUrl: base.origin,
		bearerToken: () => host.serviceToken,
		fetch: async (input, init) => {
			const url = new URL(String(input))
			const method = init?.method ?? 'GET'
			const writing = method === 'PUT' && publisherSubject !== undefined
			const path = url.pathname.slice(prefix.length)
			const writePath = /^(uploads|publications)\/([0-9a-f-]{36})$/.exec(path)
			// The typed client constructs these routes. Do not turn a future adapter
			// into a cross-scope or administrative service-credential escape hatch.
			if (
				(method !== 'GET' && !writing) ||
				url.origin !== base.origin ||
				url.username ||
				url.password ||
				url.hash ||
				url.href.length > 16_384 ||
				!(
					url.pathname.startsWith(prefix) ||
					url.pathname === '/v1/context' ||
					/^\/v1\/types\/[^/]+\/versions\/[1-9]\d*$/.test(url.pathname)
				) ||
				(writing && (!url.pathname.startsWith(prefix) || !writePath || url.search))
			)
				throw Error(
					publisherSubject
						? 'This conversation transport permits only same-workspace reads and immutable publication.'
						: 'This conversation transport permits only same-workspace artifact reads.'
				)
			let body: Uint8Array | undefined
			const headers = new Headers({ 'accept-encoding': 'identity' })
			if (writing) {
				z.uuid().parse(writePath![2])
				const supplied = new Headers(init?.headers)
				const request = new Request(url, init)
				body = await readBoundedBytes(
					request,
					writePath![1] === 'uploads' ? 16 * 1024 * 1024 : 2 * 1024 * 1024,
					5000
				)
				headers.set('content-type', supplied.get('content-type') ?? 'application/octet-stream')
				headers.set('content-length', String(body.length))
				if (writePath![1] === 'uploads') {
					const declared = supplied.get('content-length')
					if (declared !== String(body.length))
						throw Error('Artifact upload length does not match its declaration.')
					headers.set(
						'x-expected-sha256',
						z
							.string()
							.regex(/^[a-f0-9]{64}$/)
							.parse(supplied.get('x-expected-sha256'))
					)
				} else {
					const submission = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body))
					const intent = submission?.intent
					if (
						intent?.scopeId !== host.environmentId ||
						intent?.publicationId !== writePath![2] ||
						intent?.kind !== 'run' ||
						intent?.run?.initiator?.kind !== 'user' ||
						intent.run.initiator.id !== `user:${publisherSubject}`
					)
						throw Error('Artifact publication must describe the admitted user and workspace.')
					headers.set(
						'if-artifact-store-epoch',
						z.uuid().parse(supplied.get('if-artifact-store-epoch'))
					)
				}
			}
			host.signal?.throwIfAborted()
			const action = writing ? 'artifacts:write' : 'artifacts:read'
			const token = await host.authority.grant(component, [action], host.signal)
			const grant = await verifyTenantGrant(token, host.publicKey, {
				issuer: host.issuer,
				audience: component,
				action
			})
			if (
				!grant.execution ||
				grant.environmentId !== host.environmentId ||
				grant.routingGeneration !== host.generation ||
				grant.exp <= Date.now() / 1000 ||
				(publisherSubject && grant.sub !== publisherSubject)
			)
				throw Error('Artifact work authority does not match this workspace.')
			host.signal?.throwIfAborted()
			headers.set('authorization', `Bearer ${host.serviceToken}`)
			headers.set('x-aven-artifact-database', grant.databaseName)
			headers.set('x-aven-environment', grant.environmentId)
			headers.set('x-aven-routing-generation', String(grant.routingGeneration))
			let response: Response
			try {
				response = await fetch(url, {
					method,
					redirect: 'manual',
					body: body ? Uint8Array.from(body).buffer : undefined,
					headers,
					signal: host.signal
						? AbortSignal.any([host.signal, AbortSignal.timeout(30_000)])
						: AbortSignal.timeout(30_000)
				})
			} catch (error) {
				if (writing) throw new ArtifactWorkOutcomeUncertain()
				throw error
			}
			if (!response.ok) {
				let code = writing ? 'ARTIFACT_WRITE_REJECTED' : 'ARTIFACT_READ_UNAVAILABLE'
				try {
					const problem = JSON.parse(
						new TextDecoder().decode(await readBoundedBytes(response, 4096, 5000))
					)
					if (safeProblems.has(problem.code)) code = problem.code
				} catch {
					/* Never expose an arbitrary upstream error body. */
				}
				if (
					writing &&
					(response.status >= 500 || (response.status >= 300 && response.status < 400)) &&
					!definiteWriteRejections.has(code)
				) {
					throw new ArtifactWorkOutcomeUncertain()
				}
				throw new ArtifactStoreProblem(
					response.status,
					code,
					response.status === 404
						? 'The requested artifact record was not found.'
						: writing
							? 'The artifact operation was rejected.'
							: 'The artifact read could not be completed.'
				)
			}
			let bytes: Uint8Array
			try {
				bytes = await readBoundedBytes(
					response,
					url.pathname.endsWith('/content') ? 16 * 1024 * 1024 : 2 * 1024 * 1024
				)
			} catch (error) {
				if (writing) throw new ArtifactWorkOutcomeUncertain()
				throw error
			}
			if (writing) {
				try {
					const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
					if (!result || typeof result !== 'object' || Array.isArray(result))
						throw Error('Invalid write acknowledgement.')
				} catch {
					throw new ArtifactWorkOutcomeUncertain()
				}
			}
			return new Response(Uint8Array.from(bytes).buffer, {
				status: response.status,
				headers: {
					'content-type': response.headers.get('content-type') ?? 'application/octet-stream'
				}
			})
		}
	})
}
