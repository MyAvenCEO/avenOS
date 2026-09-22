import { randomUUID } from 'node:crypto'
import type { ActorReviewRecord } from '@avenos/actors/review'
import type { StoredArtifact } from '@avenos/artifact-store'
import { credentialUseVerifier } from '@avenos/credential-storage/authority'
import { expect, test } from 'vitest'
import {
	type ConnectionExecution,
	ConnectionPolicy,
	type ConnectionPolicyPorts,
	type ConnectionPolicyScope
} from '../src/connections/policy'

/** Policy decision contract tests. Live SQL/HTTP/model evidence is separate. */
async function fixture(protocol: 'http' | 'imap' = 'http') {
	const keys = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify'])
	const expiresAt = new Date(Date.now() + 120000).toISOString()
	const scope: ConnectionPolicyScope = {
		environmentId: randomUUID(),
		subjectId: randomUUID(),
		sessionId: 'synthetic-session',
		generation: 1,
		expiresAt
	}
	const execution: ConnectionExecution = {
		runId: randomUUID(),
		leaseOwnerId: randomUUID(),
		invocationId: randomUUID(),
		callerActorId: 'ceo.aven:actor:test:orchard@1',
		capabilityId:
			protocol === 'http'
				? 'ceo.aven:capability:web.http-fetch:http_fetch_authenticated@1'
				: 'ceo.aven:capability:mail.imap-mailbox:imap_query@1',
		requestOccurrenceId: randomUUID(),
		requestArtifactDigest: 'b'.repeat(64),
		bindingRef: randomUUID(),
		parentInvocationIds: [],
		publicationScopeId: scope.environmentId,
		mode: 'productive',
		expiresAt
	}
	const credential = {
		credentialRef: randomUUID(),
		label: 'Invented orchard',
		kind: 'password',
		secretVersion: 1,
		enabled: true,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString()
	}
	const binding = {
		bindingRef: execution.bindingRef,
		credentialRef: credential.credentialRef,
		enabled: true,
		revision: 1,
		protocol,
		profile:
			protocol === 'http'
				? {
						label: 'Orchard reports',
						placements: ['server'],
						schemes: ['https'],
						host: { kind: 'exact', value: 'reports.example.test' },
						ports: [443],
						pathPrefix: '/reports',
						methods: ['GET', 'HEAD'],
						purpose: 'orchard-report',
						attachment: { kind: 'header', name: 'authorization', prefix: 'Bearer ' }
					}
				: {
						label: 'Orchard mail',
						host: 'mail.example.test',
						port: 993,
						tls: 'implicit',
						authentication: 'password',
						login: 'orchard@example.test',
						accountRef: randomUUID(),
						mailboxes: ['Projects'],
						operations: ['query', 'read-message'],
						purpose: 'orchard-report',
						maximumCommands: 24,
						maximumBytes: 1048576,
						maximumSeconds: 30
					}
	}
	const artifact: StoredArtifact = {
		artifactId: execution.requestOccurrenceId,
		scopeId: scope.environmentId,
		typeKey: protocol === 'http' ? 'web.http-request' : 'mail.imap-query',
		typeVersion: 1,
		artifactSha256: 'b'.repeat(64),
		publicationId: randomUUID(),
		scopeSequence: 1,
		committedAt: new Date().toISOString(),
		payload:
			protocol === 'http'
				? {
						url: 'https://reports.example.test/reports/weekly',
						method: 'GET',
						authentication: { mode: 'mapped-required', purpose: 'orchard-report' },
						freshness: 'new-capture',
						redirects: { mode: 'manual', maximumHops: 0 }
					}
				: { bindingRef: binding.bindingRef, mailbox: 'Projects', purpose: 'orchard-report' }
	}
	const selection = {
		environmentId: scope.environmentId,
		runId: execution.runId,
		invocationId: execution.invocationId,
		requestId: artifact.artifactId,
		bindingRef: binding.bindingRef
	}
	let review: ActorReviewRecord
	const ports: ConnectionPolicyPorts = {
		scope: async () => scope,
		execution: async () => execution,
		request: async () => artifact,
		metadata: async () => ({ credentials: [credential], bindings: [binding] }),
		review: async () => review
	}
	const policy = new ConnectionPolicy(
		'https://policy.example.test',
		keys.privateKey,
		{
			revision: 1,
			httpTargets: [{ origin: 'https://reports.example.test', pathPrefix: '/reports' }],
			imapOrigins: ['https://mail.example.test:993'],
			maximumBytes: 2097152,
			maximumSeconds: 60
		},
		ports
	)
	const proposal = await policy.prepare('identity', selection)
	review = {
		...proposal,
		id: randomUUID(),
		invocationId: execution.invocationId,
		revision: 1,
		runId: execution.runId,
		generation: 1,
		expiresAt,
		createdAt: new Date().toISOString(),
		superseded: false,
		eventVersion: 1,
		decision: {
			id: randomUUID(),
			outcome: 'approve',
			reviewerId: scope.subjectId,
			sessionId: 'earlier-session',
			decidedAt: new Date().toISOString()
		}
	}
	return { policy, scope, execution, credential, binding, artifact, selection, review, keys, ports }
}

