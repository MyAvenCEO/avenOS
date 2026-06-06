import { redirect } from '@sveltejs/kit'
import type { PageLoad } from './$types'

/** Default identity view is Talk; todos live under `/todos`. */
export const load: PageLoad = ({ params }) => {
	const id = encodeURIComponent(decodeURIComponent(params.identityId))
	throw redirect(307, `/identities/${id}/talk`)
}
