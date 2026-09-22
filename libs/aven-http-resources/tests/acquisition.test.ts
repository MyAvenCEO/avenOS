import { describe, expect, test } from 'vitest'
import {
	acquireHttpResource,
	finalizedHttpResponseArtifact,
	type HttpAcquisitionDependencies,
	type HttpResourceTransport,
	type HttpResponseCandidate,
	httpResponseCacheKey
} from '../src/acquisition'
import { type HttpResponseArtifact, parseHttpRequestArtifact } from '../src/contracts'
import { type CredentialBinding, createMemoryCustomerVault } from '../src/vault'

const TENANT = '10000000-0000-4000-8000-000000000001'
const SUBJECT = '20000000-0000-4000-8000-000000000002'
const CREDENTIAL = '40000000-0000-4000-8000-000000000004'
const BINDING = '50000000-0000-4000-8000-000000000005'
const PRIOR = '80000000-0000-4000-8000-000000000008'
// Acquisition-unit observations only; actual header injection and socket policy
// are proved by the separate real HTTP/TLS transport tests.
function exchangeResult(
	observe: (input: Parameters<HttpResourceTransport['exchange']>[0]) => Promise<Response>
): HttpResourceTransport {
	return {
		async exchange(input) {
			const response = await observe(input)
			return {
				status: response.status,
				statusText: response.statusText,
				headers: response.headers,
				body: response.body
			}
		}
	}
}
const context = {
	tenantId: TENANT,
	subjectId: SUBJECT,
	sessionId: 'session-1',
	executionEnvironment: 'server' as const,
	artifactScope: { mode: 'production' as const, id: 'workshop' },
	runId: 'run-1',
	stepId: 'step-1'
}

const responsePayload: HttpResponseArtifact = {
	requestedUrl: 'https://api.example.com/reports/august',
	finalUrl: 'https://api.example.com/reports/august',
	statusCode: 200,
	cacheDisposition: 'new',
	declaredMediaType: 'application/pdf',
	declaredCharset: null,
	etag: '"report-v1"',
	lastModified: 'Sat, 30 Aug 2026 10:00:00 GMT',
	headers: [{ name: 'etag', values: ['"report-v1"'] }],
	redirectCount: 0,
	storedBodyLength: 12,
	capturedAt: '2026-08-30T10:00:00.000Z'
}

const candidate = (fresh: boolean): HttpResponseCandidate => ({
	artifactId: PRIOR,
	cacheKey: httpResponseCacheKey({
		tenantId: TENANT,
		subjectId: SUBJECT,
		executionEnvironment: 'server',
		artifactScope: context.artifactScope,
		credential: {
			credentialRef: CREDENTIAL,
			bindingRef: BINDING,
			bindingRevision: 1,
			secretVersion: 1
		},
		authenticationPurpose: 'report-read',
		policyRevision: 'test-policy-1',
		method: 'GET',
		url: responsePayload.requestedUrl,
		headers: [{ name: 'accept', value: 'application/pdf' }]
	}),
	payload: responsePayload,
	body: { sha256: 'a'.repeat(64), length: 12 },
	fresh
})

function mappedRequest() {
	return parseHttpRequestArtifact({
		method: 'GET',
		url: 'https://api.example.com/reports/august',
		headers: [{ name: 'accept', value: 'application/pdf' }],
		authentication: { mode: 'mapped-required', purpose: 'report-read' }
	})
}

function binding(): CredentialBinding {
	return {
		bindingRef: BINDING,
		label: 'Reports API',
		ownerSubjectId: SUBJECT,
		credentialRef: CREDENTIAL,
		placements: ['server'],
		schemes: ['https'],
		host: { kind: 'exact', value: 'api.example.com' },
		ports: [443],
		pathPrefix: '/reports/',
		methods: ['GET'],
		purpose: 'report-read',
		attachment: { kind: 'header', name: 'authorization', prefix: 'Bearer ' },
		enabled: true
	}
}

async function configuredVault() {
	const vault = createMemoryCustomerVault({ tenantId: TENANT })
	await vault.administration.setCredential({
		ownerSubjectId: SUBJECT,
		credentialRef: CREDENTIAL,
		label: 'Reports token',
		secret: 'secret-token'
	})
	await vault.administration.putBinding(binding())
	return vault
}

