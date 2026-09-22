import { readBoundedBytes } from '@avenos/http-boundary'
import type { HistoryQuery } from '@avenos/intents/retrieval'
import {
	TURN_CONTEXT_MAX_BYTES,
	type TurnFinish,
	type TurnWorkCommand,
	turnContextSchema,
	turnFinishReceiptSchema,
	turnWorkCommandSchema
} from '@avenos/intents/work'

export class TurnWorkRequestError extends Error {
	constructor(readonly status: number) {
		super(`Turn service did not accept this request (HTTP ${status}).`)
	}
}

/** Fixed service transport. Authority must be freshly exchanged against the live
 * turn and runner lease for every request, never supplied by a model or persisted login.
 */
export class TurnWorkClient {
	private readonly endpoint: URL
	constructor(
		private readonly host: {
			baseUrl: string
			headers(actions: string[], signal?: AbortSignal): Promise<HeadersInit>
		}
	) {
		const base = new URL(host.baseUrl)
		if (
			!['http:', 'https:'].includes(base.protocol) ||
			base.username ||
			base.password ||
			base.search ||
			base.hash
		)
			throw Error('Invalid turn service configuration.')
		this.endpoint = new URL('/internal/v1/work/turn', base)
	}

	private async request(command: TurnWorkCommand, signal?: AbortSignal) {
		const actions = command.kind === 'finish' ? ['intents:read', 'intents:write'] : ['intents:read']
		const headers = new Headers(await this.host.headers(actions, signal))
		headers.set('content-type', 'application/json')
		const response = await fetch(this.endpoint, {
			method: 'POST',
			redirect: 'manual',
			headers,
			signal: signal
				? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
				: AbortSignal.timeout(10_000),
			body: JSON.stringify(turnWorkCommandSchema.parse(command))
		})
		if (response.status !== 200) {
			await response.body?.cancel()
			// No remote response body, private context or credential enters an error log.
			throw new TurnWorkRequestError(response.status)
		}
		return JSON.parse(
			new TextDecoder().decode(await readBoundedBytes(response, TURN_CONTEXT_MAX_BYTES, 10_000))
		)
	}

	async context(signal?: AbortSignal) {
		return turnContextSchema.parse(await this.request({ kind: 'context' }, signal))
	}
	/** Recheck admission without fetching private conversation history. The host
	 * must exchange fresh execution-bound authority, as for every actual request.
	 */
	async assertActive(signal?: AbortSignal): Promise<void> {
		signal?.throwIfAborted()
		await this.host.headers(['intents:read'], signal)
		signal?.throwIfAborted()
	}
	async history(query: HistoryQuery, signal?: AbortSignal): Promise<Record<string, unknown>> {
		return this.request(query, signal)
	}
	async finish(output: TurnFinish, signal?: AbortSignal) {
		return turnFinishReceiptSchema.parse(await this.request({ kind: 'finish', output }, signal))
			.contributionId
	}
}
