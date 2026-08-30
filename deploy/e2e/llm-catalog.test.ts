import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

describe('deterministic E2E LLM catalog', () => {
	test('does not claim document model capabilities for the chat-only mock', async () => {
		const compose = await readFile(new URL('./docker-compose.yml', import.meta.url), 'utf8')
		const catalog = compose.match(/LLM_GATEWAY_MODELS_JSON: '([^'\n]+)'/)?.[1]
		expect(catalog).toBeTruthy()
		const [model] = JSON.parse(catalog ?? '[]') as Array<{ capabilities?: string[] }>
		expect(model?.capabilities).toEqual(['text-generation', 'streaming', 'tool-calling'])
		expect(model?.capabilities).not.toContain('vision')
		expect(model?.capabilities).not.toContain('structured-output')
	})
})
