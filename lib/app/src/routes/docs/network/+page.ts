import { redirect } from '@sveltejs/kit'
import type { PageLoad } from './$types'
import { firstFounderSlug } from '$lib/docs/network-collection'

export const ssr = false
export const prerender = false

export const load: PageLoad = () => {
	if (firstFounderSlug) {
		throw redirect(307, `/docs/network/founders/${firstFounderSlug}`)
	}
}
