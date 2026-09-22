import { createHash } from 'node:crypto'
import {
	declaredContentType,
	type HttpRequestArtifact,
	type HttpRequestPolicy,
	type HttpResponseArtifact,
	httpRequestDigest,
	parseHttpRequestArtifact,
	retainedResponseHeaders
} from './contracts'
import {
	type CredentialSelection,
	credentialSelection,
	type RequestScopedCredentialAttachment,
	type SessionVaultClient,
	type VaultMatch,
	type VaultSessionContext
} from './vault'

export interface HttpResponseCandidate {
	artifactId: string
	/** Private index key, never public artifact content or caller-supplied authority. */
	cacheKey: string
	payload: HttpResponseArtifact
	body: {
		sha256: string
		length: number
	}
	/** The index computes HTTP freshness inside the exact private partition. */
	fresh: boolean
}

export interface HttpResponseLookup {
	tenantId: string
	subjectId: string
	executionEnvironment: VaultSessionContext['executionEnvironment']
	artifactScope: { mode: 'production' | 'trial'; id: string }
	credential: CredentialSelection | null
	authenticationPurpose: string | null
	/** Host-owned fingerprint of credential-use and response-release policies. */
	policyRevision: string
	method: HttpRequestArtifact['method']
	url: string
	headers: HttpRequestArtifact['headers']
}

export interface HttpResponseIndex {
	find(lookup: HttpResponseLookup): Promise<HttpResponseCandidate | null>
}

export interface HttpEgressPolicy {
	authorize(request: HttpRequestArtifact, context: VaultSessionContext): Promise<void>
}

/** Required for cached/offline reads too. This check does not open the network. */
export interface HttpResourceAccess {
	authorize(input: {
		request: HttpRequestArtifact
		context: HttpAcquisitionContext
		credential: CredentialSelection | null
		/** When present, verify current read access to this exact stored artifact. */
		artifactId?: string
	}): Promise<{ policyRevision: string }>
}

export function httpResponseCacheKey(lookup: HttpResponseLookup): string {
	// Fixed property order avoids different object construction order changing identity.
	return createHash('sha256')
		.update(
			JSON.stringify([
				lookup.tenantId,
				lookup.subjectId,
				lookup.executionEnvironment,
				lookup.artifactScope.mode,
				lookup.artifactScope.id,
				lookup.credential && [
					lookup.credential.bindingRef,
					lookup.credential.bindingRevision,
					lookup.credential.credentialRef,
					lookup.credential.secretVersion
				],
				lookup.authenticationPurpose,
				lookup.policyRevision,
				lookup.method,
				lookup.url,
				lookup.headers.map(({ name, value }) => [name, value])
			])
		)
		.digest('hex')
}

export interface HttpConditionalValidators {
	ifNoneMatch?: string
	ifModifiedSince?: string
}

export interface HttpTransportExchange {
	status: number
	statusText: string
	headers: Headers
	body: ReadableStream<Uint8Array> | null
	protocol?: string
}

/** Trusted transport port. Credential values never enter portable Actor payloads. */
export interface HttpResourceTransport {
	exchange(input: {
		request: HttpRequestArtifact
		credential?: RequestScopedCredentialAttachment
		conditional?: HttpConditionalValidators
		signal?: AbortSignal
	}): Promise<HttpTransportExchange>
}

export interface HttpAcquisitionContext extends VaultSessionContext {
	runId: string
	stepId: string
	/** Supplied by the trusted host from admitted execution, never from an Actor request. */
	artifactScope: HttpResponseLookup['artifactScope']
}

export type AcquiredHttpResource =
	| {
			kind: 'existing-response'
			responseArtifactId: string
			cacheDisposition: 'fresh-cache' | 'offline-cache'
			/** Selection is not a new observation of the remote resource. */
			selectedAt: string
			capturedAt: string
			fresh: boolean
	  }
	| {
			kind: 'capture'
			cacheKey: string
			metadata: Omit<HttpResponseArtifact, 'storedBodyLength'>
			body:
				| { kind: 'stream'; stream: ReadableStream<Uint8Array>; declaredLength: number | null }
				| { kind: 'existing'; artifactId: string; sha256: string; length: number }
			credential: {
				credentialRef: string
				bindingRef: string
				bindingRevision: number
				secretVersion: number
				attachmentKind: 'header' | 'cookie' | 'query'
			} | null
	  }

