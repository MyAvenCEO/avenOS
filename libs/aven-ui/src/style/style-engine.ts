import type { StyleDef } from '../types.js'
import { CSS_INJECTION_PATTERNS, FORBIDDEN_PATH_KEYS } from '../security.js'
import { validateStyleDef } from '../style-validator.js'
import { compileCSSProperties, toKebabCase } from '../utils.js'

function assertSafePath(path: string, context = 'style token path'): void {
	if (!path || typeof path !== 'string') return
	const lowerPath = path.toLowerCase()
	for (const key of FORBIDDEN_PATH_KEYS) {
		if (lowerPath.includes(key.toLowerCase())) {
			throw new Error(`[StyleEngine] Forbidden ${context}: ${path}`)
		}
	}
}

function resolvePath(obj: Record<string, unknown>, path: string): unknown {
	if (!obj || !path) return undefined
	assertSafePath(path)
	return path.split('.').reduce<unknown>((acc, key) => {
		assertSafePath(key, 'style token segment')
		if (acc && typeof acc === 'object' && !Array.isArray(acc)) {
			return (acc as Record<string, unknown>)[key]
		}
		return undefined
	}, obj)
}

function sanitizeCSSInterpolatedValue(value: unknown): string {
	if (value == null || typeof value !== 'string') return String(value ?? '')
	for (const pattern of CSS_INJECTION_PATTERNS) {
		if (pattern.test(value)) return ''
	}
	return value
}

function deepMerge(
	target: Record<string, unknown>,
	source: Record<string, unknown>,
): Record<string, unknown> {
	const output = { ...target }
	for (const key of Object.keys(source)) {
		const sv = source[key]
		const tv = target[key]
		if (sv instanceof Object && !Array.isArray(sv) && key in target && tv instanceof Object && !Array.isArray(tv)) {
			output[key] = deepMerge(tv as Record<string, unknown>, sv as Record<string, unknown>)
		} else {
			output[key] = sv
		}
	}
	return output
}

export class StyleEngine {
	private cache = new Map<string, CSSStyleSheet[]>()

	clearCache(): void {
		this.cache.clear()
	}

	async getStyleSheets(style: StyleDef, containerName = 'aven-ui'): Promise<CSSStyleSheet[]> {
		validateStyleDef(style)
		const cacheKey = `${containerName}_${JSON.stringify(style)}`
		const cached = this.cache.get(cacheKey)
		if (cached) return cached

		const defaultContainerTokens = {
			containers: {
				xs: '240px',
				sm: '360px',
				md: '480px',
				lg: '640px',
				xl: '768px',
				'2xl': '1024px',
			},
			containerName,
		}

		const brandTokens = (style.tokens ?? {}) as Record<string, unknown>
		const mergedTokens = deepMerge(defaultContainerTokens, brandTokens)
		const components = (style.components ?? {}) as Record<string, Record<string, unknown>>
		const selectors = (style.selectors ?? {}) as Record<string, Record<string, unknown>>

		const css = this.compileToCSS(mergedTokens, components, selectors, containerName)

		const sheet = new CSSStyleSheet()
		await sheet.replace(css)
		const sheets = [sheet]
		this.cache.set(cacheKey, sheets)
		return sheets
	}

