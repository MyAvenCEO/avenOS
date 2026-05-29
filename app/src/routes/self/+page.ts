import { redirect } from '@sveltejs/kit'

/** Self section opens on Peers by default. */
export function load(): never {
	throw redirect(307, '/self/peers')
}
