import { error } from '@sveltejs/kit'
import { getSelfDoc } from '$lib/docs/self-collection'
import type { PageLoad } from './$types'

export const ssr = false
export const prerender = false

export const load: PageLoad = ({ params }) => {
	const doc = getSelfDoc('founders', params.slug)
	if (!doc) throw error(404, 'Chapter not found')
	return { doc }
}
