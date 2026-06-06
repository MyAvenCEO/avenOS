import { redirect } from '@sveltejs/kit'
import type { PageLoad } from './$types'

/** Default spark view is Orders. */
export const load: PageLoad = ({ params }) => {
	const id = encodeURIComponent(decodeURIComponent(params.projectId))
	const sparkId = encodeURIComponent(decodeURIComponent(params.sparkId))
	throw redirect(307, `/avens/${id}/${sparkId}/orders`)
}
