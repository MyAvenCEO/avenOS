import { error } from '@sveltejs/kit'
import { getContentDoc, isContentDocSection } from '$lib/docs/content-collection'
import type { PageLoad } from './$types'

export const ssr = false
export const prerender = false

export const load: PageLoad = ({ params }) => {
	if (!isContentDocSection(params.section)) throw error(404, 'Chapter not found')
	const doc = getContentDoc(params.section, params.slug)
	if (!doc) throw error(404, 'Chapter not found')
	return { doc }
}
