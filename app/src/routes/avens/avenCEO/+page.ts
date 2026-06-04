import { redirect } from '@sveltejs/kit'
import type { PageLoad } from './$types'

/** Default avenCEO view is the Board. */
export const load: PageLoad = () => {
	throw redirect(307, '/avens/avenCEO/board')
}
