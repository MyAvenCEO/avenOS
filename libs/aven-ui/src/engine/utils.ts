export function toKebabCase(str: string): string {
	if (!str || typeof str !== 'string') return str
	const kebab = str.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
	if (/^(webkit|moz|ms|o)-/.test(kebab)) return `-${kebab}`
	return kebab
}

export function compileCSSProperties(
	styles: Record<string, unknown>,
	interpolateTokens: (value: unknown) => string,
	indent = 2
): string {
	if (typeof styles !== 'object' || styles === null || Array.isArray(styles)) return ''
	const pad = ' '.repeat(indent)
	return Object.entries(styles)
		.map(([prop, value]) => {
			const cssProp = toKebabCase(prop)
			const cssValue = interpolateTokens(value)
			return `${pad}${cssProp}: ${cssValue};`
		})
		.join('\n')
}
