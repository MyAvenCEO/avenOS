import { redirect } from '@sveltejs/kit'
import { firstActorDocSlug } from '$lib/docs/actors-collection'
import type { PageLoad } from './$types'

export const ssr = false
export const prerender = false

export const load: PageLoad = () => {
	if (!firstActorDocSlug) throw redirect(307, '/docs')
	throw redirect(307, `/docs/actors/developers/${firstActorDocSlug}`)
}
