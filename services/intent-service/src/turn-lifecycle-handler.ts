import type { TenantGrantKey, WorkerPlacement } from '@avenos/aven-customer-contracts'
import { admitWorkerRequest, CustomerAdmissionError } from '@avenos/aven-customer-runtime'
import { BodyLimitError, readBoundedJson } from '@avenos/http-boundary'
import { turnLifecycleCommandSchema, turnLifecycleSchema } from '@avenos/intents/work'
import { z } from 'zod'
import { IntentConflictError, IntentNotFoundError } from './store.js'
import type { IntentTurnOutbox } from './turn-outbox.js'

/** Narrow internal recovery edge. The signed current placement supplies the
 * database; an exact previously admitted run supplies the reference. No user
 * token, alternate prompt, tool invocation or answer publication is accepted.
 */
export function createTurnLifecycleHandler(
	config: {
		serviceToken: string
		runtimeId: string
		tenantGrantPublicKey: TenantGrantKey
		tenantGrantIssuer: string
	},
	outboxFor: (placement: WorkerPlacement) => Promise<IntentTurnOutbox>,
	log: (error: unknown) => void = () => {}
) {
	const json = (status: number, value: unknown) =>
		Response.json(value, { status, headers: { 'cache-control': 'no-store' } })
	return async (request: Request): Promise<Response> => {
		const url = new URL(request.url)
		if (
			request.method !== 'POST' ||
			url.pathname !== '/internal/v1/work/turn/lifecycle' ||
			url.search
		)
			return json(404, { code: 'ROUTE_NOT_FOUND' })
		try {
			const placement = await admitWorkerRequest(request, {
				...config,
				componentRef: 'ceo.aven:component:data:intents@1'
			})
			const command = turnLifecycleCommandSchema.parse(await readBoundedJson(request, 2048))
			return json(
				200,
				turnLifecycleSchema.parse(
					await (await outboxFor(placement)).lifecycle(
						placement,
						command.run,
						command.kind === 'resume'
					)
				)
			)
		} catch (error) {
			if (error instanceof CustomerAdmissionError)
				return json(403, { code: 'WORKER_ACCESS_DENIED' })
			if (error instanceof IntentConflictError || error instanceof IntentNotFoundError)
				return json(409, { code: 'WORK_REFERENCE_UNAVAILABLE' })
			if (error instanceof BodyLimitError) return json(413, { code: 'WORK_INPUT_TOO_LARGE' })
			if (error instanceof z.ZodError || error instanceof SyntaxError)
				return json(400, { code: 'WORK_INPUT_INVALID' })
			log(error)
			return json(503, { code: 'WORK_LIFECYCLE_UNAVAILABLE' })
		}
	}
}
