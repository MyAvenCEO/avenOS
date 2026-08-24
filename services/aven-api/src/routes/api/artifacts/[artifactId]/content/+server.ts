import { z } from 'zod'
import { requireUser } from '$lib/server/api.js'
import { runtime } from '$lib/server/runtime.js'

const artifactIdSchema = z.uuid()

export const GET = async (event) => {
	const rt = await runtime()
	const user = await requireUser(event)
	if (!rt.artifacts) return new Response('Artifact Store is not configured.', { status: 503 })
	const artifactId = artifactIdSchema.parse(event.params.artifactId)
	const target = await rt.environments.artifactTargetForUser(user.id)
	const envelope = (await rt.artifacts.artifact(
		target.databaseName,
		target.scopeId,
		artifactId
	)) as Record<string, unknown>
	if (!envelope.blob) return new Response('This artifact has no blob content.', { status: 404 })
	const payload = envelope.payload as Record<string, unknown> | undefined
	const mediaType =
		typeof payload?.declaredMediaType === 'string'
			? payload.declaredMediaType
			: 'application/octet-stream'
	const content = await rt.artifacts.content(target.databaseName, target.scopeId, artifactId)
	return new Response(Uint8Array.from(content).buffer, {
		headers: {
			'content-type': mediaType,
			'content-length': String(content.byteLength),
			'x-content-type-options': 'nosniff',
			'content-security-policy': "default-src 'none'; sandbox"
		}
	})
}
