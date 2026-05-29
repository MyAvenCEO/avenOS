import { error } from '@sveltejs/kit'
import type { PageLoad } from './$types'
import { getNetworkDoc } from '$lib/docs/network-collection'

export const ssr = false
export const prerender = false

export const load: PageLoad = ({ params }) => {
	const doc = getNetworkDoc('founders', params.slug)
	if (!doc) throw error(404, 'Chapter not found')
	return { doc }
}
