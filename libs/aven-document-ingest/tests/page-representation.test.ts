import { describe, expect, test, vi } from 'vitest'
import { createContentAggregatorActor } from '../src/actors/content-aggregator'
import { createVisualPageAnalyzerActor } from '../src/actors/visual-page-analyzer'
import type { DocumentModelGateway } from '../src/model'
import { parseDocumentActorResult } from '../src/results'
import { materializePage } from '../src/shared'

const page = {
	page: 1,
	rotation: 0 as const,
	width: 600,
	height: 800,
	runs: [{ text: 'Grüße, mañana — 金額 €119', x: 1, y: 2, width: 300, height: 40 }]
}

const receipt = {
	model: 'test',
	profile: 'qwen-tools',
	requestKey: 'test',
	promptDigest: 'test',
	implementationDigest: 'test'
}

describe('page representations', () => {
	test('keeps native UTF-8 bytes and layout without asking a model to transcribe text', async () => {
		const complete = vi.fn(async () => ({
			structured: { text: '', blocks: [], complete: false },
			receipt
		}))
		const model: DocumentModelGateway = {
			status: async () => ({ available: true, maxPages: 1 }),
			complete
		}
		const actor = createVisualPageAnalyzerActor(model)
		try {
			const native = materializePage(page)
			const response = await actor.deliver('document_analyze_page', { page, extracted: native })
			const result = parseDocumentActorResult(response.record)
			expect(complete).not.toHaveBeenCalled()
			expect(result.procedureKey).toBe('client.preserve-text-page')
			expect(result.modelReceipt).toBeUndefined()
			const text = result.artifacts.find((a) => a.localKey === 'text')!
			expect(Buffer.from(text.blob!.base64, 'base64').toString()).toBe(native.text)
			expect(text.payload).toMatchObject({ method: 'native', complete: true })
			expect(result.artifacts.find((a) => a.localKey === 'layout')?.payload.spans).toEqual(
				native.spans
			)
			expect(result.artifacts.find((a) => a.localKey === 'classification')?.payload).toMatchObject({
				primaryKind: 'text',
				resolutionMode: 'rule'
			})
		} finally {
			actor.dispose()
		}
	})

	test('uses the rendered page to correct misleading native PDF text', async () => {
		const complete = vi.fn(async () => ({
			receipt,
			structured: {
				text: 'Visible €119',
				language: 'en',
				complete: true,
				blocks: [{ text: 'Visible €119', x: 1, y: 2, width: 300, height: 40 }],
				primaryKind: 'document',
				facets: ['raster-text'],
				confidenceBps: 9900,
				reason: 'Printed invoice',
				summary: 'Invoice',
				topics: ['invoice']
			}
		}))
		const actor = createVisualPageAnalyzerActor({
			complete,
			status: async () => ({ available: true, maxPages: 1 })
		})
		try {
			const result = parseDocumentActorResult(
				(
					await actor.deliver('document_analyze_page', {
						page: { ...page, image: { mediaType: 'image/png', base64: 'eA==' } },
						extracted: { ...materializePage(page), text: 'Bad native text' }
					})
				).record
			)
			expect(complete).toHaveBeenCalledOnce()
			const text = result.artifacts.find((a) => a.localKey === 'text')!
			expect(Buffer.from(text.blob!.base64, 'base64').toString()).toBe('Visible €119')
			expect(text.payload.method).toBe('ocr')
			expect(result.modelReceipt).toEqual(receipt)
		} finally {
			actor.dispose()
		}
	})

	test.each([
		[[], 'unknown'],
		[['text'], 'text'],
		[['image', 'image'], 'image'],
		[['text', 'blank'], 'text'],
		[['blank'], 'blank'],
		[['other'], 'other'],
		[['mixed'], 'mixed'],
		[['document', 'image'], 'mixed'],
		[['document', 'unknown'], 'unknown']
	])('aggregates %j as %s', async (kinds, expected) => {
		const actor = createContentAggregatorActor()
		try {
			const result = parseDocumentActorResult(
				(
					await actor.deliver('document_aggregate_content', {
						pages: (kinds as string[]).map((primaryKind, i) => ({
							page: i + 1,
							primaryKind,
							facets: [],
							complete: true
						}))
					})
				).record
			)
			expect(result.artifacts[0]?.payload.primaryKind).toBe(expected)
		} finally {
			actor.dispose()
		}
	})
})