export interface HttpAcquisitionDependencies {
	vault: SessionVaultClient
	access: HttpResourceAccess
	responses: HttpResponseIndex
	egress: HttpEgressPolicy
	transport: HttpResourceTransport
	requestPolicy?: HttpRequestPolicy
	now?: () => Date
}

/**
 * Execute one read-only HTTP observation with customer/session credential routing.
 * The returned stream or prior-body reference must be committed by the host Artifact Store adapter.
 */
export async function acquireHttpResource(
	input: unknown,
	context: HttpAcquisitionContext,
	dependencies: HttpAcquisitionDependencies,
	signal?: AbortSignal
): Promise<AcquiredHttpResource> {
	assertContext(context)
	signal?.throwIfAborted()
	const request = parseHttpRequestArtifact(input, dependencies.requestPolicy)
	const initialMatch = await credentialMatch(request, context, dependencies.vault)
	const credential = credentialSelection(initialMatch)
	const initialAccess = await dependencies.access.authorize({ request, context, credential })
	if (
		typeof initialAccess.policyRevision !== 'string' ||
		!initialAccess.policyRevision.trim() ||
		initialAccess.policyRevision.length > 256
	)
		throw new HttpAcquisitionError('HTTP_POLICY_REVISION_REQUIRED')
	const lookup: HttpResponseLookup = {
		tenantId: context.tenantId,
		subjectId: context.subjectId,
		executionEnvironment: context.executionEnvironment,
		artifactScope: { ...context.artifactScope },
		credential,
		authenticationPurpose: request.authentication.purpose ?? null,
		policyRevision: initialAccess.policyRevision,
		method: request.method,
		url: request.url,
		headers: structuredClone(request.headers)
	}
	const cacheKey = httpResponseCacheKey(lookup)
	const found =
		request.freshness === 'new-capture' ? null : await dependencies.responses.find(lookup)
	if (found && found.cacheKey !== cacheKey)
		throw new HttpAcquisitionError('HTTP_CACHE_PARTITION_MISMATCH')
	const candidate = found && reusableResponse(found.payload) ? found : null
	const assertCurrent = async (
		current: HttpRequestArtifact,
		match: VaultMatch,
		artifactId?: string
	) => {
		signal?.throwIfAborted()
		const credential = credentialSelection(match)
		const access = await dependencies.access.authorize({
			request: current,
			context,
			credential,
			...(artifactId && { artifactId })
		})
		if (access.policyRevision !== lookup.policyRevision)
			throw new HttpAcquisitionError('HTTP_POLICY_CHANGED')
		const selected = credentialSelection(
			await credentialMatch(current, context, dependencies.vault)
		)
		if (JSON.stringify(selected) !== JSON.stringify(credential))
			throw new HttpAcquisitionError('HTTP_CREDENTIAL_CHANGED')
		signal?.throwIfAborted()
	}
	await assertCurrent(request, initialMatch, candidate?.artifactId)
	if (request.freshness === 'offline-only') {
		if (!candidate) throw new HttpAcquisitionError('HTTP_OFFLINE_ARTIFACT_NOT_FOUND')
		return {
			kind: 'existing-response',
			responseArtifactId: candidate.artifactId,
			cacheDisposition: 'offline-cache',
			selectedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
			capturedAt: candidate.payload.capturedAt,
			fresh: candidate.fresh
		}
	}
	if (candidate?.fresh) {
		return {
			kind: 'existing-response',
			responseArtifactId: candidate.artifactId,
			cacheDisposition: 'fresh-cache',
			selectedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
			capturedAt: candidate.payload.capturedAt,
			fresh: true
		}
	}

	const validators = candidate ? conditionalValidators(candidate.payload) : undefined
	let current = request
	let match = initialMatch
	let redirectCount = 0
	let lastCredential: Extract<AcquiredHttpResource, { kind: 'capture' }>['credential'] = null

	while (true) {
		signal?.throwIfAborted()
		await dependencies.egress.authorize(current, context)
		await assertCurrent(current, match)
		const credential = await credentialForUse(current, match, context, dependencies.vault)
		lastCredential = credential
			? {
					credentialRef: credential.credentialRef,
					bindingRef: credential.bindingRef,
					bindingRevision: credential.bindingRevision,
					secretVersion: credential.secretVersion,
					attachmentKind: credential.rule.kind
				}
			: null
		const exchange = await dependencies.transport.exchange({
			request: current,
			...(credential && { credential }),
			...(validators && candidate?.payload.finalUrl === current.url
				? { conditional: validators }
				: {}),
			...(signal && { signal })
		})
		try {
			await assertCurrent(
				current,
				match,
				exchange.status === 304 ? candidate?.artifactId : undefined
			)
		} catch (error) {
			await exchange.body?.cancel()
			throw error
		}
		if (isRedirect(exchange.status) && request.redirects.mode === 'follow') {
			if (redirectCount >= request.redirects.maximumHops) {
				await exchange.body?.cancel()
				throw new HttpAcquisitionError('HTTP_REDIRECT_LIMIT_EXCEEDED')
			}
			const location = exchange.headers.get('location')
			if (!location)
				return capture(
					exchange,
					request,
					current,
					redirectCount,
					lastCredential,
					dependencies,
					cacheKey,
					'missing-location'
				)
			const nextUrl = new URL(location, current.url)
			// Crossing origins is a separately admitted observation, not permission
			// to forward or opportunistically pick a second credential.
			if (
				request.authentication.mode !== 'anonymous' &&
				nextUrl.origin !== new URL(current.url).origin
			)
				return capture(
					exchange,
					request,
					current,
					redirectCount,
					lastCredential,
					dependencies,
					cacheKey,
					'cross-origin-authentication'
				)
			const next = parseHttpRequestArtifact(
				{ ...current, url: nextUrl.toString() },
				dependencies.requestPolicy
			)
			await exchange.body?.cancel()
			const nextMatch = await credentialMatch(next, context, dependencies.vault)
			if (
				(match.outcome === 'matched' || nextMatch.outcome === 'matched') &&
				(match.outcome !== 'matched' ||
					nextMatch.outcome !== 'matched' ||
					match.binding.bindingRef !== nextMatch.binding.bindingRef ||
					match.binding.revision !== nextMatch.binding.revision ||
					match.credentialRef !== nextMatch.credentialRef ||
					match.secretVersion !== nextMatch.secretVersion)
			)
				throw new HttpAcquisitionError('HTTP_REDIRECT_CREDENTIAL_CHANGED')
			current = next
			redirectCount += 1
			match = nextMatch
			continue
		}
		if (exchange.status === 304) {
			await exchange.body?.cancel()
			if (!candidate || !validators || candidate.payload.finalUrl !== current.url)
				throw new HttpAcquisitionError('HTTP_304_WITHOUT_CANDIDATE')
			const metadata = responseMetadata({
				requested: request,
				finalRequest: current,
				exchange,
				redirectCount,
				capturedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
				statusCode: candidate.payload.statusCode,
				networkStatusCode: 304,
				cacheDisposition: 'revalidated',
				representationSourceArtifactId: candidate.artifactId,
				fallback: candidate.payload
			})
			return {
				kind: 'capture',
				cacheKey,
				metadata,
				body: {
					kind: 'existing',
					artifactId: candidate.artifactId,
					sha256: candidate.body.sha256,
					length: candidate.body.length
				},
				credential: lastCredential
			}
		}
		return capture(
			exchange,
			request,
			current,
			redirectCount,
			lastCredential,
			dependencies,
			cacheKey,
			isRedirect(exchange.status) ? 'manual' : undefined
		)
	}
}

