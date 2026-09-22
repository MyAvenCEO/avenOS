import type {
	PlanRunContinuationSubmission,
	PlanRunner,
	PlanRunRecord,
	PlanRunSecurityContext
} from '@avenos/actors/run'
import type { TenantGrantClaims, TenantGrantKey } from '@avenos/aven-customer-contracts'
import { admitCustomerRequest, CustomerAdmissionError } from '@avenos/aven-customer-runtime'
import type { IdentityVerifier } from '@avenos/aven-identity'
import { BodyLimitError, readBoundedBytes } from '@avenos/http-boundary'
import type { TurnProgress } from '@avenos/intents/turn-progress'
import { ZodError, z } from 'zod'
import { parsePlanRunStartCommand } from './command.js'
import { commandValidationFailure } from './command-errors.js'
import { ReviewError, type ReviewStore, reviewDecisionCommandSchema } from './reviews.js'
import { CustomerExecutionPaused, PlanRunConflict } from './sql-runner.js'
import { studioFailure } from './studio-errors.js'
import type { StudioService } from './studio-service.js'

const json = (status: number, body: unknown): Response =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
	})

const MAX_COMMAND_BYTES = 1024 * 1024

class ActorRunHttpError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string
	) {
		super(message)
	}
}

async function readJson(request: Request): Promise<unknown> {
	const declared = Number(request.headers.get('content-length') ?? 0)
	if (Number.isFinite(declared) && declared > MAX_COMMAND_BYTES) {
		throw new ActorRunHttpError(413, 'COMMAND_TOO_LARGE', 'The actor run command is too large.')
	}
	const bytes = await readBoundedBytes(request, MAX_COMMAND_BYTES)
	if (bytes.byteLength > MAX_COMMAND_BYTES) {
		throw new ActorRunHttpError(413, 'COMMAND_TOO_LARGE', 'The actor run command is too large.')
	}
	return JSON.parse(new TextDecoder().decode(bytes)) as unknown
}

function parseContinuationSubmission(value: unknown): PlanRunContinuationSubmission {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new ActorRunHttpError(400, 'COMMAND_INVALID', 'The continuation command is invalid.')
	}
	const input = value as Record<string, unknown>
	if (
		typeof input.requestId !== 'string' ||
		input.requestId.length < 1 ||
		typeof input.continuationId !== 'string' ||
		input.continuationId.length < 1
	) {
		throw new ActorRunHttpError(400, 'COMMAND_INVALID', 'Continuation identifiers are required.')
	}
	if (input.action === 'postpone') {
		if (!onlyKeys(input, ['requestId', 'continuationId', 'action'])) {
			throw new ActorRunHttpError(400, 'COMMAND_INVALID', 'The postpone command is invalid.')
		}
		return {
			requestId: input.requestId,
			continuationId: input.continuationId,
			action: 'postpone'
		}
	}
	if (
		input.action !== 'submit' ||
		!['input', 'secret', 'approval', 'assurance'].includes(String(input.kind)) ||
		!Object.hasOwn(input, 'value') ||
		!onlyKeys(input, ['requestId', 'continuationId', 'action', 'kind', 'value'])
	) {
		throw new ActorRunHttpError(400, 'COMMAND_INVALID', 'The submission command is invalid.')
	}
	return {
		requestId: input.requestId,
		continuationId: input.continuationId,
		action: 'submit',
		kind: input.kind as 'input' | 'secret' | 'approval' | 'assurance',
		value: input.value
	}
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
	const keys = new Set(allowed)
	return Object.keys(value).every((key) => keys.has(key))
}

function visible(record: PlanRunRecord | null, subjectId: string): PlanRunRecord | null {
	return record?.security.principal.subjectId === subjectId ? record : null
}

interface RunnerProvider {
	forGrant(grant: TenantGrantClaims): Promise<PlanRunner>
	studioForGrant?(grant: TenantGrantClaims): Promise<StudioService>
	chatProgress?(grant: TenantGrantClaims, turnId: string): Promise<TurnProgress | null>
	reviewsForGrant?(grant: TenantGrantClaims): Promise<ReviewStore>
}

