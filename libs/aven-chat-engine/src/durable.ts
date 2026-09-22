import { ChatCore, type Turn } from './chat'
import type { ContextReference } from './context-references'
import {
	JournaledChatPorts,
	type OperationProgress,
	type ToolResolution,
	type ToolResult,
	type TurnJournal
} from './journal'
import type { ModelStream, ToolSpec } from './model'
import { MAX_MODEL_METRICS } from './model-metrics'
import type { PriorActionReceipt } from './prior-actions'

export interface DurableChatInput {
	turnId: string
	intentId: string
	user: Turn
	history: Turn[]
	context: string
	contextReferences?: ContextReference[]
	priorActions?: PriorActionReceipt[]
	/** Recorded on first execution, not taken from an untrusted document or model. */
	startedAt: string
	timezone: string
}

/** Exactly the interactive engine, with durable I/O and no Svelte/native imports. */
export async function executeDurableChat(
	input: DurableChatInput,
	host: {
		journal: TurnJournal
		model: ModelStream
		specs: ToolSpec[]
		execute(name: string, args: string, invocationId: string): Promise<ToolResult>
		resolve?(invocationId: string, name: string, args: string): Promise<ToolResolution | null>
		signal?: AbortSignal
		progress?(event: OperationProgress): Promise<void>
	}
): Promise<{
	state: 'completed' | 'failed'
	failure: string | null
	reply: Turn
	diagnostics: ChatCore['diagnostics']
}> {
	const now = new Date(input.startedAt)
	if (!Number.isFinite(now.getTime())) throw Error('Invalid turn start time.')
	// Core observes elapsed stream time, which includes cheap replay on recovery.
	// Publish the journal's original measurements instead. Keep the same bounded
	// suffix as Core, while checking the complete count and phase correspondence.
	const modelOperations: OperationProgress[] = []
	let modelRequestCount = 0
	const ports = new JournaledChatPorts(host.journal, host.signal, async (event) => {
		if (event.kind === 'model' && (event.state === 'completed' || event.state === 'failed')) {
			modelRequestCount++
			modelOperations.push(event)
			if (modelOperations.length > MAX_MODEL_METRICS) modelOperations.shift()
		}
		await host.progress?.(event)
	})
	const stream = ports.model(host.model)
	const chat = new ChatCore(
		{},
		ports.tools(host.specs, host.execute, host.resolve),
		stream,
		stream,
		undefined,
		(value) => value,
		{ now: () => now, timezone: input.timezone }
	)
	chat.use(input.intentId)
	chat.hydrate(input.intentId, input.history)
	let reply: Turn | undefined
	chat.onExchange = (_intent, _user, answer) => {
		reply = answer
	}
	const stop = () => chat.stop()
	host.signal?.addEventListener('abort', stop, { once: true })
	try {
		ports.assertHealthy()
		await chat.send(input.user.content, input.user.anonymousSpeaker, {
			user: input.user,
			context: input.context,
			contextReferences: input.contextReferences,
			priorActions: input.priorActions,
			calls: []
		})
		ports.assertHealthy()
		if (!reply) throw Error('Turn ended without a publishable outcome.')
		if (
			(reply.modelRequestCount ?? 0) !== modelRequestCount ||
			(reply.modelRequests?.length ?? 0) !== modelOperations.length
		)
			throw Error('Model measurements do not match the completed turn journal.')
		const modelRequests = reply.modelRequests?.map((metric, index) => {
			const operation = modelOperations[index]!
			if (metric.phase !== (operation.phase ?? 'answer') || operation.durationMs === undefined)
				throw Error('Model measurement does not match its journal phase.')
			const { firstTextMs: _firstTextMs, replayed: _replayed, ...original } = metric
			return {
				...original,
				id: `${input.turnId}:model:${operation.ordinal}`,
				startedAt: operation.startedAt,
				durationMs: operation.durationMs,
				...(operation.firstTextMs !== undefined && {
					firstTextMs: operation.firstTextMs
				}),
				...(operation.replayed && { replayed: true as const })
			}
		})
		return await ports.outcome(input, {
			state: chat.failure ? 'failed' : 'completed',
			failure: chat.failure,
			reply: {
				...reply,
				id: input.turnId,
				...(modelRequests && { modelRequests }),
				calls: reply.calls?.map((call, index) => ({
					...call,
					id: `${input.turnId}:${index}`
				}))
			},
			diagnostics: chat.diagnostics
		})
	} finally {
		host.signal?.removeEventListener('abort', stop)
	}
}