function capture(
	exchange: HttpTransportExchange,
	requested: HttpRequestArtifact,
	finalRequest: HttpRequestArtifact,
	redirectCount: number,
	credential: Extract<AcquiredHttpResource, { kind: 'capture' }>['credential'],
	dependencies: HttpAcquisitionDependencies,
	cacheKey: string,
	redirectStoppedReason?: HttpResponseArtifact['redirectStoppedReason']
): Extract<AcquiredHttpResource, { kind: 'capture' }> {
	const declaredLength =
		requested.method === 'HEAD' || exchange.status === 204 ? 0 : contentLength(exchange.headers)
	return {
		kind: 'capture',
		cacheKey,
		metadata: responseMetadata({
			requested,
			finalRequest,
			exchange,
			redirectCount,
			capturedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
			statusCode: exchange.status,
			cacheDisposition: 'new',
			...(redirectStoppedReason && { redirectStoppedReason })
		}),
		body: {
			kind: 'stream',
			stream: exchange.body ?? emptyBody(),
			declaredLength
		},
		credential
	}
}

function responseMetadata(input: {
	requested: HttpRequestArtifact
	finalRequest: HttpRequestArtifact
	exchange: HttpTransportExchange
	redirectCount: number
	redirectStoppedReason?: HttpResponseArtifact['redirectStoppedReason']
	capturedAt: string
	statusCode: number
	networkStatusCode?: number
	cacheDisposition: HttpResponseArtifact['cacheDisposition']
	representationSourceArtifactId?: string
	fallback?: HttpResponseArtifact
}): Omit<HttpResponseArtifact, 'storedBodyLength'> {
	const declared = declaredContentType(input.exchange.headers)
	const retained = retainedResponseHeaders(input.exchange.headers)
	return {
		requestedUrl: input.requested.url,
		finalUrl: input.finalRequest.url,
		statusCode: input.statusCode,
		...(input.networkStatusCode !== undefined && { networkStatusCode: input.networkStatusCode }),
		cacheDisposition: input.cacheDisposition,
		...(input.representationSourceArtifactId && {
			representationSourceArtifactId: input.representationSourceArtifactId
		}),
		...(input.exchange.protocol && { protocol: input.exchange.protocol }),
		declaredMediaType: declared.mediaType ?? input.fallback?.declaredMediaType ?? null,
		declaredCharset: declared.charset ?? input.fallback?.declaredCharset ?? null,
		etag: input.exchange.headers.get('etag') ?? input.fallback?.etag ?? null,
		lastModified:
			input.exchange.headers.get('last-modified') ?? input.fallback?.lastModified ?? null,
		headers: mergeRetainedHeaders(input.fallback?.headers ?? [], retained),
		redirectCount: input.redirectCount,
		...(input.redirectStoppedReason && { redirectStoppedReason: input.redirectStoppedReason }),
		capturedAt: input.capturedAt
	}
}

