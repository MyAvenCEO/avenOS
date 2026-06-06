import { redirect } from '@sveltejs/kit'
import type { PageLoad } from './$types'

/** Default identity view is Orders. */
export const load: PageLoad = ({ params }) => {
	const id = encodeURIComponent(decodeURIComponent(params.projectId))
	const identityId = encodeURIComponent(decodeURIComponent(params.identityId))
	throw redirect(307, `/avens/${id}/${identityId}/orders`)
}
