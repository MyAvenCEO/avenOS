import {
	ACTOR_RUN_PROTOCOL,
	type PlanRunExecutionContext,
	type PlanRunExecutor,
	type PlanRunStartRequest,
	resourceId
} from '@avenos/actors'
import { type DurableChatInput, executeDurableChat } from '@avenos/chat-engine/durable'
import type {
	OperationProgress,
	ToolResolution,
	ToolResult,
	TurnJournal
} from '@avenos/chat-engine/journal'
import type { ModelStream, ToolSpec } from '@avenos/chat-engine/model'
import { turnPayload } from '@avenos/chat-engine/turn-payload'
import { z } from 'zod'

export const CHAT_TURN_SKILL = resourceId({
	authority: 'ceo.aven',
	kind: 'skill',
	namespace: 'intents',
	name: 'chat-turn',
	version: '1'
})
export const chatTurnParameters = z
	.object({
		turnId: z.uuid(),
		inputId: z.uuid(),
		inputRevision: z.number().int().positive(),
		materialDigest: z.string().regex(/^[a-f0-9]{64}$/)
	})
	.strict()
type Lease = NonNullable<PlanRunExecutionContext['lease']>
export interface ChatTurnSession {
	input: DurableChatInput
	journal: TurnJournal
	model: ModelStream
	specs: ToolSpec[]
	execute(name: string, args: string, invocationId: string): Promise<ToolResult>
	resolve(invocationId: string, name: string, args: string): Promise<ToolResolution | null>
	publish(output: {
		state: 'completed' | 'failed'
		text: string
		payload: Record<string, unknown>
	}): Promise<string>
}

/** One application executor using the same conversation engine and saved projection
 * as the desktop. open must read the exact admitted input/history and authorize its
 * work certificate; parameters are references, never an alternative prompt or token.
 */
export function createChatTurnExecutor(host: {
	completion(
		request: PlanRunStartRequest,
		lease: Lease
	): Promise<{ state: 'completed' | 'failed'; contributionId: string } | null>
	open(request: PlanRunStartRequest, lease: Lease, signal?: AbortSignal): Promise<ChatTurnSession>
}): PlanRunExecutor {
	return async (request, context) => {
		if (
			request.protocol !== ACTOR_RUN_PROTOCOL ||
			request.skillRef !== CHAT_TURN_SKILL ||
			request.executionEnvironment !== 'server' ||
			!context?.lease
		)
			throw Error('Chat work requires an admitted server execution lease.')
		const parameters = chatTurnParameters.parse(request.parameters)
		await context.lease.assertActive()
		const published = await host.completion(request, context.lease)
		if (published) {
			if (published.state === 'failed')
				throw Error('The conversation ended with a saved failure; its outcome was not repeated.')
			return {
				remainingGoals: [],
				completedStepIds: [parameters.turnId],
				output: { kind: 'intent-turn', turnId: parameters.turnId, ...published }
			}
		}
		const session = await host.open(request, context.lease, context.signal)
		if (session.input.turnId !== parameters.turnId || session.input.user.role !== 'user')
			throw Error('Loaded conversation does not match the admitted turn.')
		const recent = new Map<number, OperationProgress>()
		const result = await executeDurableChat(session.input, {
			...session,
			signal: context.signal,
			progress: async (operation) => {
				recent.set(operation.ordinal, operation)
				while (recent.size > 24) recent.delete(recent.keys().next().value!)
				await context.reportProgress?.({
					kind: 'intent-turn',
					turnId: parameters.turnId,
					operation,
					steps: [...recent.values()]
				})
			}
		})
		await context.lease.assertActive()
		const outputId = await session.publish({
			state: result.state,
			text: result.reply.content,
			payload: turnPayload(result.reply)
		})
		if (result.state === 'failed')
			throw Error(result.failure ?? 'The conversation ended without a complete answer.')
		return {
			remainingGoals: [],
			completedStepIds: [parameters.turnId],
			output: {
				kind: 'intent-turn',
				turnId: parameters.turnId,
				contributionId: outputId,
				state: result.state
			}
		}
	}
}
