/**
 * Legacy German root URLs: German moved under /de (English owns the root),
 * but /impressum & co. were published — each known old slug prerenders as a
 * redirect stub to its new /de home. Anything else on this catch-all is a
 * genuine 404.
 */
import { error, redirect } from '@sveltejs/kit'
import type { EntryGenerator, PageLoad } from './$types.js'

const MOVED: Record<string, string> = {
	impressum: '/de/impressum/',
	datenschutz: '/de/datenschutz/',
	'datenschutz/social-media': '/de/datenschutz/social-media/',
	agb: '/de/agb/',
	widerruf: '/de/widerruf/'
}

export const entries: EntryGenerator = () => Object.keys(MOVED).map((path) => ({ path }))

export const load: PageLoad = ({ params }) => {
	const target = MOVED[params.path.replace(/\/+$/, '')]
	if (target) redirect(308, target)
	error(404, 'Not found')
}
