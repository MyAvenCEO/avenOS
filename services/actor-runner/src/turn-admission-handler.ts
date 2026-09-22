import { ACTOR_RUN_PROTOCOL, type PlanRunner, type PlanRunStartRequest } from '@avenos/actors'
import type { TenantGrantClaims, TenantGrantKey } from '@avenos/aven-customer-contracts'
import { admitTurnDispatchRequest, CustomerAdmissionError } from '@avenos/aven-customer-runtime'
import { CHAT_TURN_SKILL } from './chat-executor.js'

/** Only an already accepted human turn can enter here. Every executable field is
 * host-owned or taken from its verified certificate; a caller cannot send a plan.
 */
export function createTurnAdmissionHandler(
	config: {
		serviceToken: string
		tenantGrantIssuer: string
		tenantGrantPublicKey: TenantGrantKey
	},
	runnerFor: (grant: TenantGrantClaims) => Promise<Pick<PlanRunner, 'start'>>,
	log: (error: unknown) => void = () => {}
) {
	const json = (status: number, value: unknown) =>
		Response.json(value, { status, headers: { 'cache-control': 'no-store' } })
	return async (request: Request) => {
		const url = new URL(request.url)
		if (request.method !== 'POST' || url.pathname !== '/internal/v1/work/admit' || url.search)
			return json(404, { code: 'ROUTE_NOT_FOUND' })
		try {
			const { tenant, work } = await admitTurnDispatchRequest(request, {
				...config,
				componentRef: 'os.aven:component:actors:run-repository@1',
				requiredAction: 'actor-runs:write'
			})
			if (request.body !== null) return json(400, { code: 'WORK_INPUT_INVALID' })
			const { turnId } = tenant.dispatch!,
				authorizedAt = new Date(work.iat * 1000).toISOString()
			// A retry may have a new dispatch claim. Neither that claim nor the issued
			// short-lived grant may change this logical command's idempotency material.
			const command: PlanRunStartRequest = {
				protocol: ACTOR_RUN_PROTOCOL,
				requestId: turnId,
				idempotencyKey: `chat-turn:${turnId}`,
				requestedAt: authorizedAt,
				skillRef: CHAT_TURN_SKILL,
				executionEnvironment: 'server',
				ingredients: [],
				goals: [],
				parameters: {
					turnId,
					inputId: work.inputId,
					inputRevision: work.inputRevision,
					materialDigest: work.materialDigest
				},
				security: {
					principal: {
						subjectId: work.sub,
						kind: 'user',
						sessionId: work.sid,
						assurance: ['work-certificate']
					},
					access: { tenantId: work.environmentId },
					establishedBy: 'api.aven.ceo/turn-admission',
					authorizedAt
				}
			}
			const handle = await (await runnerFor(tenant)).start(command)
			return json(202, { runId: handle.runId })
		} catch (error) {
			if (error instanceof CustomerAdmissionError) return json(403, { code: 'WORK_ACCESS_DENIED' })
			log(error)
			return json(503, { code: 'WORK_ADMISSION_UNAVAILABLE' })
		}
	}
}
