import type {
	TenantGrantClaims,
	TenantGrantKey,
	WorkGrantClaims
} from '@avenos/aven-customer-contracts'
import { admitTurnDispatchRequest, admitWorkRequest, CustomerAdmissionError } from './admission.js'

export class WorkExecutionEnded extends Error {}

/** A read-only internal probe. It never executes an Actor or returns customer data.
 * Both signed authorities are required even though the caller is a trusted service.
 */
export function createWorkGuardHandler(
	config: {
		serviceToken: string
		tenantGrantPublicKey: TenantGrantKey
		tenantGrantIssuer: string
		componentRef: string
		requiredAction: string
		phase?: 'execution' | 'dispatch'
	},
	check: (tenant: TenantGrantClaims, work: WorkGrantClaims, workToken: string) => Promise<number>,
	log: (error: unknown) => void = () => {}
) {
	const json = (status: number, code: string) =>
		Response.json({ code }, { status, headers: { 'cache-control': 'no-store' } })
	return async (request: Request): Promise<Response> => {
		const url = new URL(request.url)
		const path =
			config.phase === 'dispatch' ? '/internal/v1/work/dispatch/verify' : '/internal/v1/work/verify'
		if (url.pathname !== path || request.method !== 'POST' || url.search)
			return json(404, 'ROUTE_NOT_FOUND')
		try {
			const { tenant, work } = await (config.phase === 'dispatch'
				? admitTurnDispatchRequest
				: admitWorkRequest)(request, config)
			if (request.body !== null) return json(400, 'WORK_PROBE_INVALID')
			const validUntil = Math.min(
				work.exp,
				await check(tenant, work, request.headers.get('x-aven-work-grant')!)
			)
			if (!Number.isSafeInteger(validUntil) || validUntil <= Date.now() / 1000)
				throw new WorkExecutionEnded()
			return new Response(null, {
				status: 204,
				headers: { 'cache-control': 'no-store', 'x-aven-work-valid-until': String(validUntil) }
			})
		} catch (error) {
			if (error instanceof CustomerAdmissionError) return json(403, 'WORK_ACCESS_DENIED')
			if (error instanceof WorkExecutionEnded) return json(409, 'WORK_EXECUTION_ENDED')
			log(error)
			return json(503, 'WORK_CHECK_UNAVAILABLE')
		}
	}
}
