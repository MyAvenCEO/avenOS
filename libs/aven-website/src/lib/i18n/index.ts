/**
 * The site speaks two languages from one set of pages.
 *
 * English is the default and lives at the root (`/pricing`); German lives
 * under `/de` (`/de/pricing`). There is no `/en` prefix — English IS the
 * base, and the retired `/en` URLs redirect home. Every page is a component
 * in `$lib/pages` that takes a `lang` prop; the route files under
 * `src/routes` and `src/routes/de` are thin wrappers that pick the
 * language. Copy lives in per-page message modules next to this file
 * (`home.ts`, `pricing.ts`, …), typed so a key missing in one language
 * fails the build, not the reader.
 *
 * The legal pages come in pairs with their own slugs per language
 * (`/impressum` ↔ `/en/site-notice`) — the pairs live in @avenos/aven-brand,
 * so the switcher below maps them without a second list. AGB and Widerruf
 * are still German-only and simply stay put.
 */
import { type LegalSlug, legalPath } from '@avenos/aven-brand'

export type Lang = 'de' | 'en'

export const LANGS: readonly Lang[] = ['de', 'en']
export const DEFAULT_LANG: Lang = 'en'

/** Pages that exist in both languages; everything else stays on its DE URL. */
const LOCALIZED_ROOTS = ['/', '/pricing', '/skills', '/avens']

/**
 * Where a page's slug is itself translated. Paths are passed around in
 * their canonical English form; the German URL swaps the first segment.
 */
const SLUG_DE: Record<string, string> = { pricing: 'preise' }
const SLUG_EN: Record<string, string> = { preise: 'pricing' }

/** Swap the first path segment through a slug map, if it is in there. */
function translateSlug(path: string, map: Record<string, string>): string {
	const [, first = '', ...rest] = path.split('/')
	const translated = map[first]
	return translated ? ['', translated, ...rest].join('/') : path
}

/** DE path ↔ EN path for the legal documents that exist in both languages. */
const LEGAL_PAIRS = (['impressum', 'datenschutz', 'social-media'] as LegalSlug[]).map(
	(slug) => [legalPath(slug, 'de'), legalPath(slug, 'en')] as const
)

/** "/pricing" for EN, "/de/preise" for DE — always with the trailing slash the build emits. */
export function localeHref(lang: Lang, path: string): string {
	const clean = path.startsWith('/') ? path : `/${path}`
	const withSlash = clean.endsWith('/') ? clean : `${clean}/`
	if (lang === 'en') return withSlash
	return withSlash === '/' ? '/de/' : `/de${translateSlug(withSlash, SLUG_DE)}`
}

export function langFromPath(pathname: string): Lang {
	return pathname === '/de' || pathname.startsWith('/de/') ? 'de' : 'en'
}

/** The same page in the other language. Legal pages hop via their pair;
 * anything untranslated (AGB, Widerruf) simply stays where it is. */
export function switchLangHref(lang: Lang, pathname: string): string {
	const full = pathname.endsWith('/') ? pathname : `${pathname}/`
	for (const [de, en] of LEGAL_PAIRS) {
		if (lang === 'de' && full === de) return en
		if (lang === 'en' && full === en) return de
	}
	const stripped = lang === 'de' ? full.replace(/^\/de(?=\/|$)/, '') || '/' : full
	// Back to the canonical English slug, so the roots check and the EN href agree.
	const base = translateSlug(stripped, SLUG_EN)
	const target: Lang = lang === 'de' ? 'en' : 'de'
	const localized = LOCALIZED_ROOTS.some(
		(r) => base === r || base === `${r}/` || base.startsWith(`${r}/`)
	)
	return localized || target === 'en' ? localeHref(target, base) : base
}

/** Pick one language's messages out of a `{ de, en }` record. */
export function pick<T>(messages: Record<Lang, T>, lang: Lang): T {
	return messages[lang] ?? messages[DEFAULT_LANG]
}
