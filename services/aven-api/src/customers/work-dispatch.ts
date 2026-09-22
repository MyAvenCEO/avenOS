import {
	signTenantGrant,
	type TenantGrantKey,
	type TurnDispatchBinding,
	turnDispatchBindingSchema,
	verifyWorkGrant,
	type WorkGrantClaims,
	workAllows
} from '@avenos/aven-customer-contracts'
import { z } from 'zod'
import { CustomerAuthorizationError, type CustomerStore } from './store.js'

const inputSchema = z
	.object({ workToken: z.string().min(1).max(8192), binding: turnDispatchBindingSchema })
	.strict()
export type DispatchCheck = {
	work: WorkGrantClaims
	workToken: string
	binding: TurnDispatchBinding
	runtimeId: string
}
const runner = 'os.aven:component:actors:run-repository@1'

/** Bootstrap admission is not execution authority. Current user access and an
 * unexpired claimed Intent outbox entry are required; there is deliberately no
 * caller-specified component, action set, skill, prompt or execution destination.
 */
export class WorkDispatchExchange {
	constructor(
		private readonly config: {
			issuer: string
			publicKey: TenantGrantKey
			privateKey: TenantGrantKey
			store: Pick<CustomerStore, 'authorize'>
			authorizeDispatch(input: DispatchCheck): Promise<number>
		}
	) {}

	async exchange(value: unknown) {
		const input = inputSchema.parse(value)
		const work = await verifyWorkGrant(
			input.workToken,
			this.config.publicKey,
			this.config.issuer
		).catch(() => {
			throw new CustomerAuthorizationError(
				403,
				'WORK_ACCESS_DENIED',
				'This work is not authorized.'
			)
		})
		if (
			input.binding.workId !== work.jti ||
			work.exp <= Date.now() / 1000 ||
			!workAllows(work, runner, ['actor-runs:write']) ||
			!workAllows(work, 'ceo.aven:component:data:intents@1', ['intents:read'])
		)
			throw new CustomerAuthorizationError(
				403,
				'WORK_ACTION_DENIED',
				'This admission is outside the accepted work.'
			)
		const authorize = async () => {
			const grant = await this.config.store.authorize(work, work.environmentId, runner, [
				'actor-runs:write'
			])
			if (
				grant.iss !== work.iss ||
				grant.sub !== work.sub ||
				grant.sid !== work.sid ||
				grant.role !== work.role ||
				grant.membershipRole !== work.membershipRole ||
				grant.environmentId !== work.environmentId ||
				grant.databaseName !== work.databaseName ||
				grant.routingGeneration !== work.routingGeneration
			)
				throw new CustomerAuthorizationError(
					409,
					'WORKSPACE_CHANGED',
					'This work needs renewed authorization.'
				)
			return grant
		}
		const before = await authorize()
		const deadline = await this.config.authorizeDispatch({
			...input,
			work,
			runtimeId: before.runtimeId
		})
		const after = await authorize()
		if (after.runtimeId !== before.runtimeId)
			throw new CustomerAuthorizationError(
				409,
				'WORKSPACE_CHANGED',
				'This work needs renewed authorization.'
			)
		const now = Math.floor(Date.now() / 1000),
			ttl = Math.min(30, work.exp - now, deadline - now)
		if (!Number.isSafeInteger(deadline) || ttl < 1)
			throw new CustomerAuthorizationError(
				403,
				'WORK_EXECUTION_ENDED',
				'This dispatch no longer owns the turn.'
			)
		const { runtimeId, ...claims } = after
		return {
			runtimeId,
			token: await signTenantGrant(
				{ ...claims, dispatch: input.binding },
				this.config.privateKey,
				ttl,
				now
			)
		}
	}
}
