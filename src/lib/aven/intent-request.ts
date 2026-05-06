import { z } from 'zod'
import { WORKER_CATEGORY_KEYS } from '../worker-catalog'

export const classifyIntentArgsSchema = z.object({
	worker_mode: z.enum(['select', 'spawn']),
	worker_class: z.enum(WORKER_CATEGORY_KEYS),
	request_title: z.string(),
	instructions: z.string(),
	spawn_worker_key: z.string().optional(),
	spawn_worker_display_name: z.string().optional()
})

export type ClassifyIntentArgs = z.infer<typeof classifyIntentArgsSchema>

export const inferenceSnapshotSchema = z.object({
	model: z.string(),
	temperature: z.number().optional(),
	systemPrompt: z.string(),
	userIntentTemplate: z.string(),
	forcedToolName: z.string(),
	toolsJson: z.string(),
	responsesMissingApiKey: z.string().optional(),
	responsesNoToolCalls: z.string().optional(),
	responsesInvalidBody: z.string().optional()
})

export type InferenceSnapshot = z.infer<typeof inferenceSnapshotSchema>

export const postIntentBodySchema = z.object({
	intent: z.string().min(1),
	snapshot: inferenceSnapshotSchema
})

export type PostIntentBody = z.infer<typeof postIntentBodySchema>