function mergeRetainedHeaders(
	prior: HttpResponseArtifact['headers'],
	observed: HttpResponseArtifact['headers']
): HttpResponseArtifact['headers'] {
	const merged = new Map(prior.map((header) => [header.name, structuredClone(header)]))
	for (const header of observed) merged.set(header.name, structuredClone(header))
	return [...merged.values()].sort((left, right) => left.name.localeCompare(right.name))
}

export function finalizedHttpResponseArtifact(
	acquisition: Extract<AcquiredHttpResource, { kind: 'capture' }>,
	storedBodyLength: number
): HttpResponseArtifact {
	if (!Number.isSafeInteger(storedBodyLength) || storedBodyLength < 0) {
		throw new HttpAcquisitionError('HTTP_STORED_LENGTH_INVALID')
	}
	if (acquisition.body.kind === 'existing' && acquisition.body.length !== storedBodyLength) {
		throw new HttpAcquisitionError('HTTP_REUSED_LENGTH_MISMATCH')
	}
	if (
		acquisition.body.kind === 'stream' &&
		acquisition.body.declaredLength !== null &&
		acquisition.body.declaredLength !== storedBodyLength
	)
		throw new HttpAcquisitionError('HTTP_CAPTURE_LENGTH_MISMATCH')
	return { ...acquisition.metadata, storedBodyLength }
}

async function credentialMatch(
	request: HttpRequestArtifact,
	context: VaultSessionContext,
	vault: SessionVaultClient
): Promise<VaultMatch> {
	if (request.authentication.mode === 'anonymous') return { outcome: 'none' }
	const match = await vault.match(request, context)
	if (match.outcome === 'ambiguous') throw new HttpAcquisitionError('HTTP_CREDENTIAL_AMBIGUOUS')
	if (match.outcome === 'none' && request.authentication.mode === 'mapped-required') {
		throw new HttpAcquisitionError('HTTP_CREDENTIAL_REQUIRED')
	}
	return match
}

