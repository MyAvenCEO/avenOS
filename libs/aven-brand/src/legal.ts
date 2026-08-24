/**
 * The legal documents, built from [[COMPANY]] — the website renders them as
 * pages, every other surface links to those pages. Structured (sections →
 * paragraphs → lines) instead of HTML, so each consumer brings its own
 * markup and style; a line maps to a <br>-separated row in the original.
 *
 * Today: Impressum (de) / Site Notice (en). The same shape is meant to
 * carry Datenschutz, AGB and Widerruf next — add a slug, add the paths,
 * write the sections, and every surface knows the page exists.
 */
import { type WebsiteEnv, websiteEnvFromHostname, websiteOrigin } from './hosts.js'
import { IMPRESSUM_DE, SITE_NOTICE_EN } from './imprint.js'
import { DATENSCHUTZ_DE, PRIVACY_POLICY_EN } from './privacy.js'
import { SOCIAL_MEDIA_DE, SOCIAL_MEDIA_EN } from './social-media.js'

export type LegalLang = 'de' | 'en'
export type LegalSlug = 'impressum' | 'datenschutz' | 'social-media'

export interface LegalParagraph {
	/** Bold lead line above the lines, e.g. "Vertreten durch:". */
	lead?: string
	lines: string[]
}

/** A bullet list — discriminated from a paragraph by `items`. */
export interface LegalList {
	items: string[]
}

export type LegalBlock = LegalParagraph | LegalList

export interface LegalSection {
	/** Heading depth as in the source document; 2 = chapter. */
	level?: 2 | 3 | 4 | 5
	/** Untitled = the document's opening block. */
	title?: string
	blocks: LegalBlock[]
}

export interface LegalDocument {
	slug: LegalSlug
	lang: LegalLang
	title: string
	/** Path on the WEBSITE — every surface links here, nobody re-renders it. */
	path: string
	sections: LegalSection[]
}

/** The document in the reader's language. */
export function legalDocument(slug: LegalSlug, lang: LegalLang): LegalDocument {
	if (slug === 'impressum') return lang === 'de' ? IMPRESSUM_DE : SITE_NOTICE_EN
	if (slug === 'datenschutz') return lang === 'de' ? DATENSCHUTZ_DE : PRIVACY_POLICY_EN
	if (slug === 'social-media') return lang === 'de' ? SOCIAL_MEDIA_DE : SOCIAL_MEDIA_EN
	throw new Error(`unknown legal document: ${slug}`)
}

/** Path on the website, e.g. "/impressum/" · "/en/site-notice/". */
export function legalPath(slug: LegalSlug, lang: LegalLang): string {
	return legalDocument(slug, lang).path
}

/**
 * The full deep link into the website, host resolved per environment.
 * Pass `hostname` from a browser surface (location/page.url) to derive the
 * environment, or `env` directly from a surface that knows it (the apps).
 */
export function legalHref(
	slug: LegalSlug,
	opts: { lang?: LegalLang; env?: WebsiteEnv; hostname?: string } = {}
): string {
	const lang = opts.lang ?? 'de'
	const env =
		opts.env ?? (opts.hostname !== undefined ? websiteEnvFromHostname(opts.hostname) : 'next')
	return `${websiteOrigin(env)}${legalPath(slug, lang)}`
}
