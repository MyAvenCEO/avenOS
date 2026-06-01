import { d as recordExtractionFailure, u as memoryIngestDocument } from "../../../../../chunks/vault.js";
import { json } from "@sveltejs/kit";
import { z } from "zod";
//#region src/routes/api/memory/ingest/+server.ts
var ingestSchema = z.object({
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
});
var failureSchema = z.object({
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
});
var POST = async ({ request }) => {
	let raw;
	try {
		raw = await request.json();
	} catch {
		return json({
			ok: false,
			error: "Expected JSON body."
		}, { status: 400 });
	}
	const parsed = ingestSchema.safeParse(raw);
	if (!parsed.success) return json({
		ok: false,
		error: parsed.error.message
	}, { status: 400 });
	try {
		return json(await memoryIngestDocument(parsed.data));
	} catch (error) {
		return json({
			ok: false,
			error: error instanceof Error ? error.message : String(error)
		}, { status: 500 });
	}
};
var PATCH = async ({ request }) => {
	let raw;
	try {
		raw = await request.json();
	} catch {
		return json({
			ok: false,
			error: "Expected JSON body."
		}, { status: 400 });
	}
	const parsed = failureSchema.safeParse(raw);
	if (!parsed.success) return json({
		ok: false,
		error: parsed.error.message
	}, { status: 400 });
	try {
		const run = await recordExtractionFailure(parsed.data);
		return json({
			ok: true,
			runId: run.id,
			status: run.status
		});
	} catch (error) {
		return json({
			ok: false,
			error: error instanceof Error ? error.message : String(error)
		}, { status: 500 });
	}
};
//#endregion
export { PATCH, POST };