async function credentialForUse(
	request: HttpRequestArtifact,
	match: VaultMatch,
	context: HttpAcquisitionContext,
	vault: SessionVaultClient
): Promise<RequestScopedCredentialAttachment | undefined> {
	const selection = credentialSelection(match)
	if (!selection) return undefined
	return vault.resolveForUse({
		selection,
		request,
		requestDigest: httpRequestDigest(request),
		runId: context.runId,
		stepId: context.stepId,
		context
	})
}

function conditionalValidators(
	payload: HttpResponseArtifact
): HttpConditionalValidators | undefined {
	if (payload.etag) return { ifNoneMatch: payload.etag }
	if (payload.lastModified) return { ifModifiedSince: payload.lastModified }
	return undefined
}

function reusableResponse(payload: HttpResponseArtifact): boolean {
	const values = (name: string) =>
		payload.headers.filter((h) => h.name === name).flatMap((h) => h.values)
	return (
		!values('vary').some((v) => v.split(',').some((name) => name.trim() === '*')) &&
		!values('cache-control').some((v) => /(?:^|,)\s*no-store(?:\s|,|$)/i.test(v))
	)
}

function isRedirect(status: number): boolean {
	return [301, 302, 303, 307, 308].includes(status)
}

function contentLength(headers: Headers): number | null {
	const raw = headers.get('content-length')
	if (raw === null || !/^\d+$/.test(raw)) return null
	const value = Number(raw)
	return Number.isSafeInteger(value) ? value : null
}

function emptyBody(): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(controller) {
			controller.close()
		}
	})
}

function assertContext(context: HttpAcquisitionContext): void {
	if (
		!context.runId ||
		!context.stepId ||
		!context.sessionId ||
		!context.tenantId ||
		!context.subjectId ||
		!['local', 'server'].includes(context.executionEnvironment) ||
		!context.artifactScope?.id ||
		!['production', 'trial'].includes(context.artifactScope.mode)
	) {
		throw new HttpAcquisitionError('HTTP_SESSION_CONTEXT_REQUIRED')
	}
}

export class HttpAcquisitionError extends Error {
	constructor(readonly code: string) {
		super(code)
	}

	/** Safe cause/next-step information; never includes remote headers, URLs or secrets. */
	get diagnostic(): {
		explanation: string
		recovery: 'new-authorized-acquisition' | 'fix-host-index' | 'none'
	} {
		switch (this.code) {
			case 'HTTP_CREDENTIAL_CHANGED':
			case 'HTTP_REDIRECT_CREDENTIAL_CHANGED':
				return {
					explanation:
						'The selected credential or binding changed during this acquisition. No response body is released. This does not mean that the remote provider rejected the new key.',
					recovery: 'new-authorized-acquisition'
				}
			case 'HTTP_POLICY_CHANGED':
				return {
					explanation:
						'The host access policy changed during this acquisition. No response body is released. A new operation needs a current authorization decision.',
					recovery: 'new-authorized-acquisition'
				}
			case 'HTTP_CACHE_PARTITION_MISMATCH':
				return {
					explanation:
						'The index returned a response from a different credential, permission or execution partition. Its data and validators were not reused. Do not change customer credentials to repair this index error.',
					recovery: 'fix-host-index'
				}
			case 'HTTP_CREDENTIAL_REQUIRED':
				return {
					explanation:
						'No currently usable credential binding matches this request. No secret or cached content is released; the missing binding is not proof of a remote login failure.',
					recovery: 'none'
				}
			case 'HTTP_OFFLINE_ARTIFACT_NOT_FOUND':
				return {
					explanation:
						'There is no eligible stored response for this authorized offline request. No network access is permitted by this request.',
					recovery: 'none'
				}
			default:
				return {
					explanation:
						'The HTTP acquisition could not return an accepted response. Do not treat the failure as an empty resource or a successful request.',
					recovery: 'none'
				}
		}
	}
}
