import en from '../../../languages/en.json'
import de from '../../../languages/de.json'
import { DEFAULT_LOCALE, normalizeLocale, type SupportedLocale } from './locales'

type MessageTree = { [key: string]: string | MessageTree }

const catalogs: Record<SupportedLocale, MessageTree> = { en, de }

function resolvePath(tree: MessageTree, key: string): string | undefined {
	const parts = key.split('.')
	let node: string | MessageTree | undefined = tree
	for (const part of parts) {
		if (typeof node !== 'object' || node === null || !(part in node)) return undefined
		node = node[part]
	}
	return typeof node === 'string' ? node : undefined
}

function interpolate(template: string, params?: Record<string, string | number>): string {
	if (!params) return template
	return template.replace(/\{(\w+)\}/g, (_, name: string) => {
		const val = params[name]
		return val === undefined ? `{${name}}` : String(val)
	})
}

export function translate(
	locale: SupportedLocale,
	key: string,
	params?: Record<string, string | number>,
): string {
	const loc = normalizeLocale(locale)
	const primary = resolvePath(catalogs[loc], key)
	if (primary !== undefined) return interpolate(primary, params)
	if (loc !== DEFAULT_LOCALE) {
		const fallback = resolvePath(catalogs[DEFAULT_LOCALE], key)
		if (fallback !== undefined) return interpolate(fallback, params)
	}
	return key
}

export type MessageKey = string
