import {
	type TenantGrantKey,
	verifyTenantGrant,
	verifyWorkGrant
} from '@avenos/aven-customer-contracts'
import { readBoundedBytes } from '@avenos/http-boundary'
import { z } from 'zod'
import type { TurnDispatch } from './turn-outbox.js'

/** Operator-owned destinations. A model cannot choose the runner, component,
 * prompt or database. This admits only the stable turn; its outbox must still bind
 * the returned run before execution. No in-memory certificate cache is required.
 */
export class TurnDispatchClient {
	private readonly control: URL
	private readonly runner: URL
	constructor(
		private readonly config: {
			controlUrl: string
			exchangeToken: string
			runnerUrl: string
			runnerToken: string
			runtimeId: string
			issuer: string
			publicKey: TenantGrantKey
		}
	) {
		for (const value of [config.controlUrl, config.runnerUrl]) {
			const url = new URL(value)
			if (
				!['http:', 'https:'].includes(url.protocol) ||
				url.username ||
				url.password ||
				url.search ||
				url.hash
			)
				throw Error('Invalid turn dispatch destination.')
		}
		if (config.exchangeToken.length < 32 || config.runnerToken.length < 32)
			throw Error('Turn dispatch requires service authority.')
		this.control = new URL('/internal/v1/work/dispatch', config.controlUrl)
		this.runner = new URL('/internal/v1/work/admit', config.runnerUrl)
	}

	async admit(dispatch: TurnDispatch, signal?: AbortSignal): Promise<{ runId: string }> {
		signal?.throwIfAborted()
		const work = await verifyWorkGrant(
			dispatch.workGrant,
			this.config.publicKey,
			this.config.issuer
		)
		const binding = { workId: work.jti, turnId: dispatch.turnId, dispatchToken: dispatch.token }
		const deadline = () =>
			signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000)
		const response = await fetch(this.control, {
			method: 'POST',
			redirect: 'manual',
			signal: deadline(),
			headers: {
				authorization: `Bearer ${this.config.exchangeToken}`,
				'content-type': 'application/json'
			},
			body: JSON.stringify({ workToken: dispatch.workGrant, binding })
		})
		if (response.status !== 200) {
			await response.body?.cancel()
			throw Error(`Turn admission authorization is unavailable (HTTP ${response.status}).`)
		}
		const result = z
			.object({ runtimeId: z.string(), token: z.string().min(1).max(8192) })
			.strict()
			.parse(
				JSON.parse(new TextDecoder().decode(await readBoundedBytes(response, 10 * 1024, 5000)))
			)
		const grant = await verifyTenantGrant(result.token, this.config.publicKey, {
			issuer: this.config.issuer,
			audience: 'os.aven:component:actors:run-repository@1',
			action: 'actor-runs:write'
		})
		if (
			result.runtimeId !== this.config.runtimeId ||
			grant.exp <= Date.now() / 1000 ||
			grant.exp > work.exp ||
			grant.iat < work.iat ||
			!grant.dispatch ||
			grant.execution ||
			Object.entries(binding).some(
				([key, value]) => grant.dispatch![key as keyof typeof binding] !== value
			) ||
			(
				[
					'sub',
					'sid',
					'role',
					'membershipRole',
					'environmentId',
					'databaseName',
					'routingGeneration'
				] as const
			).some((key) => grant[key] !== work[key])
		)
			throw Error('Turn admission authority does not match this work.')
		const accepted = await fetch(this.runner, {
			method: 'POST',
			redirect: 'manual',
			signal: deadline(),
			headers: {
				authorization: `Bearer ${this.config.runnerToken}`,
				'x-aven-work-grant': dispatch.workGrant,
				'x-aven-tenant-grant': result.token
			}
		})
		if (accepted.status !== 202) {
			await accepted.body?.cancel()
			throw Error(`Turn admission did not complete (HTTP ${accepted.status}).`)
		}
		return z
			.object({ runId: z.uuid() })
			.strict()
			.parse(JSON.parse(new TextDecoder().decode(await readBoundedBytes(accepted, 1024, 5000))))
	}
}
