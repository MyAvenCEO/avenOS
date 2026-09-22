import { z } from 'zod'
import { connectionCatalogSchema } from './connection-catalog'
import { httpRequestSchema } from './contracts'

const bounded = (maximum: number) => z.string().max(maximum)
const nullable = (maximum: number) => bounded(maximum).nullable()
/** New observations only. Selecting an existing response is not a new capture. */
export const httpResponseSchema = z
	.object({
		requestedUrl: bounded(8192),
		finalUrl: bounded(8192),
		statusCode: z.number().int().min(200).max(599),
		networkStatusCode: z.number().int().min(200).max(599).optional(),
		cacheDisposition: z.enum(['new', 'revalidated']),
		representationSourceArtifactId: z.uuid().optional(),
		protocol: bounded(32).optional(),
		declaredMediaType: nullable(256),
		declaredCharset: nullable(128),
		etag: nullable(16384),
		lastModified: nullable(16384),
		headers: z
			.array(
				z
					.object({
						name: z.enum([
							'cache-control',
							'content-disposition',
							'content-type',
							'date',
							'etag',
							'expires',
							'last-modified',
							'vary'
						]),
						values: z.array(bounded(16384)).min(1).max(1)
					})
					.strict()
			)
			.max(8),
		redirectCount: z.number().int().min(0).max(10),
		redirectStoppedReason: z
			.enum(['manual', 'missing-location', 'cross-origin-authentication'])
			.optional(),
		storedBodyLength: z.number().int().min(0).max(33554432),
		capturedAt: z.iso.datetime({ offset: true })
	})
	.strict()
	.superRefine((value, ctx) => {
		if (
			(value.cacheDisposition === 'revalidated') !== (value.networkStatusCode === 304) ||
			(value.cacheDisposition === 'revalidated') !== !!value.representationSourceArtifactId ||
			value.statusCode === 304 ||
			([204, 205].includes(value.statusCode) && value.storedBodyLength !== 0) ||
			new Set(value.headers.map((h) => h.name)).size !== value.headers.length
		)
			ctx.addIssue({ code: 'custom', message: 'Invalid response observation.' })
	})

export const httpInspectionSchema = z
	.object({
		profile: z.literal('utf8-data-v1'),
		outcome: z.enum(['supported', 'unsupported', 'mismatch', 'no-content']),
		detectedMediaType: z.enum(['application/json', 'text/plain']).nullable(),
		declaredMediaType: z.string().max(256).nullable(),
		byteLength: z.number().int().min(0).max(4194304),
		reason: z.enum(['json', 'plain-text', 'encoding', 'media-type', 'invalid-json', 'empty'])
	})
	.strict()

export function httpArtifactTypes() {
	return [
		{ typeKey: 'connections.catalog', schema: connectionCatalogSchema, blobPolicy: 'forbidden' },
		{ typeKey: 'web.http-request', schema: httpRequestSchema, blobPolicy: 'forbidden' },
		{ typeKey: 'web.http-response', schema: httpResponseSchema, blobPolicy: 'required' },
		{
			typeKey: 'web.http-response-inspection',
			schema: httpInspectionSchema,
			blobPolicy: 'forbidden'
		}
	].map(({ typeKey, schema, blobPolicy }) => ({
		typeKey,
		version: 1,
		schemaProfileId: 'artifact-json-schema-profile-v1',
		payloadSchema: z.toJSONSchema(schema, { io: 'input' }),
		blobPolicy,
		referenceRules:
			typeKey === 'web.http-response-inspection'
				? [
						{
							role: 'response',
							minimum: 1,
							maximum: 1,
							allowedTargetTypes: {
								kind: 'exact',
								types: [{ typeKey: 'web.http-response', version: 1 }]
							},
							attributesSchema: {
								type: 'object',
								additionalProperties: false,
								required: [],
								properties: {}
							}
						}
					]
				: []
	}))
}
