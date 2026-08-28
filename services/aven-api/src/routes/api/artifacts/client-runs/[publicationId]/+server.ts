import { z } from 'zod'
import { api, requireUser } from '$lib/server/api.js'
import type { PublishClientRunInput } from '$lib/server/artifacts/service.js'
import { AppError } from '$lib/server/errors.js'

const token = z.string().regex(/^[a-z][a-z0-9.-]{0,254}$/)
const localKey = z.string().regex(/^[a-z][a-z0-9-]{0,127}$/)
const role = z.string().regex(/^[a-z][a-z0-9-]{0,127}$/)
const uuid = z.uuid()
const locator = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('artifact-root') }).strict(),
	z
		.object({ kind: z.literal('json-pointer'), pointer: z.string().startsWith('/').max(512) })
		.strict(),
	z
		.object({
			kind: z.literal('byte-range'),
			start: z.number().int().nonnegative(),
			endExclusive: z.number().int().nonnegative()
		})
		.strict(),
	z
		.object({
			kind: z.literal('page-region'),
			page: z.number().int().min(1).max(256),
			x: z.number().int().min(0).max(1_000_000),
			y: z.number().int().min(0).max(1_000_000),
			width: z.number().int().min(0).max(1_000_000),
			height: z.number().int().min(0).max(1_000_000)
		})
		.strict()
])
const runSchema = z
	.object({
		procedureKey: z.enum([
			'client.inspect-file',
			'client.decompose-pages',
			'client.extract-native-text',
			'client.classify-page-signals',
			'client.assemble-document-representation',
			'client.aggregate-content-classification',
			'client.analyze-page-model',
			'client.classify-document-model',
			'client.extract-invoice-model',
			'client.extract-statement-model',
			'client.validate-invoice',
			'client.validate-statement'
		]),
		procedureVersion: z.literal('client-v1'),
		inputs: z
			.array(
				z
					.object({
						role,
						ordinal: z.number().int().min(0).max(255),
						artifactId: uuid
					})
					.strict()
			)
			.min(1)
			.max(128),
		parameters: z.record(z.string(), z.unknown()),
		artifacts: z
			.array(
				z
					.object({
						localKey,
						typeKey: token,
						typeVersion: z.literal(1),
						payload: z.record(z.string(), z.unknown()),
						output: z.object({ role, ordinal: z.number().int().min(0).max(255) }).strict(),
						blob: z
							.object({
								mediaType: z.string().min(1).max(255),
								base64: z.string().max(6_000_000)
							})
							.strict()
							.optional()
					})
					.strict()
			)
			.min(1)
			.max(64),
		evidence: z
			.array(
				z
					.object({
						ordinal: z.number().int().min(0).max(255),
						outputLocalKey: localKey,
						outputLocator: locator,
						inputRole: role,
						inputOrdinal: z.number().int().min(0).max(255),
						inputLocator: locator
					})
					.strict()
			)
			.max(256)
	})
	.strict()

export const POST = api(async (event, rt) => {
	const user = await requireUser(event)
	if (!rt.artifacts) {
		throw new AppError(503, 'ARTIFACT_STORE_UNAVAILABLE', 'Artifact Store is not configured.')
	}
	const target = await rt.environments.artifactTargetForUser(user.id)
	const run = runSchema.parse(await event.request.json())
	return {
		body: await rt.artifacts.publishClientRun({
			userId: user.id,
			databaseName: target.databaseName,
			scopeId: target.scopeId,
			publicationId: uuid.parse(event.params.publicationId),
			...(run as Omit<
				PublishClientRunInput,
				'userId' | 'databaseName' | 'scopeId' | 'publicationId'
			>)
		}),
		status: 201
	}
})
