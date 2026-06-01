import { redirect } from '@sveltejs/kit'
import type { PageLoad } from './$types'
import { contentIntroHref, firstContentDoc } from '$lib/docs/content-collection'

export const ssr = false
export const prerender = false

export const load: PageLoad = () => {
	if (firstContentDoc) {
		throw redirect(307, `/docs/content/${firstContentDoc.section}/${firstContentDoc.slug}`)
	}
	throw redirect(307, contentIntroHref)
}
