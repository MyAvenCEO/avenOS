import {
	type ExecutionBinding,
	executionBindingSchema,
	signTenantGrant,
	type TenantGrantKey,
	verifyWorkGrant,
	type WorkGrantClaims,
	workAllows
} from '@avenos/aven-customer-contracts'
import { z } from 'zod'
import { CustomerAuthorizationError, type CustomerStore } from './store.js'

const requestSchema = z
	.object({
		workToken: z.string().min(1).max(8192),
		binding: executionBindingSchema,
		componentRef: z.string().min(1).max(200),
		actions: z.array(z.string().min(1).max(81)).min(1).max(8)
	})
	.strict()
export type ExecutionCheck = {
	work: WorkGrantClaims
	workToken: string
	binding: ExecutionBinding
	runtimeId: string
}

/** Internal policy boundary. Deliberately has no public route or default-allow guard.
 * authorizeExecution must verify the accepted, uncancelled turn AND the matching live
 * runner lease using fixed internal services. A model cannot select those destinations.
 */
export class WorkGrantExchange {
	constructor(
		private readonly config: {
			issuer: string
			publicKey: TenantGrantKey
			privateKey: TenantGrantKey
			store: Pick<CustomerStore, 'authorize'>
			/** Earliest live authority/lease expiry, Unix seconds; never a cached observation. */
			authorizeExecution: (input: ExecutionCheck) => Promise<number>
		}
	) {}

	async exchange(value: unknown) {
		const input = requestSchema.parse(value)
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
			new Set(input.actions).size !== input.actions.length ||
			!workAllows(work, input.componentRef, input.actions)
		)
			throw new CustomerAuthorizationError(
				403,
				'WORK_ACTION_DENIED',
				'This action is outside the accepted work.'
			)
		const authorize = async () => {
			const grant = await this.config.store.authorize(
				work,
				work.environmentId,
				input.componentRef,
				input.actions
			)
			if (
				grant.iss !== work.iss ||
				grant.sub !== work.sub ||
				grant.sid !== work.sid ||
				grant.role !== work.role ||
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
			return grant
		}
		const before = await authorize()
		const validUntil = await this.config.authorizeExecution({
			work,
			workToken: input.workToken,
			binding: input.binding,
			runtimeId: before.runtimeId
		})
		// Guard lookups cross service boundaries. Recheck placement/access after them;
		// a suspended or moved environment must not receive a fresh usable grant.
		const after = await authorize()
		if (before.runtimeId !== after.runtimeId)
			throw new CustomerAuthorizationError(
				409,
				'WORKSPACE_CHANGED',
				'This work needs renewed authorization.'
			)
		if (!Number.isSafeInteger(validUntil))
			throw new CustomerAuthorizationError(
				503,
				'WORK_CHECK_UNAVAILABLE',
				'Work authorization is unavailable.'
			)
		const now = Math.floor(Date.now() / 1000),
			ttl = Math.min(60, work.exp - now, validUntil - now)
		if (ttl < 1)
			throw new CustomerAuthorizationError(
				403,
				'WORK_AUTHORITY_EXPIRED',
				'This work needs renewed authorization.'
			)
		const { runtimeId, ...claims } = after
		return {
			runtimeId,
			token: await signTenantGrant(
				{ ...claims, execution: input.binding },
				this.config.privateKey,
				ttl,
				now
			)
		}
	}
}
