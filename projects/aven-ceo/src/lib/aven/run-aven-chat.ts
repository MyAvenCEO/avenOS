import { TinfoilAI } from 'tinfoil'
import { peekNextAssistantMessageIndex } from '$lib/aven/chat-message-log.js'
import type { AvenContextFull, AvenContextPreview } from '$lib/aven/context-preview'
import { buildAvenChatRoundContext } from '$lib/aven/live-context'
import { maiaAgent } from '$lib/aven/maia-agent'
import { memoryToolSourceAls } from '$lib/aven/memory-tool-context.js'
import {
	executeMemoryTool,
	memoryToolDoneLine,
	memoryToolPlanLine,
	memoryToolRunningLine,
	memoryToolsOpenAI,
	memoryToolTitlesLine
} from '$lib/memory/chat-tools'

type ChatCompletionTool = {
	type: 'function' | string
	function?: {
		name: string
		description?: string
		parameters?: unknown
	}
}

type ChatCompletionToolCall = {
	id: string
	type: 'function' | string
	function: {
		name: string
		arguments?: string
	}
}

type ChatCompletionMessageParam =
	| { role: 'system' | 'user'; content: string }
	| { role: 'assistant'; content: string; tool_calls?: ChatCompletionToolCall[] }
	| { role: 'tool'; tool_call_id: string; content: string }

type ChatCompletionResponse = {
	choices?: Array<{
		message?: {
			content?: string | null
			tool_calls?: ChatCompletionToolCall[]
		}
	}>
}

const MAX_TOOL_ROUNDS = maiaAgent.llm.maxToolRounds

export type ChatStreamEvent =
	| { type: 'context'; preview: AvenContextPreview; fullContext: AvenContextFull }
	| { type: 'status'; detail: string }
	| { type: 'done'; reply: string; model: string }
	| { type: 'error'; message: string; status: number }

async function* streamAvenChatCore(
	messages: { role: 'user' | 'assistant'; content: string }[],
	apiKey: string,
	model: string
): AsyncGenerator<ChatStreamEvent, void, void> {
	yield { type: 'status', detail: 'Maia · connecting…' }
	const client = new TinfoilAI({ apiKey })
	await client.ready()

	/** Same index as the `mN.md` file this turn will write on `done` (provenance for memory tools). */
	const reservedAssistantTurn = peekNextAssistantMessageIndex()

	const { systemContent, preview, fullContext } = await buildAvenChatRoundContext(model, messages)

	const tools = memoryToolsOpenAI() as ChatCompletionTool[]
	const thread: ChatCompletionMessageParam[] = [
		{ role: 'system', content: systemContent },
		...messages.map((m) => ({ role: m.role, content: m.content }))
	]

	yield {
		type: 'context',
		preview,
		fullContext
	}

	yield { type: 'status', detail: 'Maia · ready' }

	let prevRoundToolNames: string[] = []

	for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
		const thinkingDetail =
			round === 0
				? 'Maia · thinking…'
				: prevRoundToolNames.length > 0
					? `Maia · next · after ${memoryToolTitlesLine(prevRoundToolNames)}`
					: 'Maia · thinking…'
		yield {
			type: 'status',
			detail: thinkingDetail
		}

		let completion: ChatCompletionResponse
		try {
			completion = await (client.chat.completions.create as unknown as (input: {
				model: string
				temperature: number
				messages: ChatCompletionMessageParam[]
				tools: ChatCompletionTool[]
				tool_choice: 'none' | 'auto'
			}) => Promise<ChatCompletionResponse>)({
				model,
				temperature: maiaAgent.llm.temperature,
				messages: thread,
				tools,
				tool_choice: maiaAgent.llm.toolChoice === 'none' ? 'none' : 'auto'
			})
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e)
			yield { type: 'error', message, status: 502 }
			return
		}

		const choices = completion.choices
		if (!choices?.length) {
			yield { type: 'error', message: 'No assistant message.', status: 422 }
			return
		}

		const choice = choices[0]?.message
		if (!choice) {
			yield { type: 'error', message: 'No assistant message.', status: 422 }
			return
		}

		const toolCalls = choice.tool_calls
		if (toolCalls?.length) {
			thread.push({
				role: 'assistant',
				content: choice.content ?? '',
				tool_calls: toolCalls
			} as ChatCompletionMessageParam)

			const names = toolCalls
				.filter((tc: (typeof toolCalls)[number]): tc is (typeof toolCalls)[number] & { type: 'function' } => tc.type === 'function')
				.map((tc: (typeof toolCalls)[number] & { type: 'function' }) => tc.function.name)
			yield {
				type: 'status',
				detail: names.length > 0 ? `Maia · ${memoryToolPlanLine(names)}` : 'Maia · choosing tools…'
			}

			for (const tc of toolCalls) {
				if (tc.type !== 'function') continue
				const fn = tc.function
				let parsed: Record<string, unknown> = {}
				try {
					parsed = JSON.parse(fn.arguments || '{}') as Record<string, unknown>
				} catch {
					parsed = {}
				}

				yield { type: 'status', detail: `Maia · ${memoryToolRunningLine(fn.name, parsed)}` }
				const payload = await memoryToolSourceAls.run(
					{ type: 'talk', messageTurn: reservedAssistantTurn },
					() => executeMemoryTool(fn.name, parsed)
				)
				thread.push({
					role: 'tool',
					tool_call_id: tc.id,
					content: payload
				})
				yield { type: 'status', detail: `Maia · ${memoryToolDoneLine(fn.name)}` }
			}
			prevRoundToolNames = names
			yield { type: 'status', detail: 'Maia · next · reasoning…' }
			continue
		}

		const text = choice.content?.trim()
		if (!text) {
			yield { type: 'error', message: 'Assistant returned empty content.', status: 422 }
			return
		}
		yield { type: 'done', reply: text, model }
		return
	}

	yield {
		type: 'error',
		message: 'Stopped after maximum tool rounds (possible tool loop).',
		status: 422
	}
}

export async function* streamAvenChat(
	messages: { role: 'user' | 'assistant'; content: string }[],
	apiKey: string,
	model: string
): AsyncGenerator<ChatStreamEvent, void, void> {
	try {
		yield* streamAvenChatCore(messages, apiKey, model)
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e)
		yield { type: 'error', message, status: 500 }
	}
}

export async function runAvenChat(
	messages: { role: 'user' | 'assistant'; content: string }[],
	apiKey: string,
	model: string
): Promise<{ ok: true; reply: string } | { ok: false; message: string; status: number }> {
	for await (const ev of streamAvenChat(messages, apiKey, model)) {
		if (ev.type === 'done') return { ok: true, reply: ev.reply }
		if (ev.type === 'error') return { ok: false, message: ev.message, status: ev.status }
	}
	return { ok: false, message: 'Stream ended unexpectedly.', status: 500 }
}
