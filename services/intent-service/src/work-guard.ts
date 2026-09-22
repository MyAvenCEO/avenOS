import type { TenantGrantClaims, TenantGrantKey } from '@avenos/aven-customer-contracts'
import { createWorkGuardHandler, WorkExecutionEnded } from '@avenos/aven-customer-runtime'
import { IntentConflictError, IntentNotFoundError } from './store.js'
import type { IntentTurnOutbox } from './turn-outbox.js'

export function createIntentWorkGuard(
	config: {
		serviceToken: string
		tenantGrantPublicKey: TenantGrantKey
		tenantGrantIssuer: string
	},
	outboxFor: (grant: TenantGrantClaims) => Promise<IntentTurnOutbox>,
	log?: (error: unknown) => void
) {
	return createWorkGuardHandler(
		{
			...config,
			componentRef: 'ceo.aven:component:data:intents@1',
			requiredAction: 'intents:read'
		},
		async (tenant, work, token) => {
			const outbox = await outboxFor(tenant)
			try {
				await outbox.authorizeExecution(
					{
						subjectId: tenant.sub,
						environmentId: tenant.environmentId,
						generation: tenant.routingGeneration
					},
					tenant.execution!.turnId,
					tenant.execution!.runId,
					token
				)
				return work.exp
			} catch (error) {
				if (error instanceof IntentConflictError || error instanceof IntentNotFoundError)
					throw new WorkExecutionEnded()
				throw error
			}
		},
		log
	)
}

export function createIntentDispatchGuard(
	config: {
		serviceToken: string
		tenantGrantPublicKey: TenantGrantKey
		tenantGrantIssuer: string
	},
	outboxFor: (grant: TenantGrantClaims) => Promise<IntentTurnOutbox>,
	log?: (error: unknown) => void
) {
	return createWorkGuardHandler(
		{
			...config,
			componentRef: 'ceo.aven:component:data:intents@1',
			requiredAction: 'intents:read',
			phase: 'dispatch'
		},
		async (tenant, _work, token) => {
			try {
				return await (await outboxFor(tenant)).authorizeDispatch(
					{
						subjectId: tenant.sub,
						environmentId: tenant.environmentId,
						generation: tenant.routingGeneration
					},
					tenant.dispatch!.turnId,
					tenant.dispatch!.dispatchToken,
					token
				)
			} catch (error) {
				if (error instanceof IntentConflictError || error instanceof IntentNotFoundError)
					throw new WorkExecutionEnded()
				throw error
			}
		},
		log
	)
}
