import type { ActorReviewRecord } from '@avenos/actors/review'
import { ArtifactRunStore, ArtifactStoreClient, clientRunIdentity } from '@avenos/artifact-store'
import { type TenantGrantKey, verifyTenantGrant } from '@avenos/aven-customer-contracts'
import type { IdentityVerifier } from '@avenos/aven-identity'
import { readBoundedBytes } from '@avenos/http-boundary'
import { z } from 'zod'
import type { FacadeConfig } from '../config'
import type { CustomerHandler } from '../customers/handler'
import { RuntimeDirectory } from '../customers/runtime-directory'
import type { ConnectionPolicyPorts, ConnectionPolicyScope } from './policy'

const components = {
	credentials: 'ceo.aven:component:data:credentials@1',
	'actor-runs': 'os.aven:component:actors:run-repository@1',
	artifacts: 'ceo.aven:component:data:artifacts@1'
} as const
const invocationSchema = z
	.object({
		environmentId: z.uuid(),
		generation: z.number().int().positive(),
		subjectId: z.uuid(),
		sessionId: z.string(),
		runId: z.uuid(),
		leaseOwnerId: z.uuid(),
		invocationId: z.uuid(),
		stepId: z.string().min(1).max(1024),
		definitionRef: z.string().min(1),
		capabilityId: z.string().min(1),
		parameters: z.record(z.string(), z.unknown()),
		inputs: z
			.array(
				z
					.object({
						slot: z.string(),
						artifactId: z.uuid(),
						artifactDigest: z.string().regex(/^[a-f0-9]{64}$/),
						type: z.string(),
						version: z.number().int().positive()
					})
					.strict()
			)
			.max(64),
		expiresAt: z.iso.datetime({ offset: true })
	})
	.strict()
const deny = () => Error('CONNECTION_POLICY_DEPENDENCY_DENIED')

/** One identity-bound policy evaluation. No global token cache or caller-selected
 * service URL. Every component access obtains a fresh entitlement-backed grant and
 * follows current operator placement; cross-generation/placement mixtures fail. */
