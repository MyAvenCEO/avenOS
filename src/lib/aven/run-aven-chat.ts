import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { TinfoilAI } from 'tinfoil'
import type { AvenContextPreview } from '$lib/aven/context-preview'
import { buildAvenChatRoundContext } from '$lib/aven/live-context'
import { maiaAgent } from '$lib/aven/maia-agent'
import {
	executeMemoryTool,
	memoryToolDoneLine,
	memoryToolPlanLine,
	memoryToolRunningLine,
	memoryToolsOpenAI
} from '$lib/memory/chat-tools'

const MAX_TOOL_ROUNDS = maiaAgent.llm.maxToolRounds

export type ChatStreamEvent =
	| { type: 'context'; preview: AvenContextPreview }
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

	const { systemContent, preview } = buildAvenChatRoundContext(model, messages)

	const tools = memoryToolsOpenAI()
	const thread: ChatCompletionMessageParam[] = [
		{ role: 'system', content: systemContent },
		...messages.map((m) => ({ role: m.role, content: m.content }))
	]

	yield {
		type: 'context',
		preview
	}

	yield { type: 'status', detail: 'Maia · ready' }

	for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
		yield {
			type: 'status',
			detail: round === 0 ? 'Maia · thinking…' : 'Maia · thinking after tools…'
		}

		let completion: Awaited<ReturnType<TinfoilAI['chat']['completions']['create']>>
		try {
			completion = await client.chat.completions.create({
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

		const choice = completion.choices[0]?.message
		if (!choice) {
			yield { type: 'error', message: 'No assistant message.', status: 422 }
			return
		}

		const toolCalls = choice.tool_calls
		if (toolCalls?.length) {
			thread.push({
				role: 'assistant',
				content: choice.content ?? null,
				tool_calls: toolCalls
			})

			const names = toolCalls
				.filter((tc): tc is typeof tc & { type: 'function' } => tc.type === 'function')
				.map((tc) => tc.function.name)
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
				const payload = executeMemoryTool(fn.name, parsed)
				thread.push({
					role: 'tool',
					tool_call_id: tc.id,
					content: payload
				})
				yield { type: 'status', detail: `Maia · ${memoryToolDoneLine(fn.name)}` }
			}
			yield { type: 'status', detail: 'Maia · back to reasoning…' }
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
