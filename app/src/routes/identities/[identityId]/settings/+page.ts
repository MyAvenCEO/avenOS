import { redirect } from '@sveltejs/kit'
import type { PageLoad } from './$types'

export const load: PageLoad = ({ params }) => {
	const raw = decodeURIComponent(params.identityId)
	throw redirect(307, `/identities/${encodeURIComponent(raw)}/talk`)
}
