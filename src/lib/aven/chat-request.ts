import { z } from 'zod'

export const avenChatMessageSchema = z.object({
	role: z.enum(['user', 'assistant']),
	content: z.string()
})

export const avenChatBodySchema = z.object({
	messages: z.array(avenChatMessageSchema).min(1),
	model: z.string().optional(),
	/** When true, response is application/x-ndjson with status + done events */
	stream: z.boolean().optional()
})

export type AvenChatBody = z.infer<typeof avenChatBodySchema>
