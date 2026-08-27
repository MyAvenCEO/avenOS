import { describe, expect, test } from 'vitest'
import { DocumentModelService } from '../src/lib/server/document-model.js'
import { testConfig } from './helpers.js'

const config = () =>
	testConfig({
		ARTIFACT_PROCESSOR_VISION_ENABLED: 'true',
		ARTIFACT_PROCESSOR_VISION_BASE_URL: 'https://vision.example.test/v1',
		ARTIFACT_PROCESSOR_VISION_MODEL: 'gpt-4.1',
		ARTIFACT_PROCESSOR_VISION_PROFILE: 'openai-json-schema',
		ARTIFACT_PROCESSOR_VISION_AUTH_MODE: 'bearer',
		ARTIFACT_PROCESSOR_VISION_API_KEY: 'document-model-secret-key',
		ARTIFACT_PROCESSOR_VISION_MAX_PAGES: '15'
	})

describe('document model gateway', () => {
	test('forwards one bounded multimodal contract without moving document logic server-side', async () => {
		let outbound: Request | undefined
		const fetch: typeof globalThis.fetch = async (input, init) => {
			outbound = new Request(input, init)
			return new Response(
				JSON.stringify({
					id: 'provider-7',
					model: 'gpt-4.1-2026-08-01',
					choices: [{ message: { content: '{"resolvedKind":"invoice"}' } }],
					usage: { prompt_tokens: 120, completion_tokens: 8 }
				}),
				{ headers: { 'content-type': 'application/json', 'x-request-id': 'http-9' } }
			)
		}
		const service = DocumentModelService.fromConfig(config(), fetch)
		expect(service).not.toBeNull()
		const completed = await service?.complete({
			procedure: 'classify-document',
			contractVersion: 'aven-finance-vision-v2',
			prompt: 'Classify the complete visible document.',
			schema: {
				type: 'object',
				additionalProperties: false,
				required: ['resolvedKind'],
				properties: { resolvedKind: { type: 'string', minLength: 1 } }
			},
			images: [{ page: 1, mediaType: 'image/png', base64: 'eA==' }],
			documentText: 'Invoice 42'
		})

		expect(outbound?.url).toBe('https://vision.example.test/v1/chat/completions')
		expect(outbound?.headers.get('authorization')).toBe('Bearer document-model-secret-key')
		expect(outbound?.headers.get('idempotency-key')).toMatch(/^[a-f0-9]{64}$/)
		const body = (await outbound?.json()) as Record<string, unknown>
		expect(body.model).toBe('gpt-4.1')
		expect(body.response_format).toMatchObject({
			type: 'json_schema',
			json_schema: { name: 'classify_document', strict: true }
		})
		expect(JSON.stringify(body.messages)).toContain('data:image/png;base64,eA==')
		expect(JSON.stringify(body.messages)).toContain('<document-text>')
		expect(completed?.structured).toEqual({ resolvedKind: 'invoice' })
		expect(completed?.receipt).toMatchObject({
			providerRequestId: 'provider-7',
			httpRequestId: 'http-9',
			model: 'gpt-4.1-2026-08-01',
			profile: 'openai-json-schema'
		})
	})

	test('rejects image input above the configured page limit before calling the provider', async () => {
		let called = false
		const service = DocumentModelService.fromConfig(config(), async () => {
			called = true
			return new Response('{}')
		})
		await expect(
			service?.complete({
				procedure: 'analyze-page',
				contractVersion: 'aven-finance-vision-v2',
				prompt: 'Analyze.',
				schema: { type: 'object' },
				images: [
					{ page: 1, mediaType: 'image/png', base64: 'eA==' },
					{ page: 2, mediaType: 'image/png', base64: 'eA==' }
				],
				documentText: ''
			})
		).rejects.toMatchObject({ code: 'DOCUMENT_MODEL_PAGE_LIMIT' })
		expect(called).toBe(false)
	})
})
