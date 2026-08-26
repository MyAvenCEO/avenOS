import { SAFE_TAGS, sanitizeAttributeWhitelist } from './security'
import type { RenderData, SlotRegistry, ViewDef, ViewNode } from './types'
import { renderMarkdown } from './view-engine'

/**
 * THE SAME VIEW, AS A STRING.
 *
 * `view-engine` walks a `ViewDef` into DOM nodes for a shadow root. This walks
 * the identical definition into HTML text, so a view can be rendered at BUILD
 * time and shipped as a static file.
 *
 * That is what the marketing site needs. It is `adapter-static` with
 * `prerender = true` and `strict: true`: its content has to exist in the HTML
 * when the file is written, or the pages ship as empty shells and every one of
 * their anchors disappears. A shadow-DOM renderer cannot do that by
 * construction — the DOM it builds only exists once a browser has run it.
 *
 * Two renderers over one definition is a real cost, and they can drift. What
 * keeps them honest is that the SHAPE of the walk is the same in both — same
 * tag safety, same attribute sanitising, same `$each`/`$slot`/`children`
 * ordering — plus a conformance test that runs a fixture through both and
 * compares the text they produce.
 *
 * Interaction is deliberately absent. `$on` handlers are DOM listeners and
 * belong to the client renderer; static output carries the markup, and the
 * client hydrates the behaviour on top of it.
 */

/** Elements that cannot have children and must not be given a closing tag. */
const VOID_TAGS = new Set([
	'area',
	'base',
	'br',
	'col',
	'embed',
	'hr',
	'img',
	'input',
	'link',
	'meta',
	'source',
	'track',
	'wbr'
])

/**
 * Escape text for HTML.
 *
 * Applied to every resolved value, because a `ViewDef` may carry state that
 * came from a user. The DOM renderer gets this for free from `textContent`;
 * building a string means doing it explicitly, and forgetting is how a
 * generator becomes an injection vector.
 */
function escapeText(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Attribute values additionally need their quotes neutralised. */
function escapeAttribute(value: string): string {
	return escapeText(value).replace(/"/g, '&quot;')
}

/** How a value in the definition resolves against the render data. */
export type Evaluate = (expression: unknown, data: RenderData) => Promise<unknown> | unknown

export interface StringRenderOptions {
	/** Resolves `{state.x}` style expressions — supply the engine's evaluator. */
	evaluate: Evaluate
	/** Named views a `$slot` can pull in. */
	slots?: SlotRegistry
}

/** Render one node and everything under it. */
async function renderNode(
	node: ViewNode,
	data: RenderData,
	options: StringRenderOptions,
	path = '0'
): Promise<string> {
	if (!node) return ''

	const rawTag = (node.tag || 'div').toLowerCase()
	const tag = SAFE_TAGS.has(rawTag) ? rawTag : 'div'

	const attrs: string[] = [`data-aven-path="${escapeAttribute(path)}"`]

	if (node.class) {
		const resolved = await options.evaluate(node.class, data)
		if (resolved) attrs.push(`class="${escapeAttribute(sanitizeAttributeWhitelist(resolved))}"`)
	}

	if (node.attrs) {
		for (const [name, value] of Object.entries(node.attrs)) {
			const resolved = await options.evaluate(value, data)
			if (resolved === undefined || resolved === null) continue
			// Boolean attributes render bare or not at all, as in HTML.
			if (typeof resolved === 'boolean') {
				if (resolved) attrs.push(name)
				continue
			}
			attrs.push(`${name}="${escapeAttribute(sanitizeAttributeWhitelist(resolved))}"`)
		}
	}

	if (node.value !== undefined) {
		const resolved = await options.evaluate(node.value, data)
		attrs.push(`value="${escapeAttribute(String(resolved ?? ''))}"`)
	}

	const open = `<${tag} ${attrs.join(' ')}>`
	if (VOID_TAGS.has(tag)) return open

	let inner = ''

	if (node.text !== undefined) {
		const resolved = await options.evaluate(node.text, data)
		const asMarkdown = node.format === 'md' || node.format === 'markdown'
		inner =
			asMarkdown && (typeof resolved === 'string' || resolved == null)
				? await renderMarkdown(String(resolved || ''))
				: escapeText(String(resolved ?? ''))
	}

	if (node.$each) {
		const items = await options.evaluate(node.$each.items, data)
		if (Array.isArray(items)) {
			const parts: string[] = []
			for (let i = 0; i < items.length; i++) {
				parts.push(
					await renderNode(
						node.$each.template,
						{ state: data.state, item: items[i], index: i },
						options,
						`${path}.$each.${i}`
					)
				)
			}
			inner = parts.join('')
		} else {
			inner = ''
		}
	} else if (node.$slot) {
		inner = await renderSlot(node, data, options)
	} else if (node.children) {
		const parts: string[] = []
		for (let i = 0; i < node.children.length; i++) {
			parts.push(await renderNode(node.children[i], data, options, `${path}.${i}`))
		}
		inner += parts.join('')
	}

	return `${open}${inner}</${tag}>`
}

async function renderSlot(
	node: ViewNode,
	data: RenderData,
	options: StringRenderOptions
): Promise<string> {
	const key = node.$slot
	if (!key?.startsWith('$')) return ''
	const registry = options.slots ?? {}
	const view = registry[key.slice(1)] ?? registry[key]
	if (!view) return ''
	const slotNode = (view as ViewDef).content ?? view
	return renderNode(slotNode as ViewNode, data, options)
}

/**
 * Render a view to HTML text.
 *
 * The counterpart to `ViewEngine.render`, minus the shadow root and minus the
 * event wiring — everything else follows the same walk in the same order.
 */
export async function renderViewToString(
	viewDef: ViewDef,
	state: Record<string, unknown>,
	options: StringRenderOptions
): Promise<string> {
	const node = viewDef.content ?? viewDef
	return renderNode(node as ViewNode, { state }, options)
}
