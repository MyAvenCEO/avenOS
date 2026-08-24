/**
 * `/en` is retired: English IS the root. Every published /en URL prerenders
 * as a redirect stub — the English pages to their new root home, the old
 * /en/<german-slug> aliases to the English counterpart (or the German /de
 * page where no translation exists).
 */
import { redirect } from '@sveltejs/kit'
import { allSlugs } from '$lib/skills/loader'
import type { EntryGenerator, PageLoad } from './$types.js'

const ALIASES: Record<string, string> = {
	impressum: '/site-notice/',
	datenschutz: '/privacy-policy/',
	'datenschutz/social-media': '/social-media-privacy/',
	agb: '/de/agb/',
	widerruf: '/withdrawal/'
}

const PAGES = [
	'',
	'pricing',
	'skills',
	'avens',
	'site-notice',
	'privacy-policy',
	'social-media-privacy',
	'withdrawal'
]

export const entries: EntryGenerator = () => [
	...PAGES.map((path) => ({ path })),
	...Object.keys(ALIASES).map((path) => ({ path })),
	...allSlugs.map((slug) => ({ path: `skills/${slug}` }))
]

export const load: PageLoad = ({ params }) => {
	const path = params.path.replace(/\/+$/, '')
	redirect(308, ALIASES[path] ?? (path === '' ? '/' : `/${path}/`))
}