export function createActorRunnerHandler(
	runners: RunnerProvider,
	verifier: Pick<IdentityVerifier, 'verify'>,
	config: {
		serviceToken: string
		tenantGrantIssuer: string
		tenantGrantPublicKey: TenantGrantKey
	}
) {
	if (config.serviceToken.length < 32)
		throw new Error('runner service token must contain at least 32 bytes')
	return async (request: Request): Promise<Response> => {
		const url = new URL(request.url)
		if (request.method === 'GET' && ['/health/live', '/health/ready'].includes(url.pathname)) {
			return json(200, { status: 'ok', service: 'actor-runner', authority: 'os.aven' })
		}
		try {
			const admitted = await admitCustomerRequest(request, {
				serviceToken: config.serviceToken,
				identityVerifier: verifier,
				tenantGrantPublicKey: config.tenantGrantPublicKey,
				tenantGrantIssuer: config.tenantGrantIssuer,
				componentRef: 'os.aven:component:actors:run-repository@1',
				requiredAction:
					['GET', 'HEAD'].includes(request.method) ||
					(request.method === 'POST' && url.pathname === '/api/actor-runs/studio/query')
						? 'actor-runs:read'
						: 'actor-runs:write'
			})
			const claims = admitted.identity
			const security: PlanRunSecurityContext = {
				principal: {
					subjectId: claims.sub,
					kind: 'user',
					assurance: [...claims.amr],
					sessionId: claims.sid
				},
				access: { tenantId: admitted.tenant.environmentId },
				establishedBy: 'api.aven.ceo/actor-runner-boundary',
				authorizedAt: new Date().toISOString()
			}
			const segments = url.pathname.replace(/\/$/, '').split('/').filter(Boolean)
			if (segments[0] !== 'api' || segments[1] !== 'actor-runs') {
				return json(404, { code: 'ROUTE_NOT_FOUND' })
			}
			if (segments[2] === 'chat-turns' && segments.length === 4 && request.method === 'GET') {
				if (url.search) return json(400, { code: 'COMMAND_INVALID' })
				const turnId = z.uuid().parse(segments[3])
				const progress = await runners.chatProgress?.(admitted.tenant, turnId)
				return progress ? json(200, progress) : json(404, { code: 'TURN_PROGRESS_NOT_FOUND' })
			}
			const runner = await runners.forGrant(admitted.tenant)
			if (
				segments[2] === 'studio' &&
				segments.length === 4 &&
				['query', 'command'].includes(segments[3]!) &&
				request.method === 'POST'
			) {
				if (!runners.studioForGrant) return json(404, { code: 'STUDIO_UNAVAILABLE' })
				const studio = await runners.studioForGrant(admitted.tenant)
				return json(
					200,
					await studio.call(
						await readJson(request),
						security,
						{ session: { identityToken: admitted.identityToken, sessionId: claims.sid } },
						segments[3] === 'query'
					)
				)
			}
			if (segments.length === 2 && request.method === 'POST') {
				const command = parsePlanRunStartCommand(await readJson(request))
				const handle = await runner.start(
					{ ...command, security },
					{ session: { identityToken: admitted.identityToken, sessionId: claims.sid } }
				)
				return json(202, handle)
			}
			const runId = segments[2]
			if (!runId) return json(404, { code: 'ROUTE_NOT_FOUND' })
			const record = visible(await runner.status(runId), claims.sub)
			if (!record) return json(404, { code: 'RUN_NOT_FOUND' })
			if (
				segments[3] === 'reviews' &&
				segments.length === 5 &&
				['GET', 'POST'].includes(request.method)
			) {
				if (
					url.search ||
					request.headers.has('origin') ||
					request.headers.has('cookie') ||
					request.headers.has('x-aven-work-grant')
				)
					throw new CustomerAdmissionError()
				if (!runners.reviewsForGrant) return json(404, { code: 'REVIEWS_UNAVAILABLE' })
				const reviews = await runners.reviewsForGrant(admitted.tenant)
				const reviewId = z.uuid().parse(segments[4])
				if (request.method === 'GET') return json(200, await reviews.read(runId, reviewId))
				const command = reviewDecisionCommandSchema.parse(await readJson(request))
				// Record the verified decision first. A lost response can be resolved by
				// reading this receipt; there is no inferred approval from conversation.
				return json(200, await reviews.decide(runId, reviewId, claims.sid, command))
			}
			if (segments.length === 3 && request.method === 'GET') return json(200, record)
			if (segments[3] === 'events' && segments.length === 4 && request.method === 'GET') {
				return new Response(
					`id: ${record.revision}\nevent: run\ndata: ${JSON.stringify(record)}\n\n`,
					{
						status: 200,
						headers: {
							'content-type': 'text/event-stream',
							'cache-control': 'no-store'
						}
					}
				)
			}
			if (
				(segments[3] === 'cancel' || segments[3] === 'retry') &&
				segments.length === 4 &&
				request.method === 'POST'
			) {
				const body = (await readJson(request)) as { requestId?: unknown }
				if (typeof body.requestId !== 'string' || body.requestId.length < 1) {
					return json(400, { code: 'COMMAND_INVALID', message: 'requestId is required.' })
				}
				if (segments[3] === 'retry') {
					if (!runner.retry)
						return json(400, {
							code: 'RETRY_UNAVAILABLE',
							message: 'This runner does not support retry.'
						})
					return json(
						202,
						await runner.retry(runId, body.requestId, {
							session: { identityToken: admitted.identityToken, sessionId: claims.sid }
						})
					)
				}
				return json(202, await runner.cancel(runId, body.requestId))
			}
			if (segments[3] === 'continuations' && segments.length === 5 && request.method === 'POST') {
				const submission = parseContinuationSubmission(await readJson(request))
				if (submission.continuationId !== segments[4]) {
					return json(400, { code: 'COMMAND_INVALID', message: 'continuation ID mismatch.' })
				}
				const review = record.continuations.find(
					(c) => c.continuationId === submission.continuationId
				)?.review
				if (review && submission.action === 'submit') {
					if (!runners.reviewsForGrant) throw new ReviewError('REVIEW_NOT_OPEN')
					const retained = await (await runners.reviewsForGrant(admitted.tenant)).read(
						runId,
						review.id
					)
					if (
						retained.revision !== review.revision ||
						retained.subjectDigest !== review.subjectDigest ||
						retained.superseded ||
						Date.parse(retained.expiresAt) <= Date.now() ||
						!retained.decision ||
						retained.decision.outcome === 'postpone'
					)
						throw new ReviewError('REVIEW_NOT_OPEN')
					// Forward a verified record reference, never caller-authored decision data.
					submission.value = { reviewId: retained.id, decisionId: retained.decision.id }
				}
				return json(
					202,
					await runner.resume(runId, submission, {
						session: { identityToken: admitted.identityToken, sessionId: claims.sid }
					})
				)
			}
			return json(404, { code: 'ROUTE_NOT_FOUND' })
		} catch (error) {
			if (error instanceof ReviewError)
				return json(
					error.code === 'REVIEW_NOT_FOUND' ? 404 : error.code === 'REVIEW_UNAVAILABLE' ? 503 : 409,
					{ code: error.code }
				)
			const studioError = studioFailure(error)
			if (studioError) return json(studioError.status, studioError.problem)
			if (error instanceof CustomerExecutionPaused)
				return json(503, { code: 'CUSTOMER_EXECUTION_PAUSED', message: error.message })
			if (error instanceof BodyLimitError) return json(error.status, { code: error.code })
			if (error instanceof ActorRunHttpError) {
				return json(error.status, { code: error.code, message: error.message })
			}
			if (error instanceof CustomerAdmissionError) {
				return json(401, { code: 'AUTHENTICATION_REQUIRED', message: error.message })
			}
			if (error instanceof ZodError) {
				// Report bounded schema diagnostics, never the rejected input values.
				// A generic 400 leaves an agent repeating the same malformed command.
				return json(400, commandValidationFailure(error))
			}
			if (error instanceof SyntaxError) {
				return json(400, {
					code: 'COMMAND_INVALID',
					message: 'The request body is not valid JSON.'
				})
			}
			if (error instanceof PlanRunConflict)
				return json(409, { code: 'RUN_COMMAND_REJECTED', message: error.message })
			console.error('Actor Runner request failed', error)
			return json(503, {
				code: 'RUNNER_UNAVAILABLE',
				message: 'Actor Runner is temporarily unavailable.'
			})
		}
	}
}
