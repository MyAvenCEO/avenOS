import type { FieldRule } from './ingestor/config'

/** Parse a value with a datetime token format into an ISO-ish string. */
function parseDateTime(value: string, format: string): string | null {
	const tokens = ['YYYY', 'MM', 'DD', 'HH', 'mm', 'ss'] as const
	const order: string[] = []
	// Build a regex from the format, escaping literals and capturing each token.
	let pattern = ''
	let i = 0
	while (i < format.length) {
		const tok = tokens.find((t) => format.startsWith(t, i))
		if (tok) {
			order.push(tok)
			pattern += tok === 'YYYY' ? '(\\d{4})' : '(\\d{1,2})'
			i += tok.length
		} else {
			pattern += format[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
			i += 1
		}
	}
	const m = value.trim().match(new RegExp(`^${pattern}`))
	if (!m) return null
	const part: Record<string, string> = {}
	order.forEach((tok, idx) => {
		part[tok] = m[idx + 1]
	})
	const pad = (s: string | undefined, n: number) => (s ?? '0').padStart(n, '0')
	const date = `${pad(part.YYYY, 4)}-${pad(part.MM, 2)}-${pad(part.DD, 2)}`
	const hasTime = 'HH' in part || 'mm' in part || 'ss' in part
	if (!hasTime) return date
	return `${date}T${pad(part.HH, 2)}:${pad(part.mm, 2)}:${pad(part.ss, 2)}`
}

function toNumber(raw: string, rule: FieldRule): number | null {
	let s = raw.trim()
	if (rule.thousands) s = s.split(rule.thousands).join('')
	if (rule.decimal && rule.decimal !== '.') s = s.replace(rule.decimal, '.')
	// Strip anything that isn't part of a number (currency symbols, %, spaces).
	s = s.replace(/[^0-9.-]/g, '')
	const n = Number.parseFloat(s)
	return Number.isFinite(n) ? n : null
}

function toInt(raw: string): number | null {
	const n = Number.parseInt(raw.replace(/[^0-9-]/g, ''), 10)
	return Number.isFinite(n) ? n : null
}

/**
 * Coerce one raw source cell to its target value per a field rule. Pure and total:
 * never throws — falls back to `default`, then `nullable`, then a type-appropriate empty.
 */
export function coerceValue(raw: string | undefined, rule: FieldRule): unknown {
	if ('const' in rule && rule.const !== undefined) return rule.const

	const empty = raw === undefined || raw === ''
	if (empty) {
		if (rule.default !== undefined) return rule.default
		if (rule.nullable) return null
		return rule.type && rule.type !== 'text' ? null : ''
	}

	const value = raw as string
	switch (rule.type) {
		case 'int': {
			const n = toInt(value)
			return n ?? rule.default ?? (rule.nullable ? null : 0)
		}
		case 'number': {
			const n = toNumber(value, rule)
			return n ?? rule.default ?? (rule.nullable ? null : 0)
		}
		case 'datetime': {
			const iso = rule.format ? parseDateTime(value, rule.format) : value
			return iso ?? rule.default ?? (rule.nullable ? null : value)
		}
		case 'bool':
			return /^(1|true|yes|ja|y)$/i.test(value.trim())
		default:
			return value
	}
}
