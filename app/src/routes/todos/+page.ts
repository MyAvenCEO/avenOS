import { redirect } from '@sveltejs/kit'

export const ssr = false

/** Workspace picker moved to `/sparks`; each spark opens `/sparks/[sparkId]` for todos. */
export function load() {
	throw redirect(307, '/sparks')
}
