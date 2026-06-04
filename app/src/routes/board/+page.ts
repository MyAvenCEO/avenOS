import { redirect } from '@sveltejs/kit'
import type { PageLoad } from './$types'

/** Board now lives inside the avenCEO workspace. */
export const load: PageLoad = () => {
	throw redirect(307, '/avens/avenCEO/board')
}
