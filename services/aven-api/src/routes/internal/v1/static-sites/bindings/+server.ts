import { json } from '@sveltejs/kit'
import { runtime } from '$lib/server/runtime.js'
import { isSiteDirectoryRequestAuthorized } from '$lib/server/sites/directory-auth.js'

export const GET = async ({ request }: { request: Request }) => {
	const rt = await runtime()
	if (!isSiteDirectoryRequestAuthorized(request, rt.config.SITE_HOST_DIRECTORY_BEARER_TOKEN))
		return json({ code: 'NOT_FOUND', message: 'Not found.' }, { status: 404 })
	return json(await rt.sites.directory(), { headers: { 'cache-control': 'no-store' } })
}
