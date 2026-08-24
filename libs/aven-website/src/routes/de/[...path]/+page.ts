/**
 * Legacy /de slugs: the German pages carry German slugs (`/de/preise`), but
 * the English-slugged variants were briefly published — each known one
 * prerenders as a redirect stub. Everything else here is a real 404.
 */
import { error, redirect } from '@sveltejs/kit'
import type { EntryGenerator, PageLoad } from './$types.js'

const MOVED: Record<string, string> = {
	pricing: '/de/preise/'
}

export const entries: EntryGenerator = () => Object.keys(MOVED).map((path) => ({ path }))

export const load: PageLoad = ({ params }) => {
	const target = MOVED[params.path.replace(/\/+$/, '')]
	if (target) redirect(308, target)
	error(404, 'Not found')
}
