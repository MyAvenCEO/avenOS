import type { JaensenInput } from './types.js'

export function normalizeWebhookPayload(payload: unknown): JaensenInput {
	if (typeof payload === 'string') return { message: payload }
	if (payload && typeof payload === 'object') {
		const record = payload as Record<string, unknown>
		const subject = asOptionalString(record.subject)
		const body = asOptionalString(record.message) ?? asOptionalString(record.body) ?? asOptionalString(record.text) ?? JSON.stringify(record, null, 2)
		return {
			message: [subject ? `Subject: ${subject}` : '', body].filter(Boolean).join('\n\n'),
			from: asOptionalString(record.from),
			subject,
			metadata: record,
			attachment: normalizeAttachment(record.attachment)
		}
	}
	return { message: String(payload ?? '') }
}

function normalizeAttachment(value: unknown): JaensenInput['attachment'] {
	if (!value || typeof value !== 'object') return undefined
	const attachment = value as Record<string, unknown>
	const archiveKey = asOptionalString(attachment.archiveKey) ?? asOptionalString(attachment.key)
	const base64 = asOptionalString(attachment.base64) ?? asOptionalString(attachment.content)
	if (!base64 && !archiveKey) return undefined
	return {
		archiveKey,
		name: asOptionalString(attachment.name) ?? asOptionalString(attachment.filename),
		contentType: asOptionalString(attachment.contentType),
		base64
	}
}

function asOptionalString(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined
}