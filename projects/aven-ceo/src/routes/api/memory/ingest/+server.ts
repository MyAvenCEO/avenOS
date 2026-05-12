import { json } from '@sveltejs/kit'
import { z } from 'zod'
import { memoryIngestDocument, recordExtractionFailure } from '$lib/memory/jazz-memory-store'
import type { RequestHandler } from './$types'

const ingestSchema = z.object({
	artifact: z.object({
		sha256: z.string().min(1),
		originalName: z.string().min(1),
		mimeType: z.string().min(1),
		sizeBytes: z.number().int().nonnegative(),
		storageUri: z.string().min(1)
	}),
	extraction: z.object({
		extractor: z.string().min(1),
		summary: z.string(),
		bodyMarkdown: z.string(),
		chunks: z.array(z.string())
	})
})

const failureSchema = z.object({
	artifact: z.object({
		sha256: z.string().min(1),
		originalName: z.string().min(1),
		mimeType: z.string().min(1),
		sizeBytes: z.number().int().nonnegative(),
		storageUri: z.string().min(1)
	}),
	extractor: z.string().min(1),
	error: z.string().min(1),
	skillId: z.string().min(1).optional()
})

export const POST: RequestHandler = async ({ request }) => {
	let raw: unknown
	try {
		raw = await request.json()
	} catch {
		return json({ ok: false as const, error: 'Expected JSON body.' }, { status: 400 })
	}

	const parsed = ingestSchema.safeParse(raw)
	if (!parsed.success) {
		return json({ ok: false as const, error: parsed.error.message }, { status: 400 })
	}

	try {
		const result = await memoryIngestDocument(parsed.data)
		return json(result)
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		return json({ ok: false as const, error: message }, { status: 500 })
	}
}

export const PATCH: RequestHandler = async ({ request }) => {
	let raw: unknown
	try {
		raw = await request.json()
	} catch {
		return json({ ok: false as const, error: 'Expected JSON body.' }, { status: 400 })
	}

	const parsed = failureSchema.safeParse(raw)
	if (!parsed.success) {
		return json({ ok: false as const, error: parsed.error.message }, { status: 400 })
	}

	try {
		const run = await recordExtractionFailure(parsed.data)
		return json({ ok: true as const, runId: run.id, status: run.status })
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		return json({ ok: false as const, error: message }, { status: 500 })
	}
}