import { redirect } from '@sveltejs/kit'
import type { PageLoad } from './$types'

/** Default avenMAIA view is the game. */
export const load: PageLoad = () => {
	throw redirect(307, '/avens/avenMAIA/game')
}
