import { redirect } from '@sveltejs/kit'
import type { PageLoad } from './$types'

/** Default avenSKILLS view is the Editing tab. */
export const load: PageLoad = () => {
	throw redirect(307, '/avens/avenSKILLS/editing')
}
