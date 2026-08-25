import { json } from '@sveltejs/kit'
import { z } from 'zod'
import { runtime } from '$lib/server/runtime.js'
import { isSiteDirectoryRequestAuthorized } from '$lib/server/sites/directory-auth.js'

const reportSchema = z.object({
	id: z.uuid(),
	status: z.enum(['awaiting_dns', 'syncing', 'active', 'dns_invalid', 'failed']),
	error: z.string().max(1000).nullable().optional(),
	artifactRevision: z
		.string()
		.regex(/^[0-9a-f]{40}$/)
		.nullable()
		.optional(),
	sourceRevision: z
		.string()
		.regex(/^[0-9a-f]{40}$/)
		.nullable()
		.optional(),
	dnsVerified: z.boolean().optional()
})

export const POST = async ({ request }: { request: Request }) => {
	const rt = await runtime()
	if (!isSiteDirectoryRequestAuthorized(request, rt.config.SITE_HOST_DIRECTORY_BEARER_TOKEN))
		return json({ code: 'NOT_FOUND', message: 'Not found.' }, { status: 404 })
	const parsed = reportSchema.safeParse(await request.json().catch(() => null))
	if (!parsed.success) return json({ code: 'VALIDATION_ERROR' }, { status: 400 })
	await rt.sites.report(parsed.data)
	return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
}
