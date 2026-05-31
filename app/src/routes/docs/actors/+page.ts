import { redirect } from '@sveltejs/kit'
import type { PageLoad } from './$types'
import { firstActorDocSlug } from '$lib/docs/actors-collection'

export const ssr = false
export const prerender = false

export const load: PageLoad = () => {
	if (!firstActorDocSlug) throw redirect(307, '/docs')
	throw redirect(307, `/docs/actors/developers/${firstActorDocSlug}`)
}
