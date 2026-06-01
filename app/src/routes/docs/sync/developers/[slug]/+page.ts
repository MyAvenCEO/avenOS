import { error } from '@sveltejs/kit'
import type { PageLoad } from './$types'
import { getSyncDoc } from '$lib/docs/sync-collection'

export const ssr = false
export const prerender = false

export const load: PageLoad = ({ params }) => {
	const doc = getSyncDoc(params.slug)
	if (!doc) throw error(404, 'Chapter not found')
	return { doc }
}
