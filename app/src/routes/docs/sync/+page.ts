import { redirect } from '@sveltejs/kit'
import { firstDeveloperSlug } from '$lib/docs/sync-collection'
import type { PageLoad } from './$types'

export const ssr = false
export const prerender = false

export const load: PageLoad = () => {
	if (firstDeveloperSlug) {
		throw redirect(307, `/docs/sync/developers/${firstDeveloperSlug}`)
	}
}
