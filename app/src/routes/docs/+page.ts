import { redirect } from '@sveltejs/kit'
import type { PageLoad } from './$types'

/** Docs index now lives inside the avenCEO workspace. */
export const ssr = false
export const load: PageLoad = () => {
	throw redirect(307, '/avens/avenCEO/docs')
}
