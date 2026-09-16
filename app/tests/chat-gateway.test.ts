import { describe, expect, test } from 'bun:test'
import {
	CHAT_MODEL,
	DESIGN_MODEL,
	openAiGatewayRequest,
	type ToolSpec
} from '../src/lib/chat/redpill'

const messages = [{ role: 'user' as const, content: 'Do the work.' }]
const tools: ToolSpec[] = [
	{
		name: 'todo_create',
		description: 'Create a todo.',
		parameters: {
			type: 'object',
			required: ['title'],
			properties: { title: { type: 'string' } }
		}
	}
]

describe('Tauri OpenAI gateway parity', () => {
	test('preserves the tuned streaming voice lane and OpenAI function tools', () => {
		expect(openAiGatewayRequest({ messages, tools })).toEqual({
			model: CHAT_MODEL,
			messages,
			stream: true,
			chat_template_kwargs: { enable_thinking: false },
			frequency_penalty: 0.3,
			max_tokens: 16_384,
			tools: [{ type: 'function', function: tools[0] }]
		})
	})

	test('preserves design-lane JSON mode, sampling, and bounded token budget', () => {
		expect(
			openAiGatewayRequest({
				messages,
				tools: [],
				model: DESIGN_MODEL,
				temperature: 3,
				json: true,
				max_tokens: 50_000
			})
		).toEqual({
			model: DESIGN_MODEL,
			messages,
			stream: true,
			max_tokens: 32_768,
			response_format: { type: 'json_object' },
			temperature: 2
		})
	})
})

test('verification supports a separately bounded JSON completion without reasoning', () => {
	const request = openAiGatewayRequest({
		messages,
		tools: [],
		model: 'qwen-test',
		thinking: false,
		json: true,
		max_tokens: 2048
	})
	expect(request.max_tokens).toBe(2048)
	expect(request.chat_template_kwargs).toEqual({ enable_thinking: false })
	expect(request.response_format).toEqual({ type: 'json_object' })
	expect(request.tools).toBeUndefined()
})
