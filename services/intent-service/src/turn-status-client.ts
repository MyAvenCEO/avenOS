import { readBoundedBytes } from '@avenos/http-boundary'
import {
	type TurnRunReference,
	turnRunReferenceSchema,
	turnRunStatusSchema
} from '@avenos/intents/work'

/** Fixed, authenticated coordination transport; unavailable is not failed. */
export class TurnStatusClient {
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
			throw Error('Invalid turn status service configuration.')
		this.endpoint = new URL('/internal/v1/work/turn/status', base)
	}
	async inspect(run: TurnRunReference, signal?: AbortSignal) {
		const body = JSON.stringify(turnRunReferenceSchema.parse(run))
		const response = await fetch(this.endpoint, {
			method: 'POST',
			redirect: 'manual',
			signal: signal
				? AbortSignal.any([signal, AbortSignal.timeout(5000)])
				: AbortSignal.timeout(5000),
			headers: {
				authorization: `Bearer ${this.host.serviceToken}`,
				'x-aven-worker-placement': await this.host.placement(signal),
				'content-type': 'application/json'
			},
			body
		})
		if (response.status !== 200) {
			await response.body?.cancel()
			throw Error(`Turn status is unavailable (HTTP ${response.status}).`)
		}
		return turnRunStatusSchema.parse(
			JSON.parse(new TextDecoder().decode(await readBoundedBytes(response, 1024, 5000)))
		)
	}
}
