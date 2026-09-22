import { z } from 'zod'
import { feedbackCheckSchema } from './feedback'
import { sourceContextSchema } from './source-context'

const timezone = z
	.string()
	.min(1)
	.max(100)
	.refine((value) => {
		try {
			new Intl.DateTimeFormat('en', { timeZone: value })
			return true
		} catch {
			return false
		}
	}, 'Use a recognized timezone.')
const locale = z
	.string()
	.min(1)
	.max(35)
	.refine((value) => {
		try {
			return Intl.getCanonicalLocales(value).length === 1
		} catch {
			return false
		}
	}, 'Use a valid language tag.')

export const inputReferenceSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('artifact'), id: z.uuid() }).strict(),
	z.object({ kind: z.literal('case'), id: z.uuid() }).strict(),
	z
		.object({ kind: z.literal('skill-draft'), id: z.uuid(), revision: z.number().int().positive() })
		.strict()
])

/** Captured UI identities and timezone, not mutable screen state or authority. */
export const inputViewSchema = z
	.object({ timezone, references: z.array(inputReferenceSchema).max(8) })
	.strict()
export type InputReference = z.infer<typeof inputReferenceSchema>
/** Private pending-input storage only. Server admission rejects this display prompt. */
export const inputCaptureSchema = inputViewSchema.extend({ prompt: z.string().max(32_000) })
export type InputCapture = z.infer<typeof inputCaptureSchema>

/** Exact human input and bounded screen references, never an executable prompt or bearer. */
export const inputAdmissionSchema = z
	.object({
		inputId: z.uuid(),
		revision: z.number().int().min(1).max(1_000_000),
		text: z
			.string()
			.min(1)
			.max(16_000)
			.refine((value) => !!value.trim()),
		originalText: z.string().min(1).max(8000),
		corrections: z.array(z.string().min(1).max(8000)).max(20),
		target: z.discriminatedUnion('kind', [
			z.object({ kind: z.literal('existing'), id: z.uuid() }).strict(),
			z.object({ kind: z.literal('new'), title: z.string().trim().min(1).max(160) }).strict()
		]),
		locale,
		timezone,
		capturedAt: z.iso.datetime({ offset: true }),
		decisionId: z.uuid(),
		confirmed: z.boolean(),
		/** Optional because a human can choose a destination when model routing is unavailable. */
		responseMode: z.enum(['clarify', 'work']).optional(),
		sourceContext: sourceContextSchema.optional(),
		feedbackCheck: feedbackCheckSchema.optional(),
		references: inputViewSchema.shape.references,
		/** A new immutable input replaces this exact turn; it never rewrites admitted text or undoes effects. */
		replaces: z
			.object({ turnId: z.uuid(), expectedControlRevision: z.number().int().positive() })
			.strict()
			.optional(),
		speaker: z
			.object({
				session_id: z.string().min(1).max(256),
				speaker_id: z.string().regex(/^speaker-[1-9]\d*$/),
				confidence: z.number().min(0).max(1)
			})
			.strict()
			.optional()
	})
	.strict()
	.superRefine((value, context) => {
		if (value.replaces && value.target.kind !== 'existing')
			context.addIssue({
				code: 'custom',
				path: ['target'],
				message: 'An edit stays in its existing Intent.'
			})
	})

export type InputAdmission = z.infer<typeof inputAdmissionSchema>
export const admissionReceiptSchema = z
	.object({
		inputId: z.uuid(),
		revision: z.number().int().positive(),
		contributionId: z.uuid(),
		intentId: z.uuid(),
		intentTitle: z.string().min(1).max(512),
		turnId: z.uuid(),
		sequence: z.number().int().positive(),
		admittedAt: z.iso.datetime({ offset: true })
	})
	.strict()
export type AdmissionReceipt = z.infer<typeof admissionReceiptSchema>

/** Parse before hashing: field order cannot change identity; unknown material is rejected. */
export async function admissionDigest(input: InputAdmission): Promise<string> {
	const canonical = (value: unknown): unknown =>
		Array.isArray(value)
			? value.map(canonical)
			: value && typeof value === 'object'
				? Object.fromEntries(
						Object.entries(value)
							.filter(([, v]) => v !== undefined)
							.sort(([a], [b]) => a.localeCompare(b))
							.map(([k, v]) => [k, canonical(v)])
					)
				: value
	const material = JSON.stringify(canonical(inputAdmissionSchema.parse(input)))
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material))
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
