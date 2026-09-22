import type { z } from 'zod'
import { httpInspectionSchema, httpResponseSchema } from './artifact-types'

const hasDisallowedControlCharacter = (value: string) =>
	[...value].some((character) => {
		const code = character.charCodeAt(0)
		return code < 32 && code !== 9 && code !== 10 && code !== 13
	})

/** Bounded representation inspection, not malware scanning or business validation.
 * Never contacts the origin or evaluates downloaded content. */
export function inspectHttpData(response: unknown, bytes: Uint8Array) {
	const value = httpResponseSchema.parse(response)
	if (bytes.length > 4194304 || value.storedBodyLength !== bytes.length)
		throw Error('HTTP_INSPECTION_BODY_LIMIT_OR_MISMATCH')
	const declared = value.declaredMediaType?.toLowerCase() ?? null
	const result = (
		outcome: z.infer<typeof httpInspectionSchema>['outcome'],
		detectedMediaType: z.infer<typeof httpInspectionSchema>['detectedMediaType'],
		reason: z.infer<typeof httpInspectionSchema>['reason']
	) =>
		httpInspectionSchema.parse({
			profile: 'utf8-data-v1',
			outcome,
			detectedMediaType,
			declaredMediaType: declared,
			byteLength: bytes.length,
			reason
		})
	if (!bytes.length) return result('no-content', null, 'empty')
	if (value.declaredCharset && !/^(utf-8|utf8|us-ascii)$/i.test(value.declaredCharset))
		return result('unsupported', null, 'encoding')
	let text: string
	try {
		text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
	} catch {
		return result('unsupported', null, 'encoding')
	}
	if (hasDisallowedControlCharacter(text)) return result('unsupported', null, 'encoding')
	let json = false
	try {
		JSON.parse(text)
		json = true
	} catch {
		/* An observation, not a guessed value. */
	}
	if (declared === 'application/json' || declared?.endsWith('+json'))
		return json
			? result('supported', 'application/json', 'json')
			: result('mismatch', null, 'invalid-json')
	if (!declared || declared === 'application/octet-stream')
		return json
			? result('supported', 'application/json', 'json')
			: result('unsupported', null, 'media-type')
	if (declared === 'text/plain') return result('supported', 'text/plain', 'plain-text')
	return result('unsupported', null, 'media-type')
}
