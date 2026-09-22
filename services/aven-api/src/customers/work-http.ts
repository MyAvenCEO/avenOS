import { timingSafeEqual } from 'node:crypto'
import { signTenantGrant, type TenantGrantKey } from '@avenos/aven-customer-contracts'
import { BodyLimitError, readBoundedJson } from '@avenos/http-boundary'
import { z } from 'zod'
import type { FacadeConfig } from '../config.js'
import { RuntimeDirectory } from './runtime-directory.js'
import { CustomerAuthorizationError, type CustomerStore } from './store.js'
import { type DispatchCheck, WorkDispatchExchange } from './work-dispatch.js'
import { type ExecutionCheck, WorkGrantExchange } from './work-exchange.js'
import { createWorkerPlacementHandler } from './worker-placement.js'

type GuardTarget = { baseUrl: string; bearerToken: string; componentRef: string }

async function probe(
	target: GuardTarget,
	path: '/internal/v1/work/verify' | '/internal/v1/work/dispatch/verify',
	token: string,
	workToken: string,
	expires: number,
	fetcher: typeof fetch = fetch
): Promise<number> {
	let response: Response
	try {
		response = await fetcher(new URL(path, target.baseUrl), {
			method: 'POST',
			redirect: 'manual',
			signal: AbortSignal.timeout(5_000),
			headers: {
				authorization: `Bearer ${target.bearerToken}`,
				'x-aven-tenant-grant': token,
				'x-aven-work-grant': workToken
			}
		})
	} catch {
		throw new CustomerAuthorizationError(
			503,
			'WORK_CHECK_UNAVAILABLE',
			'Work authorization is unavailable.'
		)
	}
	await response.body?.cancel()
	if (response.status !== 204) {
		if ([401, 403, 404, 409].includes(response.status))
			throw new CustomerAuthorizationError(
				403,
				'WORK_EXECUTION_ENDED',
				'This work no longer authorizes execution.'
			)
		throw new CustomerAuthorizationError(
			503,
			'WORK_CHECK_UNAVAILABLE',
			'Work authorization is unavailable.'
		)
	}
	const deadline = Number(response.headers.get('x-aven-work-valid-until'))
	if (!Number.isSafeInteger(deadline) || deadline <= Date.now() / 1000 || deadline > expires)
		throw new CustomerAuthorizationError(
			403,
			'WORK_EXECUTION_ENDED',
			'This work no longer authorizes execution.'
		)
	return deadline
}

export function configuredWorkControl(
	config: FacadeConfig,
	store: Pick<CustomerStore, 'authorize' | 'workPlacements'>,
	keys: { publicKey: TenantGrantKey; privateKey: TenantGrantKey }
) {
	if (!config.WORK_GRANT_EXCHANGE_BEARER_TOKEN) return undefined
	const directory = new RuntimeDirectory(config)
	const placements = createWorkerPlacementHandler(config, store, keys.privateKey)
	const target: Parameters<typeof createHttpExecutionCheck>[0]['target'] = async (
		runtimeId,
		segment
	) => {
		const runtime = (await directory.read()).find((entry) => entry.id === runtimeId)
		const primary = runtimeId === 'primary' && !runtime && !config.CUSTOMER_RUNTIMES_FILE
		const destination =
			runtime?.targets.find((entry) => entry.segment === segment) ??
			(primary
				? config.CUSTOMER_DOWNSTREAMS_JSON.find((entry) => entry.segment === segment)
				: undefined)
		if (!destination)
			throw new CustomerAuthorizationError(
				503,
				'WORK_CHECK_UNAVAILABLE',
				'Work authorization is unavailable.'
			)
		return destination
	}
	const exchange = createWorkExchangeHandler(
		config.WORK_GRANT_EXCHANGE_BEARER_TOKEN,
		new WorkGrantExchange({
			issuer: config.API_PUBLIC_BASE_URL,
			...keys,
			store,
			authorizeExecution: createHttpExecutionCheck({ store, privateKey: keys.privateKey, target })
		})
	)
	const dispatch = createWorkExchangeHandler(
		config.WORK_GRANT_EXCHANGE_BEARER_TOKEN,
		new WorkDispatchExchange({
			issuer: config.API_PUBLIC_BASE_URL,
			...keys,
			store,
			authorizeDispatch: createHttpDispatchCheck({ store, privateKey: keys.privateKey, target })
		}),
		'/internal/v1/work/dispatch'
	)
	return (request: Request) => {
		const path = new URL(request.url).pathname
		return path === '/internal/v1/work/placements'
			? placements(request)
			: path === '/internal/v1/work/dispatch'
				? dispatch(request)
				: exchange(request)
	}
}

/** Destinations come exclusively from the operator directory after policy lookup.
 * The short-lived probe grants stay service-to-service; only a successful pair of
 * current guards permits the requested grant to be returned to the runner.
 */
