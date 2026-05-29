import { error } from '@sveltejs/kit'
import type { PageLoad } from './$types'
import { getSparksDoc } from '$lib/docs/sparks-collection'

export const ssr = false
export const prerender = false

export const load: PageLoad = ({ params }) => {
	const doc = getSparksDoc('developers', params.slug)
	if (!doc) throw error(404, 'Chapter not found')
	return { doc }
}
