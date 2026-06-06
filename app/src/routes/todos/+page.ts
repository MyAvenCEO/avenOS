import { redirect } from '@sveltejs/kit'

export const ssr = false

/** Workspace picker moved to `/identities`; each identity opens `/identities/[identityId]` for todos. */
export function load() {
	throw redirect(307, '/identities')
}
