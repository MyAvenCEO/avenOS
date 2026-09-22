import { describe, expect, test } from 'bun:test'
import { e2eModelCatalog } from './llm-catalog'

describe('deterministic E2E LLM catalog', () => {
	test('the live native lane has no synthetic-model fallback for any operation', () => {
		expect(() => e2eModelCatalog({ E2E_LIVE_CHAT: 'true' })).toThrow(/real Qwen/)
		const catalog = e2eModelCatalog({
			E2E_LIVE_CHAT: 'true',
			TEST_DOCUMENT_PROVIDER_BASE_URL: 'http://model.example.test:8000/v1',
			TEST_DOCUMENT_PROVIDER_MODEL: 'qwen-proof',
			TEST_DOCUMENT_PROVIDER_PROFILE: 'qwen-tools'
		})
		for (const entry of catalog) {
			expect(entry.baseUrl).toBe('http://model.example.test:8000/v1')
			expect(entry.upstreamModel).toBe('qwen-proof')
		}
	})
	test('keeps chat and explicitly synthetic document capabilities separate', async () => {
		const [model, documents] = e2eModelCatalog({})
		expect(model?.capabilities).toEqual([
			'text-generation',
			'streaming',
			'tool-calling',
			'structured-output'
		])
		expect(model?.capabilities).not.toContain('vision')
		// Chat evidence review returns structured JSON; this is not a vision model.
		expect(documents?.capabilities).toEqual(['text-generation', 'vision', 'structured-output'])
	})
	test('live OCR is explicit and never changes the chat provider', () => {
		const catalog = e2eModelCatalog({
			TEST_DOCUMENT_PROVIDER_BASE_URL: 'http://model.example.test:8000/v1',
			TEST_DOCUMENT_PROVIDER_MODEL: 'example-vision',
			TEST_DOCUMENT_PROVIDER_PROFILE: 'qwen-tools'
		})
		expect(catalog[0]).toEqual(e2eModelCatalog({})[0])
		expect(catalog[1]).toMatchObject({
			upstreamModel: 'example-vision',
			profile: 'qwen-tools',
			timeoutSeconds: 45
		})
		expect(() => e2eModelCatalog({ TEST_DOCUMENT_PROVIDER_MODEL: 'incomplete' })).toThrow()
		expect(() =>
			e2eModelCatalog({
				TEST_DOCUMENT_PROVIDER_BASE_URL: 'file:///tmp/model',
				TEST_DOCUMENT_PROVIDER_MODEL: 'model'
			})
		).toThrow()
	})
})
