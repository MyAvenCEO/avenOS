import { CSS_INJECTION_PATTERNS, FORBIDDEN_PATH_KEYS, SAFE_TAGS } from './security.js'
import type { StyleDef } from './types.js'

const FORBIDDEN_STYLE_KEYS = new Set(['rawCss', 'rawCSS', 'raw_css'])
const TOP_LEVEL_STYLE_KEYS = new Set(['tokens', 'components', 'selectors'])
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/
const SAFE_CLASS = /^[A-Za-z][A-Za-z0-9_-]*$/
const MEDIA_RULE = /^@media\s*\(\s*(?:max|min)-width\s*:\s*\d+(?:px|rem|em)\s*\)$/
const KEYFRAMES_RULE = /^@keyframes\s+[A-Za-z][A-Za-z0-9_-]*$/
const KEYFRAME_STEP = /^(from|to|(?:100|[1-9]?\d)%)$/
const SELECTOR_SYMBOLS = new Set(' .,;:*#>+~=[]"\'()_-'.replace(';', '').split(''))
const ALLOWED_CSS_PROPERTIES = new Set([
	'alignItems',
	'alignSelf',
	'animation',
	'appearance',
	'background',
	'border',
	'borderBottom',
	'borderColor',
	'borderLeft',
	'borderRadius',
	'borderRight',
	'borderTop',
	'borderWidth',
	'boxShadow',
	'boxSizing',
	'color',
	'content',
	'cursor',
	'display',
	'filter',
	'flex',
	'flexDirection',
	'flexShrink',
	'flexWrap',
	'font',
	'fontFamily',
	'fontSize',
	'fontVariantNumeric',
	'fontWeight',
	'gap',
	'gridTemplateColumns',
	'gridTemplateRows',
	'height',
	'justifyContent',
	'letterSpacing',
	'lineHeight',
	'listStyle',
	'margin',
	'marginBottom',
	'marginTop',
	'maxHeight',
	'maxWidth',
	'minHeight',
	'minWidth',
	'objectFit',
	'opacity',
	'outline',
	'overflow',
	'overflowY',
	'padding',
	'paddingTop',
	'placeContent',
	'textAlign',
	'textDecoration',
	'textTransform',
	'transform',
	'transition',
	'WebkitAppearance',
	'whiteSpace',
	'width',
	'wordBreak'
])

function assertSafeKey(key: string, path: string): void {
	const lower = key.toLowerCase()
	for (const forbidden of FORBIDDEN_PATH_KEYS) {
		if (lower.includes(forbidden.toLowerCase())) {
			throw new Error(`[aven-ui] Forbidden style key in ${path}: ${key}`)
		}
	}
}