export function connectionPolicyPorts(
	config: FacadeConfig,
	verifier: Pick<IdentityVerifier, 'verify'>,
	customers: Pick<CustomerHandler, 'grant'>,
	tenantPublicKey: TenantGrantKey,
	identityToken: string,
	signal?: AbortSignal,
	fetcher: typeof fetch = fetch
): ConnectionPolicyPorts {
	const directory = new RuntimeDirectory(config)
	let admitted:
		| {
				environmentId: string
				subjectId: string
				sessionId: string
				generation: number
				databaseName: string
				runtimeId: string
		  }
		| undefined
	async function access(environmentId: string, segment: keyof typeof components) {
		signal?.throwIfAborted()
		const identity = await verifier.verify(identityToken)
		if (
			identity.exp * 1000 <= Date.now() ||
			!identity.amr.includes('passkey') ||
			!identity.scope.split(/\s+/).includes('services:access')
		)
			throw deny()
		const action = `${segment}:read`
		const issued = await customers.grant({
			claims: identity,
			environmentId,
			componentRef: components[segment],
			actions: [action]
		})
		const grant = await verifyTenantGrant(issued.token, tenantPublicKey, {
			issuer: config.API_PUBLIC_BASE_URL,
			audience: components[segment],
			action
		})
		const current = {
			environmentId: grant.environmentId,
			subjectId: grant.sub,
			sessionId: grant.sid,
			generation: grant.routingGeneration,
			databaseName: grant.databaseName,
			runtimeId: issued.runtimeId
		}
		if (
			grant.environmentId !== environmentId ||
			grant.sub !== identity.sub ||
			grant.sid !== identity.sid ||
			(admitted &&
				Object.entries(admitted).some(
					([key, value]) => current[key as keyof typeof current] !== value
				))
		)
			throw deny()
		admitted = current
		const runtime = (await directory.read()).find((entry) => entry.id === issued.runtimeId)
		const primary = issued.runtimeId === 'primary' && !runtime && !config.CUSTOMER_RUNTIMES_FILE
		const target =
			runtime?.targets.find((entry) => entry.segment === segment) ??
			(primary
				? config.CUSTOMER_DOWNSTREAMS_JSON.find((entry) => entry.segment === segment)
				: undefined)
		if (
			!target ||
			target.componentRef !== components[segment] ||
			!target.roles.includes(identity.role)
		)
			throw deny()
		const expiresAt = new Date(1000 * Math.min(identity.exp, grant.exp)).toISOString()
		if (Date.parse(expiresAt) <= Date.now()) throw deny()
		return { current, identity, grant, token: issued.token, target, runtime, primary, expiresAt }
	}
	const check = (scope: ConnectionPolicyScope, current: NonNullable<typeof admitted>) => {
		for (const key of ['environmentId', 'subjectId', 'sessionId', 'generation'] as const)
			if (scope[key] !== current[key]) throw deny()
	}
	async function request(
		scope: ConnectionPolicyScope,
		segment: 'actor-runs' | 'credentials',
		path: string,
		body?: unknown
	) {
		const bound = await access(scope.environmentId, segment)
		check(scope, bound.current)
		const response = await fetcher(new URL(path, bound.target.baseUrl), {
			method: body === undefined ? 'GET' : 'POST',
			redirect: 'manual',
			signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(5000)]),
			headers: {
				authorization: `Bearer ${bound.target.bearerToken}`,
				'x-aven-identity-token': identityToken,
				'x-aven-tenant-grant': bound.token,
				'x-aven-subject': bound.identity.sub,
				'x-aven-role': bound.identity.role,
				'x-aven-session': bound.identity.sid,
				'content-type': 'application/json'
			},
			...(body !== undefined && { body: JSON.stringify(body) })
		})
		if (response.status !== 200) {
			await response.body?.cancel()
			throw deny()
		}
		const bytes = await readBoundedBytes(response, 256 * 1024, 5000)
		signal?.throwIfAborted()
		if (Date.parse(bound.expiresAt) <= Date.now()) throw deny()
		return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
	}
	return {
		async scope(token, environmentId) {
			if (token !== identityToken) throw deny()
			const { current, expiresAt } = await access(environmentId, 'credentials')
			return {
				environmentId: current.environmentId,
				subjectId: current.subjectId,
				sessionId: current.sessionId,
				generation: current.generation,
				expiresAt
			}
		},
		async execution(scope, selection) {
			const record = invocationSchema.parse(
				await request(scope, 'actor-runs', '/internal/v1/invocations/read', {
					runId: selection.runId,
					invocationId: selection.invocationId
				})
			)
			check(scope, { ...record, databaseName: '', runtimeId: '' })
			const input = record.inputs.filter(
				(input) => input.slot === 'request' && input.artifactId === selection.requestId
			)
			const http =
				record.capabilityId === 'ceo.aven:capability:web.http-fetch:http_fetch_authenticated@1'
			const mailQuery = record.capabilityId === 'ceo.aven:capability:mail.imap-mailbox:imap_query@1'
			const mailRead =
				record.capabilityId === 'ceo.aven:capability:mail.imap-mailbox:imap_read_message@1'
			if (
				(!http && !mailQuery && !mailRead) ||
				record.runId !== selection.runId ||
				record.invocationId !== selection.invocationId ||
				input.length !== 1 ||
				input[0]!.version !== 1 ||
				input[0]!.type !==
					(http
						? 'web.http-request'
						: mailQuery
							? 'mail.imap-query'
							: 'mail.imap-message-request') ||
				(http && record.parameters.binding_ref !== selection.bindingRef)
			)
				throw deny()
			// Studio's closed interpreter constructs this path, not the model's caller
			// parameters. Include every enclosing structural frame, including loop items.
			const path = record.stepId.split('.')
			if (path.length > 17 || path.some((part) => !/^(?:[a-z][a-z0-9_-]{0,63}|[0-9]+)$/.test(part)))
				throw deny()
			const ids = await Promise.all(
				path
					.slice(0, -1)
					.map((_part, index) =>
						clientRunIdentity(
							`admitted-invocation:${record.runId}:${path.slice(0, index + 1).join('.')}`
						)
					)
			)
			return {
				runId: record.runId,
				leaseOwnerId: record.leaseOwnerId,
				invocationId: record.invocationId,
				callerActorId: record.definitionRef,
				capabilityId: record.capabilityId,
				parentInvocationIds: ids,
				requestOccurrenceId: input[0]!.artifactId,
				requestArtifactDigest: input[0]!.artifactDigest,
				bindingRef: selection.bindingRef,
				mode: 'productive',
				publicationScopeId: scope.environmentId,
				expiresAt: record.expiresAt
			}
		},
		async request(scope, artifactId) {
			z.uuid().parse(artifactId)
			const bound = await access(scope.environmentId, 'artifacts')
			check(scope, bound.current)
			const baseUrl =
				bound.runtime?.artifactStoreBaseUrl ??
				(bound.primary ? config.ARTIFACT_STORE_BASE_URL : undefined)
			const bearer =
				bound.runtime?.artifactStoreBearerToken ??
				(bound.primary ? config.ARTIFACT_STORE_BEARER_TOKEN : undefined)
			if (!baseUrl || !bearer) throw deny()
			const store = new ArtifactRunStore(
				new ArtifactStoreClient({
					baseUrl,
					bearerToken: () => bearer,
					requestHeaders: () => ({
						'x-aven-artifact-database': bound.grant.databaseName,
						'x-aven-environment': scope.environmentId,
						'x-aven-routing-generation': String(scope.generation)
					}),
					fetch: (input, init) =>
						fetcher(input, {
							...init,
							signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(5000)])
						})
				}),
				scope.environmentId
			)
			const artifact = await store.get(artifactId)
			if (Date.parse(bound.expiresAt) <= Date.now()) throw deny()
			return artifact
		},
		async metadata(scope) {
			return z
				.object({ credentials: z.array(z.unknown()), bindings: z.array(z.unknown()) })
				.strict()
				.parse(await request(scope, 'credentials', '/api/credentials'))
		},
		async review(scope, runId, reviewId) {
			z.uuid().parse(runId)
			z.uuid().parse(reviewId)
			return (await request(
				scope,
				'actor-runs',
				`/api/actor-runs/${runId}/reviews/${reviewId}`
			)) as ActorReviewRecord
		}
	}
}
