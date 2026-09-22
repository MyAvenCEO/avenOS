import type { TenantGrantKey, WorkerPlacement } from '@avenos/aven-customer-contracts'
import { admitWorkerRequest, CustomerAdmissionError } from '@avenos/aven-customer-runtime'
import { BodyLimitError, readBoundedJson } from '@avenos/http-boundary'
import { turnRunReferenceSchema } from '@avenos/intents/work'
import type pg from 'pg'
import { z } from 'zod'
import { observeTurnRun } from './turn-observation.js'

/** A supervisor can distinguish stopped work from slow work without obtaining
 * prompts, errors, outputs, login credentials or permission to retry an effect.
 */
export function createTurnStatusHandler(
	config: {
		serviceToken: string
		runtimeId: string
		tenantGrantPublicKey: TenantGrantKey
		tenantGrantIssuer: string
	},
	poolFor: (placement: WorkerPlacement) => Promise<pg.Pool>,
	log: (error: unknown) => void = () => {}
) {
	const json = (status: number, body: unknown) =>
		Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
	return async (request: Request): Promise<Response> => {
		const url = new URL(request.url)
		if (request.method !== 'POST' || url.pathname !== '/internal/v1/work/turn/status' || url.search)
			return json(404, { code: 'ROUTE_NOT_FOUND' })
		try {
			const placement = await admitWorkerRequest(request, {
				...config,
				componentRef: 'os.aven:component:actors:run-repository@1'
			})
			const reference = turnRunReferenceSchema.parse(await readBoundedJson(request, 2048))
			const pool = await poolFor(placement)
			// Select only the allowed state fields; do not fetch private progress or
			// exception messages and then rely on a response filter to remove them.
			const status = await observeTurnRun(pool, placement, reference)
			if (!status) return json(409, { code: 'WORK_REFERENCE_UNAVAILABLE' })
			return json(200, status)
		} catch (error) {
			if (error instanceof CustomerAdmissionError)
				return json(403, { code: 'WORKER_ACCESS_DENIED' })
			if (error instanceof BodyLimitError) return json(413, { code: 'WORK_INPUT_TOO_LARGE' })
			if (error instanceof z.ZodError || error instanceof SyntaxError)
				return json(400, { code: 'WORK_INPUT_INVALID' })
			log(error)
			return json(503, { code: 'WORK_STATUS_UNAVAILABLE' })
		}
	}
}
