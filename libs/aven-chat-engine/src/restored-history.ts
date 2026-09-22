import { admittedMessage, type InputAdmission } from './input-admission'
import type { ChatMessage } from './model'
import { type ToolCall, toolArgumentsError, toolDetail } from './tool-call'
import { retainedToolResult, TOOL_EVIDENCE_LIMIT } from './tool-result-evidence'

export const HISTORICAL_TOOL_RESULT_LIMIT = TOOL_EVIDENCE_LIMIT

/** Research checklists and quote handles belong to one answer, not a continuing
 * action. Keep their diagnostics in the saved/UI trace, but do not present them
 * as active tool state for the next question. Ordinary effect receipts remain. */
export function withoutHistoricalResearch(wire: readonly ChatMessage[]): ChatMessage[] {
	const omitted = new Set(
		wire
			.flatMap((message) => message.tool_calls ?? [])
			.filter((call) => call.function.name === 'research_record')
			.map((call) => call.id)
	)
	return wire.flatMap((message) => {
		if (message.role === 'tool' && message.tool_call_id && omitted.has(message.tool_call_id))
			return []
		if (!message.tool_calls) return [message]
		const calls = message.tool_calls.filter((call) => !omitted.has(call.id))
		if (calls.length) return [{ ...message, tool_calls: calls }]
		const { tool_calls: _calls, ...text } = message
		return text.content ? [text] : []
	})
}

/** A missing/oversized receipt is explicit, never a half-JSON record or invented success. */
export function historicalToolResult(call: Pick<ToolCall, 'status' | 'result'>): string {
	if (call.status !== 'completed' && call.status !== 'failed')
		return JSON.stringify({
			observedStatus: call.status,
			resultRetained: false,
			notice: 'The outcome was not confirmed. Check its exact receipt before retrying a change.'
		})
	return JSON.stringify(
		retainedToolResult(
			call.result,
			'The full result is not in this recent history. Read its saved receipt or query current state; do not infer IDs, values or absence from this excerpt.'
		)
	)
}

/** Earlier observations may establish earlier effects, never current state or
 * fresh authority. Keep them distinct from the tools executed in this answer. */
export function historicalToolEvidence(
	turns: readonly {
		id: string
		role: 'user' | 'assistant'
		calls?: ToolCall[]
	}[]
) {
	const observations: Array<Record<string, unknown>> = []
	let omitted = 0,
		size = 0
	for (const turn of turns.slice(-12).reverse()) {
		if (turn.role !== 'assistant') continue
		for (const call of [...(turn.calls ?? [])].reverse()) {
			if (call.name === 'research_record') continue
			const value = {
				responseId: turn.id,
				name: call.name,
				observedStatus: call.status,
				observedAt: call.startedAt,
				receipt: JSON.parse(historicalToolResult(call))
			}
			const length = JSON.stringify(value).length
			if (observations.length >= 8 || size + length > 24000) {
				omitted++
				continue
			}
			size += length
			observations.unshift(value)
		}
	}
	return {
		observations,
		omitted,
		notice:
			'Bounded earlier tool observations, not actions in the current turn or proof of current state. Absence here is not evidence that an earlier action did not happen.'
	}
}

/** Reconstruct observed tool/result pairs, not just what the assistant said about them. */
export function restoredWireMessages(
	turns: readonly {
		id: string
		role: 'user' | 'assistant'
		content: string
		inputAdmission?: InputAdmission
		calls?: ToolCall[]
	}[]
): ChatMessage[] {
	return withoutHistoricalResearch(
		turns.flatMap((turn) => {
			const messages: ChatMessage[] = []
			if (turn.role === 'assistant')
				for (const [index, call] of (turn.calls ?? [])
					.filter((call) => call.name !== 'research_record')
					.slice(-4)
					.entries()) {
					if (!/^[a-zA-Z0-9_-]{1,64}$/.test(call.name)) continue
					const id = `history-${turn.id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)}-${index}`
					let args = JSON.stringify({
						retainedArguments: false,
						notice: 'Historical arguments omitted; this is not a new invocation.'
					})
					if (call.arguments.length <= 4000 && !toolArgumentsError(call.arguments)) {
						try {
							args = JSON.stringify(JSON.parse(toolDetail(call.arguments)))
						} catch {
							/* Keep the omission marker. */
						}
					}
					messages.push(
						{
							role: 'assistant',
							content: '',
							tool_calls: [{ id, type: 'function', function: { name: call.name, arguments: args } }]
						},
						{ role: 'tool', tool_call_id: id, content: historicalToolResult(call) }
					)
				}
			if (turn.content) messages.push({ role: turn.role, content: admittedMessage(turn) })
			return messages
		})
	)
}
