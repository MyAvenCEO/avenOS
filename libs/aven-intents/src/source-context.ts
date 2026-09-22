import { z } from 'zod'

/** A captured excerpt, not a transcript export, verified fact or grant of authority. */
export const sourceContextSchema = z
	.object({
		intentId: z.string().min(1).max(160),
		capturedAt: z.iso.datetime(),
		messages: z
			.array(
				z
					.object({
						id: z.string().min(1).max(160),
						role: z.enum(['user', 'assistant']),
						content: z.string().min(1).max(800),
						shortened: z.boolean()
					})
					.strict()
			)
			.min(1)
			.max(4)
	})
	.strict()

export type SourceContext = z.infer<typeof sourceContextSchema>

export function readSourceContext(value: unknown): SourceContext | undefined {
	const result = sourceContextSchema.safeParse(value)
	return result.success ? result.data : undefined
}
