import { error } from '@sveltejs/kit'
import { getSyncDoc } from '$lib/docs/sync-collection'
import type { PageLoad } from './$types'

export const ssr = false
export const prerender = false

export const load: PageLoad = ({ params }) => {
	const doc = getSyncDoc(params.slug)
	if (!doc) throw error(404, 'Chapter not found')
	return { doc }
}
