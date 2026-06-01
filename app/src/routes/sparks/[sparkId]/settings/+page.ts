import { redirect } from '@sveltejs/kit'
import type { PageLoad } from './$types'

export const load: PageLoad = ({ params }) => {
	const raw = decodeURIComponent(params.sparkId)
	throw redirect(307, `/sparks/${encodeURIComponent(raw)}/talk`)
}
