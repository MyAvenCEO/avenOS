import type { TenantGrantClaims, TenantGrantKey } from '@avenos/aven-customer-contracts'
import { admitWorkRequest, CustomerAdmissionError } from '@avenos/aven-customer-runtime'
import { BodyLimitError, readBoundedJson } from '@avenos/http-boundary'
import {
	TURN_CONTEXT_MAX_BYTES,
	turnContextSchema,
	turnWorkCommandSchema
} from '@avenos/intents/work'
import { z } from 'zod'
import { InvalidRetrievalCursor } from './retrieval.js'
import { IntentConflictError, IntentNotFoundError, type IntentStore } from './store.js'
import type { IntentTurnOutbox } from './turn-outbox.js'

/** Executor-only context/publication. No caller-selected customer, subject, turn,
 * run, history watermark or certificate replacement. The signed live lease binds all.
 */
export function createTurnWorkHandler(
	config: {
		serviceToken: string
		tenantGrantPublicKey: TenantGrantKey
		tenantGrantIssuer: string
	},
	stores: {
		outboxFor(grant: TenantGrantClaims): Promise<IntentTurnOutbox>
		historyFor(
			grant: TenantGrantClaims
		): Promise<Pick<IntentStore, 'page' | 'messages' | 'message' | 'preview'>>
	},
	log: (error: unknown) => void = () => {}
) {
	const json = (status: number, body: unknown) =>
		Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
	return async (request: Request): Promise<Response> => {
		const url = new URL(request.url)
		if (request.method !== 'POST' || url.pathname !== '/internal/v1/work/turn' || url.search)
			return json(404, { code: 'ROUTE_NOT_FOUND' })
		try {
			// Authenticate before reading private request material. Finish additionally
			// requires write permission; a context-only grant cannot publish an answer.
			const { tenant } = await admitWorkRequest(request, {
				...config,
				componentRef: 'ceo.aven:component:data:intents@1',
				requiredAction: 'intents:read'
			})
			const command = turnWorkCommandSchema.parse(await readBoundedJson(request, 512 * 1024))
			if (command.kind === 'finish' && !tenant.actions.includes('intents:write'))
				throw new CustomerAdmissionError()
			const binding = tenant.execution!,
				scope = {
					subjectId: tenant.sub,
					environmentId: tenant.environmentId,
					generation: tenant.routingGeneration
				},
				outbox = await stores.outboxFor(tenant)
			const token = request.headers.get('x-aven-work-grant')!
			await outbox.authorizeExecution(scope, binding.turnId, binding.runId, token)
			if (command.kind === 'finish')
				return json(200, {
					contributionId: await outbox.finish(scope, binding.turnId, binding.runId, command.output)
				})
			if (command.kind === 'read' || command.kind === 'search') {
				// Same owner-scoped, indexed readers as the interactive API. Reading a
				// different Intent is evidence retrieval, never a destination change.
				const history = await stores.historyFor(tenant)
				const result =
					command.kind === 'search'
						? await (command.recordKind === 'intent'
								? history.page(tenant.sub, command.input)
								: history.messages(tenant.sub, command.input))
						: command.recordKind === 'intent'
							? await history.preview(tenant.sub, command.id)
							: await history.message(tenant.sub, command.id, command.offset)
				return json(200, result)
			}
			const { workGrant: _secret, ...context } = await outbox.executionContext(
				scope,
				binding.turnId,
				binding.runId
			)
			const history = await outbox.history(scope, binding.turnId, binding.runId)
			// Keep whole recent contributions, never truncated tool JSON or half a pair.
			// The pinned watermark remains unchanged and lost older coverage stays explicit.
			const value = turnContextSchema.parse(JSON.parse(JSON.stringify({ ...context, history })))
			let bytes = Buffer.byteLength(JSON.stringify(value))
			while (bytes > TURN_CONTEXT_MAX_BYTES && value.history.contributions.length) {
				const removed = value.history.contributions.shift()!
				bytes -=
					Buffer.byteLength(JSON.stringify(removed)) + (value.history.contributions.length ? 1 : 0)
				value.history.hasMore = true
			}
			return json(200, value)
		} catch (error) {
			if (error instanceof CustomerAdmissionError) return json(403, { code: 'WORK_ACCESS_DENIED' })
			if (error instanceof IntentNotFoundError) return json(404, { code: 'WORK_RECORD_NOT_FOUND' })
			if (error instanceof IntentConflictError) return json(409, { code: 'WORK_EXECUTION_ENDED' })
			if (error instanceof BodyLimitError) return json(413, { code: 'WORK_INPUT_TOO_LARGE' })
			if (
				error instanceof z.ZodError ||
				error instanceof SyntaxError ||
				error instanceof InvalidRetrievalCursor
			)
				return json(400, { code: 'WORK_INPUT_INVALID' })
			log(error)
			return json(503, { code: 'WORK_CONTEXT_UNAVAILABLE' })
		}
	}
}