describe('HTTP acquisition', () => {
	test('withdraws a received body if authorization changes during the exchange', async () => {
		const vault = await configuredVault()
		let policyRevision = 'test-policy-1',
			cancelled = false
		await expect(
			acquireHttpResource({ ...mappedRequest(), freshness: 'new-capture' }, context, {
				vault: vault.sessions,
				access: { authorize: async () => ({ policyRevision }) },
				responses: {
					find: async () => {
						throw Error('new capture must not use the index')
					}
				},
				egress: { authorize: async () => {} },
				transport: {
					exchange: async () => {
						policyRevision = 'test-policy-2'
						return {
							status: 200,
							statusText: '',
							headers: new Headers(),
							body: new ReadableStream<Uint8Array>({
								cancel() {
									cancelled = true
								}
							})
						}
					}
				}
			})
		).rejects.toThrow('HTTP_POLICY_CHANGED')
		expect(cancelled).toBe(true)
	})

	test('rechecks exact artifact access after a 304 before releasing the old body', async () => {
		const vault = await configuredVault()
		let revoked = false,
			cancelled = false
		await expect(
			acquireHttpResource(mappedRequest(), context, {
				vault: vault.sessions,
				access: {
					authorize: async ({ artifactId }) => {
						if (artifactId && revoked) throw Error('ARTIFACT_ACCESS_REVOKED')
						return { policyRevision: 'test-policy-1' }
					}
				},
				responses: { find: async () => candidate(false) },
				egress: { authorize: async () => {} },
				transport: {
					exchange: async ({ conditional }) => {
						expect(conditional?.ifNoneMatch).toBe(responsePayload.etag)
						revoked = true
						return {
							status: 304,
							statusText: '',
							headers: new Headers(),
							body: new ReadableStream<Uint8Array>({
								cancel() {
									cancelled = true
								}
							})
						}
					}
				}
			})
		).rejects.toThrow('ARTIFACT_ACCESS_REVOKED')
		expect(cancelled).toBe(true)
	})

	test.each(['fresh', 'offline'] as const)(
		'requires current artifact access for %s cache selection',
		async (kind) => {
			const vault = await configuredVault()
			let checked = false
			await expect(
				acquireHttpResource(
					{ ...mappedRequest(), freshness: kind === 'offline' ? 'offline-only' : 'revalidate' },
					context,
					{
						vault: vault.sessions,
						access: {
							authorize: async ({ artifactId }) => {
								if (artifactId) {
									checked = true
									expect(artifactId).toBe(PRIOR)
									throw Error('ARTIFACT_ACCESS_REVOKED')
								}
								return { policyRevision: 'test-policy-1' }
							}
						},
						responses: { find: async () => candidate(kind === 'fresh') },
						egress: {
							authorize: async () => {
								throw Error('network must not run')
							}
						},
						transport: {
							exchange: async () => {
								throw Error('network must not run')
							}
						}
					}
				)
			).rejects.toThrow('ARTIFACT_ACCESS_REVOKED')
			expect(checked).toBe(true)
		}
	)

	test.each(['rotate', 'binding', 'policy', 'revoke', 'abort'] as const)(
		'does not release a cache hit when %s changes during lookup',
		async (change) => {
			const vault = await configuredVault(),
				abort = new AbortController()
			let policyRevision = 'test-policy-1'
			await expect(
				acquireHttpResource(
					mappedRequest(),
					context,
					{
						vault: vault.sessions,
						access: { authorize: async () => ({ policyRevision }) },
						responses: {
							find: async () => {
								if (change === 'rotate')
									await vault.administration.rotateCredential({
										ownerSubjectId: SUBJECT,
										credentialRef: CREDENTIAL,
										secret: 'replacement'
									})
								if (change === 'binding') await vault.administration.putBinding(binding())
								if (change === 'revoke')
									await vault.administration.revokeCredential(SUBJECT, CREDENTIAL)
								if (change === 'policy') policyRevision = 'test-policy-2'
								if (change === 'abort') abort.abort(Error('cancelled'))
								return candidate(true)
							}
						},
						egress: {
							authorize: async () => {
								throw Error('network must not run')
							}
						},
						transport: {
							exchange: async () => {
								throw Error('network must not run')
							}
						}
					},
					abort.signal
				)
			).rejects.toThrow(
				change === 'policy'
					? 'HTTP_POLICY_CHANGED'
					: change === 'revoke'
						? 'HTTP_CREDENTIAL_REQUIRED'
						: change === 'abort'
							? 'cancelled'
							: 'HTTP_CREDENTIAL_CHANGED'
			)
		}
	)

	test.each(['scope', 'placement', 'policy', 'secret', 'binding'] as const)(
		'cannot reuse or revalidate a prior %s partition',
		async (change) => {
			const vault = await configuredVault()
			if (change === 'secret')
				await vault.administration.rotateCredential({
					ownerSubjectId: SUBJECT,
					credentialRef: CREDENTIAL,
					secret: 'replacement'
				})
			if (change === 'binding') await vault.administration.putBinding(binding())
			if (change === 'placement')
				await vault.administration.putBinding({ ...binding(), placements: ['local', 'server'] })
			await expect(
				acquireHttpResource(
					mappedRequest(),
					{
						...context,
						...(change === 'scope' && {
							artifactScope: { mode: 'trial' as const, id: 'isolated-trial' }
						}),
						...(change === 'placement' && { executionEnvironment: 'local' as const })
					},
					{
						vault: vault.sessions,
						access: {
							authorize: async () => ({
								policyRevision: change === 'policy' ? 'test-policy-2' : 'test-policy-1'
							})
						},
						responses: { find: async () => candidate(false) },
						egress: {
							authorize: async () => {
								throw Error('network must not run')
							}
						},
						transport: {
							exchange: async () => {
								throw Error('network must not run')
							}
						}
					}
				)
			).rejects.toThrow('HTTP_CACHE_PARTITION_MISMATCH')
		}
	)

	test.each([
		{ name: 'vary', values: ['Accept, *'] },
		{ name: 'cache-control', values: ['private, no-store'] }
	])('does not automatically reuse $name responses', async (header) => {
		const vault = await configuredVault()
		await expect(
			acquireHttpResource({ ...mappedRequest(), freshness: 'offline-only' }, context, {
				vault: vault.sessions,
				access: { authorize: async () => ({ policyRevision: 'test-policy-1' }) },
				responses: {
					find: async () => ({
						...candidate(true),
						payload: { ...responsePayload, headers: [header] }
					})
				},
				egress: {
					authorize: async () => {
						throw Error('network must not run')
					}
				},
				transport: {
					exchange: async () => {
						throw Error('network must not run')
					}
				}
			})
		).rejects.toThrow('HTTP_OFFLINE_ARTIFACT_NOT_FOUND')
	})

	test('returns a fresh existing artifact without resolving or sending a credential', async () => {
		const vault = await configuredVault()
		let exchanges = 0
		const dependencies: HttpAcquisitionDependencies = {
			vault: vault.sessions,
			access: { authorize: async () => ({ policyRevision: 'test-policy-1' }) },
			responses: { find: async () => candidate(true) },
			egress: { authorize: async () => {} },
			transport: {
				exchange: async () => {
					exchanges += 1
					throw new Error('network must not run')
				}
			}
		}

		expect(await acquireHttpResource(mappedRequest(), context, dependencies)).toMatchObject({
			kind: 'existing-response',
			responseArtifactId: PRIOR,
			cacheDisposition: 'fresh-cache',
			capturedAt: responsePayload.capturedAt,
			fresh: true
		})
		expect(exchanges).toBe(0)
	})

	test.each([true, false])(
		'offline selection identifies reused data and its real freshness (%s)',
		async (fresh) => {
			const vault = await configuredVault()
			const selectedAt = '2026-09-03T08:15:00.000Z'
			const selected = await acquireHttpResource(
				{ ...mappedRequest(), freshness: 'offline-only' },
				context,
				{
					vault: vault.sessions,
					access: { authorize: async () => ({ policyRevision: 'test-policy-1' }) },
					responses: { find: async () => candidate(fresh) },
					egress: {
						authorize: async () => {
							throw Error('Offline selection must not open the network')
						}
					},
					transport: {
						exchange: async () => {
							throw Error('Offline selection must not open the network')
						}
					},
					now: () => new Date(selectedAt)
				}
			)
			expect(selected).toEqual({
				kind: 'existing-response',
				responseArtifactId: PRIOR,
				cacheDisposition: 'offline-cache',
				selectedAt,
				capturedAt: responsePayload.capturedAt,
				fresh
			})
		}
	)

	test('sends the exact ETag, injects the mapped header, and reuses the prior body on 304', async () => {
		const vault = await configuredVault()
		let sentAuthorization: string | null = null
		let sentEtag: string | null = null
		const transport = exchangeResult(async (input) => {
			sentAuthorization = input.credential?.secret ?? null
			sentEtag = input.conditional?.ifNoneMatch ?? null
			return new Response(null, {
				status: 304,
				headers: { etag: '"report-v1"', 'cache-control': 'private, max-age=60' }
			})
		})
		const acquired = await acquireHttpResource(mappedRequest(), context, {
			vault: vault.sessions,
			access: { authorize: async () => ({ policyRevision: 'test-policy-1' }) },
			responses: { find: async () => candidate(false) },
			egress: { authorize: async () => {} },
			transport,
			now: () => new Date('2026-08-30T12:30:00.000Z')
		})

		expect(sentAuthorization).toBe('secret-token')
		expect(sentEtag).toBe('"report-v1"')
		expect(acquired).toMatchObject({
			kind: 'capture',
			metadata: {
				statusCode: 200,
				networkStatusCode: 304,
				cacheDisposition: 'revalidated',
				representationSourceArtifactId: PRIOR,
				capturedAt: '2026-08-30T12:30:00.000Z'
			},
			body: { kind: 'existing', artifactId: PRIOR, sha256: 'a'.repeat(64), length: 12 },
			credential: {
				credentialRef: CREDENTIAL,
				bindingRef: BINDING,
				secretVersion: 1,
				attachmentKind: 'header'
			}
		})
		if (acquired.kind !== 'capture') return
		expect(JSON.stringify(acquired)).not.toContain('secret-token')
		expect(finalizedHttpResponseArtifact(acquired, 12).storedBodyLength).toBe(12)
	})

	test('captures non-success HTTP status and body as observed data', async () => {
		const vault = createMemoryCustomerVault({ tenantId: TENANT })
		const request = parseHttpRequestArtifact({
			method: 'HEAD',
			url: 'https://public.example.test/missing'
		})
		const acquired = await acquireHttpResource(request, context, {
			vault: vault.sessions,
			access: { authorize: async () => ({ policyRevision: 'test-policy-1' }) },
			responses: { find: async () => null },
			egress: { authorize: async () => {} },
			transport: exchangeResult(
				async () =>
					new Response(null, {
						status: 404,
						headers: { 'content-type': 'text/plain; charset=utf-8' }
					})
			)
		})

		expect(acquired).toMatchObject({
			kind: 'capture',
			metadata: {
				statusCode: 404,
				declaredMediaType: 'text/plain',
				declaredCharset: 'utf-8'
			},
			credential: null
		})
	})

	test('retains a cross-origin redirect without transmitting a second request', async () => {
		const vault = await configuredVault()
		const seen: Array<{ url: string; authorization: string | null }> = []
		const request = parseHttpRequestArtifact({
			...mappedRequest(),
			authentication: { mode: 'mapped-if-present', purpose: 'report-read' }
		})
		const acquired = await acquireHttpResource(request, context, {
			vault: vault.sessions,
			access: { authorize: async () => ({ policyRevision: 'test-policy-1' }) },
			responses: { find: async () => null },
			egress: { authorize: async () => {} },
			transport: exchangeResult(async (input) => {
				seen.push({
					url: input.request.url,
					authorization: input.credential?.secret ?? null
				})
				if (seen.length === 1) {
					return new Response(null, {
						status: 302,
						headers: { location: 'https://cdn.example.net/report.pdf' }
					})
				}
				return new Response('pdf bytes', {
					status: 200,
					headers: { 'content-type': 'application/pdf' }
				})
			})
		})

		expect(seen).toEqual([
			{
				url: 'https://api.example.com/reports/august',
				authorization: 'secret-token'
			}
		])
		expect(acquired).toMatchObject({
			kind: 'capture',
			metadata: {
				finalUrl: 'https://api.example.com/reports/august',
				redirectCount: 0,
				statusCode: 302,
				redirectStoppedReason: 'cross-origin-authentication'
			},
			credential: { credentialRef: CREDENTIAL }
		})
	})
})