test.each(['http', 'imap'] as const)(
	'issues exact %s authority only for the current reviewed operation',
	async (protocol) => {
		const f = await fixture(protocol)
		const first = await f.policy.issue('identity', f.selection, f.review.id)
		const verify = credentialUseVerifier('https://policy.example.test', f.keys.publicKey, protocol)
		expect(await verify(first.token)).toEqual(first.use)
		await expect(f.policy.assertCurrent('identity', first.use)).resolves.toBeUndefined()
		expect(first.use).toMatchObject({
			runId: f.execution.runId,
			leaseOwnerId: f.execution.leaseOwnerId,
			sessionId: f.scope.sessionId,
			protocol,
			reviewDecisionId: f.review.decision!.id,
			requestArtifactDigest: f.artifact.artifactSha256
		})
		expect(Date.parse(first.use.expiresAt) - Date.now()).toBeLessThanOrEqual(60000)
		if (protocol === 'imap') expect(first.use.maximumBytes).toBe(262144)
		const next = await f.policy.issue('identity', f.selection, f.review.id)
		expect(next.use.attemptId).toBe(first.use.attemptId)
		expect(next.use.authorizationId).not.toBe(first.use.authorizationId)
		// A new authorization cannot create a second protocol attempt: SQL enforces
		// (environment, invocation, attempt), including reauthentication and restart.
	}
)

