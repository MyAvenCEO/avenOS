import {
	type ExecutionBinding,
	executionBindingSchema,
	type TenantGrantKey,
	verifyTenantGrant,
	verifyWorkGrant,
	workAllows
} from '@avenos/aven-customer-contracts'
import { readBoundedBytes } from '@avenos/http-boundary'
import { z } from 'zod'

const errorCode = z.enum([
	'WORK_ACCESS_DENIED',
	'WORK_ACTION_DENIED',
	'WORKSPACE_CHANGED',
	'WORK_AUTHORITY_EXPIRED',
	'WORK_EXECUTION_ENDED',
	'WORK_CHECK_UNAVAILABLE',
	'WORK_INPUT_INVALID',
	'WORK_INPUT_TOO_LARGE',
	'ENVIRONMENT_NOT_FOUND',
	'MEMBERSHIP_ACTION_DENIED',
	'COMPONENT_NOT_READY'
])
export class WorkAuthorizationError extends Error {
	constructor(
		readonly status: number,
		readonly code: z.infer<typeof errorCode> = status < 500
			? 'WORK_ACCESS_DENIED'
			: 'WORK_CHECK_UNAVAILABLE'
	) {
		super(`${code}: Work authorization is unavailable or has ended.`)
	}
}

/** One accepted turn, one current runner lease. The model never sees these
 * credentials or chooses this control endpoint. Grants are checked afresh for
 * every call; a cached login or unbounded service credential is not a fallback.
 */
export class WorkGrantClient {
	private readonly binding: ExecutionBinding
	private readonly endpoint: URL
	constructor(
		private readonly config: {
			baseUrl: string
			serviceToken: string
			runtimeId: string
			issuer: string
			publicKey: TenantGrantKey
			workToken: string
			binding: ExecutionBinding
		}
	) {
		const base = new URL(config.baseUrl)
		if (
			!['http:', 'https:'].includes(base.protocol) ||
			base.username ||
			base.password ||
			base.search ||
			base.hash ||
			config.serviceToken.length < 32 ||
			config.workToken.length > 8192
		)
			throw Error('Invalid work client configuration.')
		this.endpoint = new URL('/internal/v1/work/exchange', base)
		this.binding = executionBindingSchema.parse(config.binding)
	}

	async grant(componentRef: string, actions: string[], signal?: AbortSignal): Promise<string> {
		signal?.throwIfAborted()
		try {
			const work = await verifyWorkGrant(
				this.config.workToken,
				this.config.publicKey,
				this.config.issuer
			)
			if (
				work.exp <= Date.now() / 1000 ||
				work.jti !== this.binding.workId ||
				new Set(actions).size !== actions.length ||
				!workAllows(work, componentRef, actions)
			)
				throw new WorkAuthorizationError(403)
			const response = await fetch(this.endpoint, {
				method: 'POST',
				redirect: 'manual',
				signal: signal
					? AbortSignal.any([signal, AbortSignal.timeout(5000)])
					: AbortSignal.timeout(5000),
				headers: {
					authorization: `Bearer ${this.config.serviceToken}`,
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					workToken: this.config.workToken,
					binding: this.binding,
					componentRef,
					actions
				})
			})
			if (response.status !== 200) {
				const status = [400, 401, 403, 404, 409, 413].includes(response.status)
					? response.status
					: 503
				let code: z.infer<typeof errorCode> =
					status < 500 ? 'WORK_ACCESS_DENIED' : 'WORK_CHECK_UNAVAILABLE'
				try {
					const body = JSON.parse(
						new TextDecoder().decode(await readBoundedBytes(response, 4096, 5000))
					)
					const parsed = errorCode.safeParse(body?.code)
					if (parsed.success) code = parsed.data
				} catch {
					/* An upstream body is never a safe error message. */
				}
				throw new WorkAuthorizationError(status, code)
			}
			const result = z
				.object({ runtimeId: z.string().min(1).max(63), token: z.string().min(1).max(8192) })
				.strict()
				.parse(
					JSON.parse(new TextDecoder().decode(await readBoundedBytes(response, 10 * 1024, 5000)))
				)
			const grant = await verifyTenantGrant(result.token, this.config.publicKey, {
				issuer: this.config.issuer,
				audience: componentRef,
				action: actions[0]!
			})
			if (
				result.runtimeId !== this.config.runtimeId ||
				grant.sub !== work.sub ||
				grant.sid !== work.sid ||
				grant.role !== work.role ||
				grant.membershipRole !== work.membershipRole ||
				grant.environmentId !== work.environmentId ||
				grant.databaseName !== work.databaseName ||
				grant.routingGeneration !== work.routingGeneration ||
				grant.iat < work.iat ||
				grant.exp > work.exp ||
				grant.exp <= Date.now() / 1000 ||
				grant.actions.length !== actions.length ||
				!actions.every((action) => grant.actions.includes(action)) ||
				!grant.execution ||
				Object.entries(this.binding).some(
					([key, value]) => grant.execution![key as keyof ExecutionBinding] !== value
				)
			)
				throw new WorkAuthorizationError(403)
			return result.token
		} catch (error) {
			signal?.throwIfAborted()
			if (error instanceof WorkAuthorizationError) throw error
			// Do not leak a certificate, destination, database name or remote error body.
			throw new WorkAuthorizationError(503)
		}
	}
}
