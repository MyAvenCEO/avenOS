import { z } from 'zod'
import { api, requireUser } from '$lib/server/api.js'
import { MAX_ARTIFACT_FILE_BYTES } from '$lib/server/artifacts/service.js'
import { AppError } from '$lib/server/errors.js'

const publicationIdSchema = z.uuid()
const digestSchema = z.string().regex(/^[0-9a-f]{64}$/)

function requiredHeader(request: Request, name: string): string {
	const value = request.headers.get(name)
	if (!value) throw new AppError(400, 'VALIDATION_ERROR', `${name} is required.`)
	return value
}

function decodeOriginalName(encoded: string): string {
	try {
		const bytes = Buffer.from(encoded, 'base64url')
		if (bytes.toString('base64url') !== encoded) throw new Error('non-canonical base64url')
		const name = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
		if (
			name === '' ||
			name === '.' ||
			name === '..' ||
			Buffer.byteLength(name) > 512 ||
			/[\\/\p{Cc}]/u.test(name)
		) {
			throw new Error('unsafe filename')
		}
		return name
	} catch {
		throw new AppError(400, 'VALIDATION_ERROR', 'The original filename is invalid.')
	}
}

export const PUT = api(async (event, rt) => {
	const user = await requireUser(event)
	if (!rt.artifacts) {
		throw new AppError(503, 'ARTIFACT_STORE_UNAVAILABLE', 'Artifact Store is not configured.')
	}
	const target = await rt.environments.artifactTargetForUser(user.id)

	const publicationId = publicationIdSchema.parse(event.params.publicationId)
	const originalName = decodeOriginalName(requiredHeader(event.request, 'x-aven-original-name'))
	const mediaType = requiredHeader(event.request, 'content-type')
	if (mediaType.length > 255 || !mediaType.includes('/')) {
		throw new AppError(400, 'VALIDATION_ERROR', 'Content-Type is invalid.')
	}
	const sha256 = digestSchema.parse(requiredHeader(event.request, 'x-expected-sha256'))
	const length = Number(requiredHeader(event.request, 'content-length'))
	if (!Number.isSafeInteger(length) || length < 0) {
		throw new AppError(400, 'VALIDATION_ERROR', 'Content-Length is invalid.')
	}
	if (length > MAX_ARTIFACT_FILE_BYTES) {
		throw new AppError(413, 'FILE_TOO_LARGE', 'Files may not exceed 100 MiB.')
	}
	const body = event.request.body ?? new Uint8Array()
	return {
		body: await rt.artifacts.publishFile({
			userId: user.id,
			databaseName: target.databaseName,
			scopeId: target.scopeId,
			publicationId,
			originalName,
			mediaType,
			sha256,
			length,
			body
		}),
		status: 201
	}
})
