/** Strict renderer allowlists. Anything not listed here must fail closed before DOM/CSS use. */

export const FORBIDDEN_PATH_KEYS = ['__proto__', 'constructor', 'prototype']

export const CSS_INJECTION_PATTERNS = [
	/javascript\s*:/i,
	/vbscript\s*:/i,
	/data\s*:\s*[^,]*base64\s*,/i,
	/expression\s*\(/i,
	/-moz-binding\s*:/i,
	/@import\b/i,
	/behavior\s*:/i
]

export const SAFE_TAGS = new Set([
	'div',
	'span',
	'p',
	'a',
	'button',
	'input',
	'textarea',
	'select',
	'option',
	'optgroup',
	'form',
	'label',
	'fieldset',
	'legend',
	'img',
	'picture',
	'source',
	'ul',
	'ol',
	'li',
	'dl',
	'dt',
	'dd',
	'table',
	'thead',
	'tbody',
	'tfoot',
	'tr',
	'th',
	'td',
	'caption',
	'colgroup',
	'col',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'header',
	'footer',
	'main',
	'nav',
	'section',
	'article',
	'aside',
	'details',
	'summary',
	'figure',
	'figcaption',
	'blockquote',
	'pre',
	'code',
	'em',
	'strong',
	'small',
	'sub',
	'sup',
	'mark',
	'del',
	'ins',
	'abbr',
	'time',
	'progress',
	'meter',
	'output',
	'dialog',
	'hr',
	'br'
])

export const ALLOWED_EVENTS = new Set(['click', 'change', 'input', 'submit'])

const GLOBAL_ATTRS = new Set(['id', 'title', 'role', 'tabindex', 'hidden'])

const TAG_ATTRS: Record<string, Set<string>> = {
	a: new Set(['href', 'target', 'rel']),
	button: new Set(['type', 'disabled', 'name', 'value']),
	form: new Set(['autocomplete', 'name']),
	img: new Set(['src', 'alt', 'width', 'height', 'loading', 'decoding']),
	input: new Set([
		'type',
		'name',
		'value',
		'checked',
		'disabled',
		'readonly',
		'required',
		'multiple',
		'placeholder',
		'autocomplete',
		'inputmode',
		'min',
		'max',
		'step'
	]),
	label: new Set(['for']),
	option: new Set(['value', 'selected', 'disabled']),
	optgroup: new Set(['label', 'disabled']),
	progress: new Set(['value', 'max']),
	select: new Set(['name', 'disabled', 'required', 'multiple']),
	source: new Set(['src', 'type']),
	textarea: new Set([
		'name',
		'placeholder',
		'rows',
		'cols',
		'maxlength',
		'readonly',
		'disabled',
		'required'
	]),
	time: new Set(['datetime'])
}

export const BOOLEAN_ATTRS = new Set([
	'disabled',
	'readonly',
	'checked',
	'selected',
	'autofocus',
	'required',
	'multiple'
])

export const URL_ATTRS = new Set(['href', 'src', 'poster'])

export const CLASS_VALUE_PATTERN = /^[A-Za-z0-9_-]+(?:\s+[A-Za-z0-9_-]+)*$/
export const SLOT_REF_PATTERN = /^\$[A-Za-z][A-Za-z0-9_-]*$/

export function isAllowedAttribute(tag: string, name: string): boolean {
	const attr = name.toLowerCase()
	if (!/^[a-z][a-z0-9_.:-]*$/.test(attr)) return false
	if (attr.startsWith('on')) return false
	if (attr === 'style' || attr === 'srcdoc' || attr === 'innerhtml' || attr === 'outerhtml')
		return false
	if (attr.startsWith('aria-') || attr.startsWith('data-')) return true
	return GLOBAL_ATTRS.has(attr) || Boolean(TAG_ATTRS[tag]?.has(attr))
}

export function isSafeUrl(value: string): boolean {
	const url = value.trim()
	if (!url) return true
	// Inline RASTER image data URLs are allowed (the bookkeeping preview + rasterized PDF pages).
	// Raster formats are pure pixel data and can NEVER execute script — even if the URL is navigated
	// to (e.g. via <a href>). `data:image/svg+xml` is deliberately EXCLUDED: an SVG document can carry
	// inline <script> that runs on navigation, so it stays blocked. All other `data:` schemes (html,
	// text, application, …) remain blocked too. board 0063.
	if (/^data:image\/(?:png|jpe?g|gif|webp|avif|bmp)[;,]/i.test(url)) return true
	return /^(https?:\/\/|mailto:|tel:|\/|\.\/|\.\.\/|#)/i.test(url) || !url.includes(':')
}

export function assertSafeClassValue(value: unknown, path = 'class'): void {
	if (value == null || typeof value !== 'string' || value.startsWith('$')) return
	if (!CLASS_VALUE_PATTERN.test(value)) {
		throw new Error(`[aven-ui] Forbidden class value in ${path}`)
	}
}

export function assertSafeAttributeValue(
	tag: string,
	name: string,
	value: unknown,
	path: string
): void {
	if (value == null || typeof value !== 'string' || value.startsWith('$')) return
	const attr = name.toLowerCase()
	if (URL_ATTRS.has(attr) && !isSafeUrl(value)) {
		throw new Error(`[aven-ui] Forbidden URL attribute value in ${path}.${name}`)
	}
	if (tag === 'button' && attr === 'type' && !['button', 'submit', 'reset'].includes(value)) {
		throw new Error(`[aven-ui] Forbidden button type in ${path}.${name}`)
	}
	if (
		tag === 'input' &&
		attr === 'type' &&
		!['checkbox', 'email', 'number', 'password', 'search', 'tel', 'text', 'url'].includes(value)
	) {
		throw new Error(`[aven-ui] Forbidden input type in ${path}.${name}`)
	}
}

export function sanitizeAttributeWhitelist(value: unknown): string {
	if (value === null || value === undefined) return ''
	const s = String(value)
	return s.replace(/[^\p{L}\p{N}\s.,!?_:;@#()+=[\]~&%/-]/gu, '')
}

export function sanitizePayloadForValidation(payload: unknown): unknown {
	if (!payload || typeof payload !== 'object') return payload
	if (Array.isArray(payload)) return payload.map(sanitizePayloadForValidation)
	const result: Record<string, unknown> = {}
	for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
		if (v != null && typeof v === 'object' && !Array.isArray(v)) {
			result[k] = sanitizePayloadForValidation(v)
		} else {
			result[k] = v
		}
	}
	return result
}