function assertSafeCssValue(value: string, path: string): void {
	if (value.length > 400 || /[{};<>`]/.test(value) || /url\s*\(/i.test(value)) {
		throw new Error(`[aven-ui] Forbidden CSS value in ${path}`)
	}
	for (const pattern of CSS_INJECTION_PATTERNS) {
		if (pattern.test(value)) {
			throw new Error(`[aven-ui] Forbidden CSS value in ${path}`)
		}
	}
}

function assertAllowedProperty(prop: string, path: string): void {
	assertSafeKey(prop, path)
	if (!ALLOWED_CSS_PROPERTIES.has(prop)) {
		throw new Error(`[aven-ui] Forbidden CSS property "${prop}" in ${path}`)
	}
}

function validateTokenTree(value: unknown, path: string): void {
	if (value == null) return
	if (typeof value === 'string') {
		assertSafeCssValue(value, path)
		return
	}
	if (Array.isArray(value)) {
		for (const [i, item] of value.entries()) validateTokenTree(item, `${path}[${i}]`)
		return
	}
	if (typeof value !== 'object') return
	for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
		assertSafeKey(key, path)
		if (!SAFE_NAME.test(key)) throw new Error(`[aven-ui] Forbidden style key in ${path}: ${key}`)
		if (FORBIDDEN_STYLE_KEYS.has(key)) {
			throw new Error(
				`[aven-ui] Forbidden style field "${key}" in ${path}. Use tokens/components/selectors only.`
			)
		}
		validateTokenTree(nested, `${path}.${key}`)
	}
}

function hasOnlySelectorChars(selector: string): boolean {
	for (const ch of selector) {
		if (/^[A-Za-z0-9]$/.test(ch) || SELECTOR_SYMBOLS.has(ch)) continue
		return false
	}
	return true
}

function assertSafeSelector(selector: string, path: string): void {
	if (selector.length > 220 || /[{};<`]/.test(selector) || selector.includes('\\') || !hasOnlySelectorChars(selector)) {
		throw new Error(`[aven-ui] Forbidden CSS selector in ${path}: ${selector}`)
	}
	if (selector.includes(':global') || selector.includes(':host-context') || /(^|\s)(html|body)(\s|$|[.:[#>+~])/i.test(selector)) {
		throw new Error(`[aven-ui] Forbidden CSS selector in ${path}: ${selector}`)
	}
	for (const raw of selector.split(',')) {
		const part = raw.trim()
		if (!part) throw new Error(`[aven-ui] Empty CSS selector in ${path}`)
		const attrs = part.matchAll(/\[([^\]=]+)(?:=("[^"]*"|'[^']*'|[^\]]+))?\]/g)
		for (const attr of attrs) {
			const name = attr[1].trim().toLowerCase()
			if (name !== 'type' && !name.startsWith('data-')) {
				throw new Error(`[aven-ui] Forbidden selector attribute "${name}" in ${path}`)
			}
		}
		const withoutAttrs = part.replace(/\[[^\]]+\]/g, '')
		for (const match of withoutAttrs.matchAll(/(^|[\s>+~(])([a-z][a-z0-9-]*)(?=$|[\s.:[#)>+~])/g)) {
			const tag = match[2]
			if (!SAFE_TAGS.has(tag)) throw new Error(`[aven-ui] Forbidden selector tag "${tag}" in ${path}`)
		}
	}
}

function validateDeclarations(styles: Record<string, unknown>, path: string): void {
	for (const [prop, value] of Object.entries(styles)) {
		assertAllowedProperty(prop, path)
		if (value && typeof value === 'object' && !Array.isArray(value)) {
			throw new Error(`[aven-ui] Nested CSS declarations are not allowed in ${path}.${prop}`)
		}
		validateTokenTree(value, `${path}.${prop}`)
	}
}

function validateComponentStyles(styles: Record<string, unknown>, path: string): void {
	for (const [prop, value] of Object.entries(styles)) {
		if (value && typeof value === 'object' && !Array.isArray(value)) {
			if (!(prop.startsWith(':') || prop.startsWith('[') || /^[A-Za-z][A-Za-z0-9_-]*(?:\s+[A-Za-z][A-Za-z0-9_-]*)*$/.test(prop))) {
				throw new Error(`[aven-ui] Forbidden component modifier "${prop}" in ${path}`)
			}
			validateDeclarations(value as Record<string, unknown>, `${path}.${prop}`)
			continue
		}
		assertAllowedProperty(prop, path)
		validateTokenTree(value, `${path}.${prop}`)
	}
}

function validateSelectors(selectors: Record<string, Record<string, unknown>>, path: string): void {
	for (const [selector, styles] of Object.entries(selectors)) {
		assertSafeKey(selector, path)
		if (!styles || typeof styles !== 'object' || Array.isArray(styles)) {
			throw new Error(`[aven-ui] Expected selector object at ${path}.${selector}`)
		}
		if (selector.startsWith('@keyframes')) {
			if (!KEYFRAMES_RULE.test(selector)) throw new Error(`[aven-ui] Forbidden at-rule in ${path}: ${selector}`)
			for (const [step, declarations] of Object.entries(styles)) {
				if (!KEYFRAME_STEP.test(step) || !declarations || typeof declarations !== 'object' || Array.isArray(declarations)) {
					throw new Error(`[aven-ui] Forbidden keyframe step in ${path}.${selector}: ${step}`)
				}
				validateDeclarations(declarations as Record<string, unknown>, `${path}.${selector}.${step}`)
			}
			continue
		}
		if (selector.startsWith('@media')) {
			if (!MEDIA_RULE.test(selector)) throw new Error(`[aven-ui] Forbidden at-rule in ${path}: ${selector}`)
			validateSelectors(styles as Record<string, Record<string, unknown>>, `${path}.${selector}`)
			continue
		}
		if (selector.startsWith('@')) throw new Error(`[aven-ui] Forbidden at-rule in ${path}: ${selector}`)
		assertSafeSelector(selector, path)
		validateDeclarations(styles, `${path}.${selector}`)
	}
}

export function validateStyleDef(style: StyleDef, path = 'style'): void {
	if (!style || typeof style !== 'object') {
		throw new Error(`[aven-ui] Invalid style definition at ${path}`)
	}
	for (const key of Object.keys(style as Record<string, unknown>)) {
		if (!TOP_LEVEL_STYLE_KEYS.has(key)) {
			throw new Error(`[aven-ui] Forbidden style field "${key}" at ${path}. Use tokens/components/selectors only.`)
		}
		if (FORBIDDEN_STYLE_KEYS.has(key)) {
			throw new Error(
				`[aven-ui] Forbidden style field "${key}" at ${path}. Raw CSS is not allowed.`
			)
		}
	}
	validateTokenTree(style.tokens, `${path}.tokens`)
	if (style.components) {
		for (const [className, styles] of Object.entries(style.components)) {
			if (!SAFE_CLASS.test(className)) throw new Error(`[aven-ui] Forbidden component class "${className}"`)
			validateComponentStyles(styles, `${path}.components.${className}`)
		}
	}
	if (style.selectors) validateSelectors(style.selectors, `${path}.selectors`)
}
