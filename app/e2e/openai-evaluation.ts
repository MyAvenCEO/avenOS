/** Opt-in synthetic evaluation only. Credentials never enter the app or evidence. */
import { appendFile, readFile } from 'node:fs/promises'
import type { ChatMessage, streamChat } from '../src/lib/chat/redpill'

type ResponseItem = Record<string, unknown>

/** Preserve native reasoning/tool items only while their calls remain in this conversation. */
export function evaluationInput(messages: ChatMessage[], outputs: Map<string, ResponseItem[]>) {
	const active = new Set(
		messages.flatMap((message) => message.tool_calls?.map((call) => call.id) ?? [])
	)
	for (const id of outputs.keys()) if (!active.has(id)) outputs.delete(id)
	return messages.flatMap((message): ResponseItem[] => {
		if (message.role === 'tool') {
			if (!message.tool_call_id) throw Error('Tool result is missing its call ID.')
			return [
				{ type: 'function_call_output', call_id: message.tool_call_id, output: message.content }
			]
		}
		const saved = message.tool_calls?.[0] && outputs.get(message.tool_calls[0].id)
		if (saved)
			return saved.map((item) => {
				if (item.type !== 'function_call') return item
				const current = message.tool_calls?.find((call) => call.id === item.call_id)
				return current ? { ...item, arguments: current.function.arguments } : item
			})
		return [
			...(message.content ? [{ role: message.role, content: message.content }] : []),
			...(message.tool_calls ?? []).map((call) => ({
				type: 'function_call',
				call_id: call.id,
				name: call.function.name,
				arguments: call.function.arguments
			}))
		]
	})
}

export function openAIEvaluationStream(model = 'gpt-5.6-terra'): typeof streamChat {
	const prices: Record<string, [number, number]> = {
		'gpt-5.6-terra': [2, 12],
		'gpt-5.6-sol': [4, 20]
	}
	const price = prices[model]
	if (!price) throw Error('Record pricing before using another evaluation model.')
	let committed = 0
	const outputs = new Map<string, ResponseItem[]>()
	const budget = Number(process.env.OPENAI_EVALUATION_BUDGET_USD ?? 3)
	if (!Number.isFinite(budget) || budget <= 0) throw Error('Invalid evaluation budget.')
	return async function* (messages, tools, signal, _model, options) {
		const maxTokens = Math.max(4096, options?.max_tokens ?? 4096)
		const input = evaluationInput(messages, outputs)
		// UTF-8 bytes bound the possible input token count conservatively.
		const reserve =
			(Buffer.byteLength(JSON.stringify({ input, tools })) * price[0] + maxTokens * price[1]) / 1e6
		if (committed + reserve > budget) throw Error('Independent evaluation budget exhausted.')
		committed += reserve
		const keyFile = process.env.OPENAI_API_KEY_FILE
		if (!process.env.OPENAI_API_KEY && !keyFile)
			throw Error('Set OPENAI_API_KEY_FILE or OPENAI_API_KEY for opt-in evaluation.')
		const key = (
			process.env.OPENAI_API_KEY ?? (keyFile ? await readFile(keyFile, 'utf8') : '')
		).trim()
		const response = await fetch('https://api.openai.com/v1/responses', {
			method: 'POST',
			headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
			body: JSON.stringify({
				model,
				input,
				max_output_tokens: maxTokens,
				reasoning: { effort: 'medium' },
				include: ['reasoning.encrypted_content'],
				...(options?.json ? { text: { format: { type: 'json_object' } } } : {}),
				...(tools.length
					? { tools: tools.map((tool) => ({ type: 'function', ...tool, strict: false })) }
					: {}),
				store: false
			}),
			signal: signal
				? AbortSignal.any([signal, AbortSignal.timeout(180000)])
				: AbortSignal.timeout(180000)
		})
		if (!response.ok) {
			const problem = (await response.json().catch(() => ({}))) as {
				error?: { message?: string; param?: string; code?: string }
			}
			const detail = String(problem.error?.message ?? problem.error?.code ?? '')
				.replaceAll(key, '[redacted]')
				.replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]')
				.slice(0, 1000)
			throw Error(`Independent evaluation HTTP ${response.status}: ${detail}`)
		}
		const value = (await response.json()) as {
			status: string
			incomplete_details?: { reason?: string }
			output: Array<
				ResponseItem & {
					type: string
					call_id?: string
					name?: string
					arguments?: string
					content?: Array<{ type: string; text?: string }>
				}
			>
			usage: { input_tokens: number; output_tokens: number }
		}

		if (
			!Number.isSafeInteger(value.usage?.input_tokens) ||
			!Number.isSafeInteger(value.usage?.output_tokens)
		)
			throw Error('Missing evaluation usage; reservation retained.')
		const cost = (value.usage.input_tokens * price[0] + value.usage.output_tokens * price[1]) / 1e6
		committed += cost - reserve
		await appendFile(
			process.env.OPENAI_EVALUATION_COST_PATH ?? '/tmp/aven-evaluation-cost.jsonl',
			`${JSON.stringify({ model, usage: value.usage, estimatedCostUsd: cost })}\n`,
			{ mode: 0o600 }
		)
		if (!Array.isArray(value.output)) throw Error('Missing evaluation output.')
		let index = 0
		for (const item of value.output) {
			if (item.type === 'message')
				for (const content of item.content ?? [])
					if (content.type === 'output_text' && content.text)
						yield { kind: 'text', text: content.text }
			if (item.type === 'function_call') {
				if (!item.call_id || !item.name || typeof item.arguments !== 'string')
					throw Error('Incomplete evaluation tool call.')
				if (index === 0) outputs.set(item.call_id, value.output)
				yield {
					kind: 'tool',
					index: index++,
					id: item.call_id,
					name: item.name,
					args: item.arguments
				}
			}
		}
		yield { kind: 'usage', usage: { ...value.usage, model, estimatedCostUsd: cost } }
		yield {
			kind: 'finish',
			reason:
				value.status === 'completed'
					? index
						? 'tool_calls'
						: 'stop'
					: (value.incomplete_details?.reason ?? value.status)
		}
	}
}
