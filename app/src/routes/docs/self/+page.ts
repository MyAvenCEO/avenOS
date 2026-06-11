import { redirect } from '@sveltejs/kit'
import { firstFounderSlug } from '$lib/docs/self-collection'
import type { PageLoad } from './$types'

export const ssr = false
export const prerender = false

export const load: PageLoad = () => {
	if (!firstFounderSlug) throw redirect(307, '/docs')
	throw redirect(307, `/docs/self/founders/${firstFounderSlug}`)
}
