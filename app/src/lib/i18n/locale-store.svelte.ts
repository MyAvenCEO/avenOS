import { browser } from '$app/environment'
import { DEFAULT_LOCALE, normalizeLocale, type SupportedLocale } from './locales'
import { translate } from './messages'

let locale = $state<SupportedLocale>(DEFAULT_LOCALE)

function applyHtmlLang(loc: SupportedLocale): void {
	if (!browser) return
	document.documentElement.lang = loc
}

export function getLocale(): SupportedLocale {
	return locale
}

export function setLocale(next: SupportedLocale): void {
	const loc = normalizeLocale(next)
	locale = loc
	applyHtmlLang(loc)
}

export function initLocale(next?: string | null): void {
	setLocale(normalizeLocale(next))
}

/** Reactive translation — reads locale so Svelte tracks dependency. */
export function t(key: string, params?: Record<string, string | number>): string {
	void locale
	return translate(locale, key, params)
}
