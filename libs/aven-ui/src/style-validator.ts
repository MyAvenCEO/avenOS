import { CSS_INJECTION_PATTERNS, FORBIDDEN_PATH_KEYS } from './security.js'
import type { StyleDef } from './types.js'

const FORBIDDEN_STYLE_KEYS = new Set(['rawCss', 'rawCSS', 'raw_css'])

function assertSafeKey(key: string, path: string): void {
	const lower = key.toLowerCase()
	for (const forbidden of FORBIDDEN_PATH_KEYS) {
		if (lower.includes(forbidden.toLowerCase())) {
			throw new Error(`[aven-ui] Forbidden style key in ${path}: ${key}`)
		}
	}
}

function assertSafeCssValue(value: string, path: string): void {
	for (const pattern of CSS_INJECTION_PATTERNS) {
		if (pattern.test(value)) {
			throw new Error(`[aven-ui] Forbidden CSS value in ${path}`)
		}
	}
}

function walkStyleValues(value: unknown, path: string): void {
	if (value == null) return
	if (typeof value === 'string') {
		assertSafeCssValue(value, path)
		return
	}
	if (Array.isArray(value)) {
		value.forEach((item, i) => walkStyleValues(item, `${path}[${i}]`))
		return
	}
	if (typeof value !== 'object') return
	for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
		assertSafeKey(key, path)
		if (FORBIDDEN_STYLE_KEYS.has(key)) {
			throw new Error(`[aven-ui] Forbidden style field "${key}" in ${path}. Use tokens/components/selectors only.`)
		}
		walkStyleValues(nested, `${path}.${key}`)
	}
}

export function validateStyleDef(style: StyleDef, path = 'style'): void {
	if (!style || typeof style !== 'object') {
		throw new Error(`[aven-ui] Invalid style definition at ${path}`)
	}
	for (const key of Object.keys(style as Record<string, unknown>)) {
		if (FORBIDDEN_STYLE_KEYS.has(key)) {
			throw new Error(`[aven-ui] Forbidden style field "${key}" at ${path}. Raw CSS is not allowed.`)
		}
	}
	walkStyleValues(style.tokens, `${path}.tokens`)
	walkStyleValues(style.components, `${path}.components`)
	walkStyleValues(style.selectors, `${path}.selectors`)
}
