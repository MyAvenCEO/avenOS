import { readBoundedBytes } from '@avenos/http-boundary'
import {
	type TurnRunReference,
	turnLifecycleCommandSchema,
	turnLifecycleSchema
} from '@avenos/intents/work'

/** Host-only coordination. Never expose the resumed certificate to a tool, model,
 * public run record, diagnostic output or desktop. It is not yet tool authority.
 */
export class TurnLifecycleClient {
	private readonly endpoint: URL
	constructor(
		private readonly host: {
			baseUrl: string
			serviceToken: string
			placement(signal?: AbortSignal): Promise<string>
		}
	) {
		const base = new URL(host.baseUrl)
		if (
			!['http:', 'https:'].includes(base.protocol) ||
			base.username ||
			base.password ||
			base.search ||
			base.hash ||
			host.serviceToken.length < 32
		)
			throw Error('Invalid turn lifecycle service configuration.')
		this.endpoint = new URL('/internal/v1/work/turn/lifecycle', base)
	}
	async inspect(run: TurnRunReference, kind: 'state' | 'resume' = 'state', signal?: AbortSignal) {
		const command = turnLifecycleCommandSchema.parse({ kind, run })
		const response = await fetch(this.endpoint, {
			method: 'POST',
			redirect: 'manual',
			signal: signal
				? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
				: AbortSignal.timeout(10_000),
			headers: {
				authorization: `Bearer ${this.host.serviceToken}`,
				'x-aven-worker-placement': await this.host.placement(signal),
				'content-type': 'application/json'
			},
			body: JSON.stringify(command)
		})
		if (response.status !== 200) {
			await response.body?.cancel()
			throw Error(`Turn lifecycle lookup failed (HTTP ${response.status}).`)
		}
		const value = turnLifecycleSchema.parse(
			JSON.parse(new TextDecoder().decode(await readBoundedBytes(response, 12 * 1024, 10_000)))
		)
		if (
			value.state === 'ready' &&
			(kind === 'resume' ? !value.workGrant : value.workGrant !== undefined)
		)
			throw Error('Invalid turn lifecycle response.')
		return value
	}
}
