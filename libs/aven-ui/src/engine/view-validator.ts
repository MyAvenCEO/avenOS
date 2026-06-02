import { FORBIDDEN_PATH_KEYS } from './security.js'

const CONDITIONAL_OPS = [
	'$if',
	'$eq',
	'$ne',
	'$and',
	'$or',
	'$not',
	'$switch',
	'$gt',
	'$lt',
	'$gte',
	'$lte',
]

function isDSLOperation(value: unknown): boolean {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false
	const keys = Object.keys(value)
	if (keys.length === 0) return false
	const firstKey = keys[0]
	return firstKey.startsWith('$') && CONDITIONAL_OPS.includes(firstKey)
}

function hasTernary(value: unknown): boolean {
	return typeof value === 'string' && value.includes('?') && value.includes(':')
}

function rejectValue(value: unknown, path: string, propName: string): void {
	if (typeof value === 'object' && value !== null && isDSLOperation(value)) {
		const opName = Object.keys(value)[0]
		throw new Error(
			`[aven-ui] Conditional logic (${opName}) not allowed in ${path}.${propName}. Use state machines.`,
		)
	}
	if (hasTernary(value)) {
		throw new Error(
			`[aven-ui] Ternary operators not allowed in ${path}.${propName}. Use state machines.`,
		)
	}
}

function validateViewNode(node: unknown, path = 'view'): void {
	if (node == null || typeof node !== 'object') return
	if (Array.isArray(node)) {
		for (let i = 0; i < node.length; i++) {
			validateViewNode(node[i], `${path}[${i}]`)
		}
		return
	}
	const n = node as Record<string, unknown>
	if (n.class !== undefined) rejectValue(n.class, path, 'class')
	if (n.value !== undefined) rejectValue(n.value, path, 'value')
	if (n.text !== undefined) rejectValue(n.text, path, 'text')
	if (n.attrs && typeof n.attrs === 'object') {
		for (const [attrName, attrValue] of Object.entries(n.attrs as Record<string, unknown>)) {
			if (attrName !== 'data') rejectValue(attrValue, `${path}.attrs.${attrName}`, attrName)
		}
	}
	if (Array.isArray(n.children)) {
		for (let i = 0; i < n.children.length; i++) {
			const child = n.children[i]
			if (typeof child === 'object' && child !== null && isDSLOperation(child)) {
				throw new Error(
					`[aven-ui] Conditional logic (${Object.keys(child)[0]}) not allowed in view templates.`,
				)
			}
			validateViewNode(child, `${path}.children[${i}]`)
		}
	}
	if (n.$each && typeof n.$each === 'object') {
		validateViewNode((n.$each as { template: unknown }).template, `${path}.$each.template`)
	}
}

export function validateViewDef(viewDef: { content?: unknown } & Record<string, unknown>): void {
	const node = viewDef?.content ?? viewDef
	if (!node) return
	validateViewNode(node, 'view')
}

export function assertSafePath(path: string, context = 'path resolution'): void {
	if (!path || typeof path !== 'string') return
	const lowerPath = path.toLowerCase()
	for (const key of FORBIDDEN_PATH_KEYS) {
		if (lowerPath.includes(key.toLowerCase())) {
			throw new Error(`[aven-ui] Forbidden ${context}: ${path}`)
		}
	}
}

function resolvePath(obj: Record<string, unknown>, path: string): unknown {
	if (!path) return obj
	if (!obj) return undefined
	assertSafePath(path)
	return path.split('.').reduce<unknown>((acc, key) => {
		assertSafePath(key, 'path segment')
		if (acc && typeof acc === 'object' && !Array.isArray(acc)) {
			return (acc as Record<string, unknown>)[key]
		}
		return undefined
	}, obj)
}

export class Evaluator {
	private readonly maxDepth: number

	constructor(options: { maxDepth?: number } = {}) {
		this.maxDepth = options.maxDepth ?? 50
	}

	async evaluate(expression: unknown, data: { state: Record<string, unknown>; item?: unknown; index?: number }): Promise<unknown> {
		return this.evaluateInner(expression, data, 0)
	}

	private async evaluateInner(
		expression: unknown,
		data: { state: Record<string, unknown>; item?: unknown; index?: number },
		depth: number,
	): Promise<unknown> {
		if (depth > this.maxDepth) {
			throw new Error('[aven-ui] Maximum expression depth exceeded')
		}
		if (expression === null || expression === undefined) return expression
		if (typeof expression !== 'string') return expression

		if (expression.startsWith('$$')) {
			const key = expression.slice(2)
			if (data.item && typeof data.item === 'object' && data.item !== null) {
				return (data.item as Record<string, unknown>)[key]
			}
			return undefined
		}
		if (expression.startsWith('$')) {
			const key = expression.slice(1)
			return resolvePath(data.state, key)
		}
		return expression
	}
}
