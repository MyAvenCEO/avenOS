import { json } from '@sveltejs/kit'
import { runtime } from '$lib/server/runtime.js'

export const GET = async ({ request }: { request: Request }) => {
	const rt = await runtime()
	const token = rt.config.SITE_HOST_DIRECTORY_BEARER_TOKEN
	if (!token || request.headers.get('authorization') !== `Bearer ${token}`)
		return json({ code: 'NOT_FOUND', message: 'Not found.' }, { status: 404 })
	return json(await rt.sites.directory())
}