export function createHttpExecutionCheck(config: {
	store: Pick<CustomerStore, 'authorize'>
	privateKey: TenantGrantKey
	target: (runtimeId: string, segment: 'intents' | 'actor-runs') => Promise<GuardTarget>
	fetcher?: typeof fetch
}) {
	return async ({ work, workToken, binding, runtimeId }: ExecutionCheck): Promise<number> => {
		const deadlines = await Promise.all(
			[
				['intents', 'ceo.aven:component:data:intents@1', 'intents:read'],
				['actor-runs', 'os.aven:component:actors:run-repository@1', 'actor-runs:read']
			].map(async ([segment, componentRef, action]) => {
				const grant = await config.store.authorize(work, work.environmentId, componentRef!, [
					action!
				])
				if (
					grant.runtimeId !== runtimeId ||
					grant.environmentId !== work.environmentId ||
					grant.databaseName !== work.databaseName ||
					grant.routingGeneration !== work.routingGeneration ||
					grant.membershipRole !== work.membershipRole
				)
					throw new CustomerAuthorizationError(
						409,
						'WORKSPACE_CHANGED',
						'This work needs renewed authorization.'
					)
				const target = await config.target(runtimeId, segment as 'intents' | 'actor-runs')
				if (target.componentRef !== componentRef)
					throw new CustomerAuthorizationError(
						503,
						'WORK_CHECK_UNAVAILABLE',
						'Work authorization is unavailable.'
					)
				const now = Math.floor(Date.now() / 1000),
					ttl = Math.min(15, work.exp - now)
				if (ttl < 1)
					throw new CustomerAuthorizationError(
						403,
						'WORK_AUTHORITY_EXPIRED',
						'This work needs renewed authorization.'
					)
				const { runtimeId: _runtime, ...claims } = grant
				const token = await signTenantGrant(
					{ ...claims, execution: binding },
					config.privateKey,
					ttl,
					now
				)
				return probe(target, '/internal/v1/work/verify', token, workToken, work.exp, config.fetcher)
			})
		)
		return Math.min(...deadlines)
	}
}

/** The pre-lease check can only inspect the Intent claim, not run a tool. */
export function createHttpDispatchCheck(config: Parameters<typeof createHttpExecutionCheck>[0]) {
	return async ({ work, workToken, binding, runtimeId }: DispatchCheck): Promise<number> => {
		const componentRef = 'ceo.aven:component:data:intents@1'
		const grant = await config.store.authorize(work, work.environmentId, componentRef, [
			'intents:read'
		])
		if (
			grant.runtimeId !== runtimeId ||
			grant.databaseName !== work.databaseName ||
			grant.environmentId !== work.environmentId ||
			grant.routingGeneration !== work.routingGeneration ||
			grant.membershipRole !== work.membershipRole
		)
			throw new CustomerAuthorizationError(
				409,
				'WORKSPACE_CHANGED',
				'This work needs renewed authorization.'
			)
		const target = await config.target(runtimeId, 'intents')
		if (target.componentRef !== componentRef)
			throw new CustomerAuthorizationError(
				503,
				'WORK_CHECK_UNAVAILABLE',
				'Work authorization is unavailable.'
			)
		const now = Math.floor(Date.now() / 1000),
			ttl = Math.min(15, work.exp - now)
		if (ttl < 1)
			throw new CustomerAuthorizationError(
				403,
				'WORK_AUTHORITY_EXPIRED',
				'This work needs renewed authorization.'
			)
		const { runtimeId: _runtime, ...claims } = grant
		const token = await signTenantGrant(
			{ ...claims, dispatch: binding },
			config.privateKey,
			ttl,
			now
		)
		return probe(
			target,
			'/internal/v1/work/dispatch/verify',
			token,
			workToken,
			work.exp,
			config.fetcher
		)
	}
}

export function createWorkExchangeHandler(
	serviceToken: string,
	exchange: Pick<WorkGrantExchange, 'exchange'>,
	path = '/internal/v1/work/exchange'
) {
	if (serviceToken.length < 32) throw Error('Work exchange requires a service credential.')
	const json = (status: number, body: unknown) =>
		Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
	return async (request: Request): Promise<Response> => {
		const url = new URL(request.url)
		if (request.method !== 'POST' || url.pathname !== path || url.search)
			return json(404, { code: 'ROUTE_NOT_FOUND' })
		const actual = Buffer.from(request.headers.get('authorization') ?? ''),
			expected = Buffer.from(`Bearer ${serviceToken}`)
		if (
			actual.length !== expected.length ||
			!timingSafeEqual(actual, expected) ||
			[
				'cookie',
				'origin',
				'x-aven-identity-token',
				'x-aven-subject',
				'x-aven-session',
				'x-aven-role'
			].some((name) => request.headers.has(name))
		)
			return json(403, { code: 'WORK_ACCESS_DENIED' })
		try {
			return json(200, await exchange.exchange(await readBoundedJson(request, 16 * 1024)))
		} catch (error) {
			if (error instanceof CustomerAuthorizationError)
				return json(error.status, { code: error.code, message: error.message })
			if (error instanceof BodyLimitError) return json(413, { code: 'WORK_INPUT_TOO_LARGE' })
			if (error instanceof z.ZodError || error instanceof SyntaxError)
				return json(400, { code: 'WORK_INPUT_INVALID' })
			return json(503, {
				code: 'WORK_CHECK_UNAVAILABLE',
				message: 'Work authorization is unavailable.'
			})
		}
	}
}
