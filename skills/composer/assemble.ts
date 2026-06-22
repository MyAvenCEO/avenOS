// Plain-HTML template assembly for the composer SSG: `{{> partial}}` includes (recursive, depth-
// capped) and `{{token}}` / `{{t.dotted.path}}` substitution. There is NO template language — no
// loops or conditionals; ALL logic lives in buildSite. This is pure, deterministic string assembly
// so GLM only ever writes plain HTML with named slots. board 0057.

export type Strings = Record<string, unknown> // a locale's parsed i18n JSON (may be nested)

/** Look up a dotted path (e.g. "nav.blog") in a nested object → its string value, or '' if missing. */
export function i18nGet(obj: Strings, path: string): string {
	let cur: unknown = obj
	for (const k of path.split('.')) {
		if (cur && typeof cur === 'object' && k in (cur as Record<string, unknown>)) {
			cur = (cur as Record<string, unknown>)[k]
		} else {
			return ''
		}
	}
	return typeof cur === 'string' || typeof cur === 'number' ? String(cur) : ''
}

/**
 * Resolve `{{> name}}` includes from `partials` (recursively, depth-capped to break cycles), then
 * substitute `{{t.dotted}}` from `i18n` and `{{key}}` from `tokens`. Unknown tokens become ''. Each
 * replace pass is single-scan, so text inserted from a token (e.g. rendered markdown in `content`)
 * is NOT re-interpreted. Deterministic, no eval.
 */
export function assemble(
	template: string,
	opts: { partials?: Record<string, string>; i18n?: Strings; tokens?: Record<string, string> }
): string {
	const partials = opts.partials ?? {}
	const i18n = opts.i18n ?? {}
	const tokens = opts.tokens ?? {}
	let out = template
	// 1) includes (depth-capped to avoid cycles)
	for (let depth = 0; depth < 10 && out.includes('{{>'); depth++) {
		out = out.replace(/\{\{>[ \t]*([A-Za-z0-9_-]+)[ \t]*\}\}/g, (_m, name) => partials[name] ?? '')
	}
	// 2) i18n tokens {{t.path}}
	out = out.replace(/\{\{[ \t]*t\.([A-Za-z0-9_.-]+)[ \t]*\}\}/g, (_m, path) => i18nGet(i18n, path))
	// 3) plain tokens {{key}}
	out = out.replace(/\{\{[ \t]*([A-Za-z0-9_-]+)[ \t]*\}\}/g, (_m, key) => tokens[key] ?? '')
	return out
}
