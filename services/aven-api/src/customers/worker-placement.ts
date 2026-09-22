import { timingSafeEqual } from 'node:crypto'
import {
	signWorkerPlacement,
	type TenantGrantKey,
	workerPlacementRequestSchema
} from '@avenos/aven-customer-contracts'
import { BodyLimitError, readBoundedJson } from '@avenos/http-boundary'
import { z } from 'zod'
import type { FacadeConfig } from '../config.js'
import { RuntimeDirectory } from './runtime-directory.js'
import type { CustomerStore } from './store.js'

/** Only the service credential for that exact runtime/component can discover its
 * queues. A placement does not grant a public API action or replace a work grant.
 */
export function createWorkerPlacementHandler(
	config: FacadeConfig,
	store: Pick<CustomerStore, 'workPlacements'>,
	key: TenantGrantKey
) {
	const directory = new RuntimeDirectory(config)
	const json = (status: number, value: unknown) =>
		Response.json(value, { status, headers: { 'cache-control': 'no-store' } })
	return async (request: Request): Promise<Response> => {
		const url = new URL(request.url)
		if (request.method !== 'POST' || url.pathname !== '/internal/v1/work/placements' || url.search)
			return json(404, { code: 'ROUTE_NOT_FOUND' })
		if (
			[
				'cookie',
				'origin',
				'x-aven-identity-token',
				'x-aven-tenant-grant',
				'x-aven-work-grant',
				'x-aven-subject',
				'x-aven-session',
				'x-aven-role'
			].some((name) => request.headers.has(name))
		)
			return json(403, { code: 'WORKER_ACCESS_DENIED' })
		try {
			const input = workerPlacementRequestSchema.parse(await readBoundedJson(request, 2048))
			const runtime = (await directory.read()).find((entry) => entry.id === input.runtimeId)
			const targets =
				runtime?.targets ??
				(input.runtimeId === 'primary' && !config.CUSTOMER_RUNTIMES_FILE
					? config.CUSTOMER_DOWNSTREAMS_JSON
					: [])
			const segment =
				input.componentRef === 'ceo.aven:component:data:intents@1' ? 'intents' : 'actor-runs'
			const target = targets.find(
				(entry) => entry.segment === segment && entry.componentRef === input.componentRef
			)
			if (!target) return json(403, { code: 'WORKER_ACCESS_DENIED' })
			const actual = Buffer.from(request.headers.get('authorization') ?? ''),
				expected = Buffer.from(`Bearer ${target.bearerToken}`)
			if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
				return json(403, { code: 'WORKER_ACCESS_DENIED' })
			const found = await store.workPlacements(input)
			return json(200, {
				placements: await Promise.all(
					found.placements.map((item) => signWorkerPlacement(item, key))
				),
				next: found.next
			})
		} catch (error) {
			if (error instanceof BodyLimitError) return json(413, { code: 'WORKER_INPUT_TOO_LARGE' })
			if (error instanceof SyntaxError || error instanceof z.ZodError)
				return json(400, { code: 'WORKER_INPUT_INVALID' })
			return json(503, { code: 'WORKER_DIRECTORY_UNAVAILABLE' })
		}
	}
}