test.each([
	'deny',
	'postpone',
	'none',
	'different-owner',
	'expired',
	'superseded',
	'tampered-subject',
	'wrong-schema',
	'wrong-generation'
])('does not turn %s review evidence into authority', async (change) => {
	const f = await fixture()
	const issued = await f.policy.issue('identity', f.selection, f.review.id)
	switch (change) {
		case 'deny':
			f.review.decision!.outcome = 'deny'
			break
		case 'postpone':
			f.review.decision!.outcome = 'postpone'
			break
		case 'none':
			f.review.decision = null
			break
		case 'different-owner':
			f.review.decision!.reviewerId = randomUUID()
			break
		case 'expired':
			f.review.expiresAt = new Date(Date.now() - 1).toISOString()
			break
		case 'superseded':
			f.review.superseded = true
			break
		case 'tampered-subject':
			f.review.subject = { ...f.review.subject, purpose: 'something-else' }
			break
		case 'wrong-schema':
			f.review.subjectSchema = 'wrong'
			break
		case 'wrong-generation':
			f.review.generation++
			break
	}
	await expect(f.policy.issue('identity', f.selection, f.review.id)).rejects.toThrow()
	await expect(f.policy.assertCurrent('identity', issued.use)).rejects.toThrow()
})
test.each([
	'credential-version',
	'binding-revision',
	'revoked',
	'scope',
	'caller',
	'parent',
	'expired-lease',
	'expired-session',
	'artifact-digest',
	'foreign-artifact',
	'redirect',
	'unapproved-route',
	'path-lookalike',
	'capability',
	'admitted-request',
	'admitted-digest',
	'admitted-binding'
])('rebuilds the review and rejects changed %s', async (change) => {
	const f = await fixture()
	const issued = await f.policy.issue('identity', f.selection, f.review.id)
	switch (change) {
		case 'capability':
			f.execution.capabilityId = 'ceo.aven:capability:mail.imap-mailbox:imap_query@1'
			break
		case 'admitted-request':
			f.execution.requestOccurrenceId = randomUUID()
			break
		case 'admitted-digest':
			f.execution.requestArtifactDigest = 'd'.repeat(64)
			break
		case 'admitted-binding':
			f.execution.bindingRef = randomUUID()
			break
		case 'credential-version':
			f.credential.secretVersion++
			break
		case 'binding-revision':
			f.binding.revision++
			break
		case 'revoked':
			f.credential.enabled = false
			break
		case 'scope':
			f.execution.publicationScopeId = randomUUID()
			break
		case 'caller':
			f.execution.callerActorId = 'ceo.aven:actor:test:other@1'
			break
		case 'parent':
			f.execution.parentInvocationIds.push(randomUUID())
			break
		case 'expired-lease':
			f.execution.expiresAt = new Date(Date.now() - 1).toISOString()
			break
		case 'expired-session':
			f.scope.expiresAt = new Date(Date.now() - 1).toISOString()
			break
		case 'artifact-digest':
			f.artifact.artifactSha256 = 'c'.repeat(64)
			break
		case 'foreign-artifact':
			f.artifact.scopeId = randomUUID()
			break
		case 'redirect':
			f.artifact.payload.redirects = { mode: 'follow', maximumHops: 1 }
			break
		case 'unapproved-route':
			f.artifact.payload.url = 'https://reports.example.test/echo'
			break
		case 'path-lookalike':
			f.artifact.payload.url = 'https://reports.example.test/reports-private'
			break
	}
	await expect(f.policy.issue('identity', f.selection, f.review.id)).rejects.toThrow()
	await expect(f.policy.assertCurrent('identity', issued.use)).rejects.toThrow()
})

test.each(['session', 'lease', 'decision', 'attempt', 'budget', 'expired'])(
	'rechecks %s immediately before an already signed use',
	async (change) => {
		const f = await fixture(),
			issued = await f.policy.issue('identity', f.selection, f.review.id)
		if (change === 'session') f.scope.sessionId = 'new-session'
		if (change === 'lease') f.execution.leaseOwnerId = randomUUID()
		if (change === 'decision') issued.use.reviewDecisionId = randomUUID()
		if (change === 'attempt') issued.use.attemptId = randomUUID()
		if (change === 'budget') issued.use.maximumBytes++
		if (change === 'expired') issued.use.expiresAt = new Date(Date.now() - 1).toISOString()
		await expect(f.policy.assertCurrent('identity', issued.use)).rejects.toThrow()
	}
)
test('new lease and refreshed session require live checks but do not invent a new attempt or blanket approval', async () => {
	const f = await fixture('imap')
	const first = await f.policy.issue('identity', f.selection, f.review.id)
	f.execution.leaseOwnerId = randomUUID()
	f.scope.sessionId = 'refreshed-session'
	const resumed = await f.policy.issue('fresh-identity', f.selection, f.review.id)
	expect(resumed.use.attemptId).toBe(first.use.attemptId)
	expect(resumed.use.leaseOwnerId).not.toBe(first.use.leaseOwnerId)
	expect(resumed.use.sessionId).toBe('refreshed-session')
	f.artifact.payload.mailbox = 'Personal'
	await expect(f.policy.issue('fresh-identity', f.selection, f.review.id)).rejects.toThrow()
})
