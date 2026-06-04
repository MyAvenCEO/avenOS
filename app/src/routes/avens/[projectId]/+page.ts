import { redirect } from '@sveltejs/kit'
import type { PageLoad } from './$types'

/** Default aven view is Orders. */
export const load: PageLoad = ({ params }) => {
	const id = encodeURIComponent(decodeURIComponent(params.projectId))
	throw redirect(307, `/avens/${id}/orders`)
}
