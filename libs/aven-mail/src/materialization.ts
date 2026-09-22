import { z } from 'zod'

export const mailPartSchema = z
	.object({
		path: z.string().regex(/^1(?:\.[1-9][0-9]*){0,16}$/),
		headerStart: z.number().int().min(0).max(4194304),
		bodyStart: z.number().int().min(0).max(4194304),
		end: z.number().int().min(0).max(4194304),
		mediaType: z.string().max(256),
		charset: z.string().max(128),
		transferEncoding: z.string().max(128),
		outcome: z.enum(['container', 'materialized', 'unsupported']),
		reason: z.enum([
			'multipart',
			'nested-message',
			'invalid-encoding',
			'transfer-encoding',
			'charset',
			'media-type',
			'decoded',
			'empty'
		]),
		fileIndex: z.number().int().min(0).max(127).nullable()
	})
	.strict()
export const mailFileSchema = z
	.object({
		name: z.string().min(1).max(240),
		mediaType: z.string().min(1).max(280),
		byteLength: z.number().int().min(1).max(8388608),
		sha256: z.string().regex(/^[a-f0-9]{64}$/)
	})
	.strict()
export const mailMaterializationSchema = z
	.object({
		parser: z.literal('mail-parser/0.11.9'),
		profile: z.literal('bounded-mail-v1'),
		outcome: z.enum(['inspected', 'unavailable']),
		reason: z
			.enum([
				'resource-limit',
				'part-limit',
				'invalid-part',
				'invalid-range',
				'header-limit',
				'decoded-limit',
				'raw-limit',
				'malformed',
				'input'
			])
			.nullable(),
		subject: z.string().max(4096),
		parts: z.array(mailPartSchema).max(128),
		files: z.array(mailFileSchema).max(128)
	})
	.strict()
export const mailParserResultSchema = mailMaterializationSchema.extend({
	files: z.array(mailFileSchema.extend({ base64: z.string().max(11184812) }).strict()).max(128)
})
