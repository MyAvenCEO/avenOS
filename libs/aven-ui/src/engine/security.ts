/** XSS / injection allowlists — ported from maia-engine security.js */

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

export const BOOLEAN_ATTRS = new Set([
	'disabled',
	'readonly',
	'checked',
	'selected',
	'autofocus',
	'required',
	'multiple'
])

export const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'poster'])

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
