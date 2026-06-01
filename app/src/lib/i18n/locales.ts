export type SupportedLocale = 'en' | 'de'

export const DEFAULT_LOCALE: SupportedLocale = 'en'

export const SUPPORTED_LOCALES: SupportedLocale[] = ['en', 'de']

export function normalizeLocale(raw: string | null | undefined): SupportedLocale {
	if (raw === 'de') return 'de'
	return DEFAULT_LOCALE
}

export function localeDisplayName(locale: SupportedLocale, inLocale?: SupportedLocale): string {
	const lang = inLocale ?? locale
	if (locale === 'de') return lang === 'de' ? 'Deutsch' : 'German'
	return lang === 'de' ? 'Englisch' : 'English'
}
