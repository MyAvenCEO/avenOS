import { error } from '@sveltejs/kit'
import { getSparksDoc } from '$lib/docs/identities-collection'
import type { PageLoad } from './$types'

export const ssr = false
export const prerender = false

export const load: PageLoad = ({ params }) => {
	const doc = getSparksDoc('founders', params.slug)
	if (!doc) throw error(404, 'Chapter not found')
	return { doc }
}
