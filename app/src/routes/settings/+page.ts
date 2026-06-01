import { redirect } from '@sveltejs/kit'

/** Self section opens on Identity by default. */
export function load(): never {
	throw redirect(307, '/settings/identity')
}
