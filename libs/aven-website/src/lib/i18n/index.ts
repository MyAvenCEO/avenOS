/**
 * The site speaks two languages from one set of pages.
 *
 * German is the home language and lives at the root (`/pricing`); English
 * lives under `/en` (`/en/pricing`). Every page is a component in
 * `$lib/pages` that takes a `lang` prop; the route files under `src/routes`
 * and `src/routes/en` are thin wrappers that pick the language. Copy lives
 * in per-page message modules next to this file (`home.ts`, `pricing.ts`,
 * …), typed so a key missing in one language fails the build, not the
 * reader.
 *
 * The legal pages (Impressum, Datenschutz, AGB, Widerruf) are German-only
 * by nature — the English site links to them as they are.
 */

export type Lang = 'de' | 'en'

export const LANGS: readonly Lang[] = ['de', 'en']
export const DEFAULT_LANG: Lang = 'de'

/** Pages that exist in both languages; everything else stays on its DE URL. */
const LOCALIZED_ROOTS = ['/', '/pricing', '/skills']

/** "/pricing" for DE, "/en/pricing" for EN — always with the trailing slash the build emits. */
export function localeHref(lang: Lang, path: string): string {
	const clean = path.startsWith('/') ? path : `/${path}`
	const withSlash = clean.endsWith('/') ? clean : `${clean}/`
	if (lang === 'de') return withSlash
	return withSlash === '/' ? '/en/' : `/en${withSlash}`
}

export function langFromPath(pathname: string): Lang {
	return pathname === '/en' || pathname.startsWith('/en/') ? 'en' : 'de'
}

/** The same page in the other language — legal pages simply stay where they are. */
export function switchLangHref(lang: Lang, pathname: string): string {
	const base = lang === 'en' ? pathname.replace(/^\/en(?=\/|$)/, '') || '/' : pathname
	const target: Lang = lang === 'de' ? 'en' : 'de'
	const localized = LOCALIZED_ROOTS.some(
		(r) => base === r || base === `${r}/` || base.startsWith(`${r}/`)
	)
	return localized || target === 'de' ? localeHref(target, base) : base
}

/** Pick one language's messages out of a `{ de, en }` record. */
export function pick<T>(messages: Record<Lang, T>, lang: Lang): T {
	return messages[lang] ?? messages[DEFAULT_LANG]
}