	private interpolateTokens(value: unknown, tokens: Record<string, unknown>): string {
		if (typeof value !== 'string') return String(value ?? '')
		const interpolated = value.replace(/\{([^}]+)\}/g, (match, path: string) => {
			const tokenValue = resolvePath(tokens, path)
			if (tokenValue === undefined) return match
			return sanitizeCSSInterpolatedValue(String(tokenValue))
		})
		return sanitizeCSSInterpolatedValue(interpolated)
	}

	private flattenTokens(tokens: Record<string, unknown>, prefix = ''): Record<string, string> {
		const result: Record<string, string> = {}
		for (const [key, value] of Object.entries(tokens)) {
			const varName = prefix ? `${prefix}-${key}` : key
			if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
				Object.assign(result, this.flattenTokens(value as Record<string, unknown>, varName))
			} else {
				result[`--${varName}`] = sanitizeCSSInterpolatedValue(String(value))
			}
		}
		return result
	}

	private compileTokensToCSS(tokens: Record<string, unknown>, containerName: string): string {
		const flatTokens = this.flattenTokens(tokens)
		const cssVars = Object.entries(flatTokens)
			.map(([name, value]) => `  ${name}: ${value};`)
			.join('\n')
		const sanitizedName = containerName.replace(/[^a-zA-Z0-9-_]/g, '-').replace(/-+/g, '-')
		return `:host {\n  container-type: inline-size;\n  container-name: ${sanitizedName};\n${cssVars}\n}\n`
	}

	private compileModifierStyles(
		styles: Record<string, unknown>,
		tokens: Record<string, unknown>,
		indent = 2,
	): string {
		return compileCSSProperties(styles, (v) => this.interpolateTokens(v, tokens), indent)
	}

	private compileComponentsToCSS(
		components: Record<string, Record<string, unknown>>,
		tokens: Record<string, unknown>,
	): string {
		const cssRules: string[] = []
		for (const [className, styles] of Object.entries(components)) {
			const kebabClassName = toKebabCase(className)
			const baseStyles: Record<string, unknown> = {}
			const modifiers: Record<string, Record<string, unknown>> = {}
			for (const [prop, value] of Object.entries(styles)) {
				const isModifier =
					prop.startsWith(':') ||
					prop.startsWith('[') ||
					(typeof value === 'object' && value !== null && !Array.isArray(value))
				if (isModifier) modifiers[prop] = value as Record<string, unknown>
				else baseStyles[prop] = value
			}
			if (Object.keys(baseStyles).length > 0) {
				cssRules.push(
					`.${kebabClassName} {\n${this.compileModifierStyles(baseStyles, tokens)}\n}`,
				)
			}
			for (const [modifier, modifierStyles] of Object.entries(modifiers)) {
				let selector: string
				if (modifier.startsWith(':') || modifier.startsWith('[')) {
					selector = `.${kebabClassName}${modifier}`
				} else if (modifier.includes(' ')) {
					selector = `.${kebabClassName} ${modifier}`
				} else {
					selector = `.${kebabClassName}[${modifier}]`
				}
				cssRules.push(`${selector} {\n${this.compileModifierStyles(modifierStyles, tokens)}\n}`)
			}
		}
		return cssRules.join('\n\n')
	}

	private compileSelectors(selectors: Record<string, Record<string, unknown>>, tokens: Record<string, unknown>): string {
		const cssRules: string[] = []
		for (const [selector, styles] of Object.entries(selectors)) {
			const interpolatedSelector = this.interpolateTokens(selector, tokens)
			if (interpolatedSelector.startsWith('@')) {
				const nestedRules: string[] = []
				for (const [nestedSelector, nestedStyles] of Object.entries(styles)) {
					if (typeof nestedStyles === 'object' && nestedStyles !== null && !Array.isArray(nestedStyles)) {
						const kebabNested = nestedSelector.replace(/\.([a-zA-Z][a-zA-Z0-9]*)/g, (_m, cn) => `.${toKebabCase(cn)}`)
						nestedRules.push(
							`  ${kebabNested} {\n${this.compileModifierStyles(nestedStyles as Record<string, unknown>, tokens, 4)}\n  }`,
						)
					}
				}
				cssRules.push(`${interpolatedSelector} {\n${nestedRules.join('\n')}\n}`)
			} else {
				const kebabSelector = interpolatedSelector.replace(/\.([a-zA-Z][a-zA-Z0-9]*)/g, (_m, cn) => `.${toKebabCase(cn)}`)
				cssRules.push(`${kebabSelector} {\n${this.compileModifierStyles(styles, tokens)}\n}`)
			}
		}
		return cssRules.join('\n\n')
	}

	private compileToCSS(
		tokens: Record<string, unknown>,
		components: Record<string, Record<string, unknown>>,
		selectors: Record<string, Record<string, unknown>>,
		containerName: string,
	): string {
		let css = `${this.compileTokensToCSS(tokens, containerName)}\n${this.compileComponentsToCSS(components, tokens)}`
		const selectorCSS = this.compileSelectors(selectors, tokens)
		if (selectorCSS) css += `\n\n${selectorCSS}`
		return css
	}
}
