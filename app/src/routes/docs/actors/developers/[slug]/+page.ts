import { error } from '@sveltejs/kit'
import type { PageLoad } from './$types'
import { getActorDoc } from '$lib/docs/actors-collection'

export const ssr = false
export const prerender = false

export const load: PageLoad = ({ params }) => {
	const doc = getActorDoc(params.slug)
	if (!doc) throw error(404, 'Chapter not found')
	return { doc }
}
