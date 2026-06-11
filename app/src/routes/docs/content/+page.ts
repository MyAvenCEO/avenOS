import { redirect } from '@sveltejs/kit'
import { contentIntroHref, firstContentDoc } from '$lib/docs/content-collection'
import type { PageLoad } from './$types'

export const ssr = false
export const prerender = false

export const load: PageLoad = () => {
	if (firstContentDoc) {
		throw redirect(307, `/docs/content/${firstContentDoc.section}/${firstContentDoc.slug}`)
	}
	throw redirect(307, contentIntroHref)
}
