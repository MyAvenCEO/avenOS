import { redirect } from '@sveltejs/kit'

export const ssr = false

/** Previous route; bookmarks still hit `/avendb/todos`. */
export function load() {
	throw redirect(307, '/identities')
}
