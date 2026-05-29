import { redirect } from '@sveltejs/kit'
import type { PageLoad } from './$types'

/** Default spark view is Talk; todos live under `/todos`. */
export const load: PageLoad = ({ params }) => {
	const id = encodeURIComponent(decodeURIComponent(params.sparkId))
	throw redirect(307, `/sparks/${id}/talk`)
}
