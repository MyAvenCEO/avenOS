import { z } from 'zod'
import { api, requireUser } from '$lib/server/api.js'
import type { DocumentModelRequest } from '$lib/server/document-model.js'
import { AppError } from '$lib/server/errors.js'

const requestSchema = z
	.object({
		procedure: z.enum([
			'analyze-page',
			'classify-document',
			'extract-invoice',
			'extract-statement'
		]),
		contractVersion: z.literal('aven-finance-vision-v2'),
		prompt: z.string().min(1).max(12_000),
		schema: z.record(z.string(), z.unknown()),
		images: z
			.array(
				z
					.object({
						page: z.number().int().min(1).max(63),
						mediaType: z.enum(['image/png', 'image/jpeg']),
						base64: z.string().min(4).max(16_800_000)
					})
					.strict()
			)
			.min(1)
			.max(63),
		documentText: z.string().max(2_000_000),
		expectedKind: z
			.enum([
				'invoice',
				'credit-note',
				'receipt',
				'self-issued-receipt',
				'mandate',
				'order-confirmation',
				'offer',
				'reminder',
				'bank-statement',
				'payment-receipt'
			])
			.optional()
	})
	.strict()

export const POST = api(async (event, rt) => {
	await requireUser(event)
	if (!rt.documentModel) {
		throw new AppError(503, 'DOCUMENT_MODEL_UNAVAILABLE', 'Document model is not configured.')
	}
	const request = requestSchema.parse(await event.request.json()) as DocumentModelRequest
	return { body: await rt.documentModel.complete(request) }
})

export const GET = api(async (event, rt) => {
	await requireUser(event)
	return {
		body: {
			available: Boolean(rt.documentModel),
			maxPages: rt.config.ARTIFACT_PROCESSOR_VISION_MAX_PAGES
		}
	}
})
