import { z } from 'zod'
import { imapQueryResultSchema, imapQuerySchema, imapReadSchema } from './contracts'
import { mailMaterializationSchema } from './materialization'

/** Transport-independent raw bytes, before MIME decoding or newline normalization. */
export const mailMessageSchema = z
	.object({
		mediaType: z.literal('message/rfc822'),
		byteLength: z.number().int().min(0).max(33554432),
		sha256: z.string().regex(/^[a-f0-9]{64}$/)
	})
	.strict()
export const imapMessageResultSchema = z
	.object({
		accountRef: z.uuid(),
		mailbox: z.string().min(1).max(1024),
		uidValidity: z.number().int().min(1).max(4294967295),
		uid: z.number().int().min(1).max(4294967295),
		outcome: z.enum(['captured', 'unavailable']),
		observedFrom: z.iso.datetime({ offset: true }),
		observedUntil: z.iso.datetime({ offset: true })
	})
	.strict()
	.refine(
		(v) => Date.parse(v.observedFrom) <= Date.parse(v.observedUntil),
		'Invalid observation interval.'
	)

const reference = (role: string, target: string, minimum: number) => ({
	role,
	minimum,
	maximum: 1,
	allowedTargetTypes: {
		kind: 'exact',
		types: [{ typeKey: target, version: 1 }]
	},
	attributesSchema: {
		type: 'object',
		additionalProperties: false,
		required: [],
		properties: {}
	}
})
export function mailArtifactTypes() {
	return [
		{
			typeKey: 'mail.message-parts',
			schema: mailMaterializationSchema,
			blobPolicy: 'forbidden',
			referenceRules: [
				reference('message', 'mail.message', 1),
				{
					...reference('file', 'core.file', 0),
					maximum: 128
				}
			]
		},
		{
			typeKey: 'mail.imap-query',
			schema: imapQuerySchema,
			blobPolicy: 'forbidden',
			referenceRules: [reference('continuation', 'mail.imap-query-result', 0)]
		},
		{
			typeKey: 'mail.imap-query-result',
			schema: imapQueryResultSchema,
			blobPolicy: 'forbidden',
			referenceRules: []
		},
		{
			typeKey: 'mail.imap-message-request',
			schema: imapReadSchema,
			blobPolicy: 'forbidden',
			referenceRules: [reference('selection', 'mail.imap-query-result', 1)]
		},
		{
			typeKey: 'mail.imap-message-result',
			schema: imapMessageResultSchema,
			blobPolicy: 'forbidden',
			referenceRules: [reference('message', 'mail.message', 0)]
		},
		{
			typeKey: 'mail.message',
			schema: mailMessageSchema,
			blobPolicy: 'required',
			referenceRules: []
		}
	].map(({ typeKey, schema, blobPolicy, referenceRules }) => ({
		typeKey,
		version: 1,
		schemaProfileId: 'artifact-json-schema-profile-v1',
		payloadSchema: z.toJSONSchema(schema, { io: 'input' }),
		blobPolicy,
		referenceRules
	}))
}
