import { describe, expect, test } from 'bun:test'
import { renderViewToString } from '../src/engine/string-renderer'
import type { ViewDef } from '../src/engine/types'

/**
 * Two renderers walk one definition — DOM for the client, string for the static
 * build — and the risk of that arrangement is that they drift apart silently.
 *
 * These tests pin the string renderer's contract: the shape of the walk, the
 * safety rules it inherits, and the escaping the DOM renderer gets for free
 * from `textContent` but a string builder has to do by hand. A view that
 * renders one way in the browser and another in the shipped file is the bug
 * this file exists to prevent.
 */

/** The evaluator the engine supplies; here, values pass through unchanged. */
const evaluate = (expression: unknown) => expression

const render = (view: ViewDef, state: Record<string, unknown> = {}) =>
	renderViewToString(view, state, { evaluate })

describe('the string renderer walks a view the way the DOM renderer does', () => {
	test('renders a tag with its class and text', async () => {
		const html = await render({ tag: 'p', class: 'lede', text: 'Hello' })
		expect(html).toContain('<p ')
		expect(html).toContain('class="lede"')
		expect(html).toContain('>Hello</p>')
	})

	test('walks children in order', async () => {
		const html = await render({
			tag: 'div',
			children: [
				{ tag: 'span', text: 'one' },
				{ tag: 'span', text: 'two' }
			]
		})
		expect(html.indexOf('one')).toBeLessThan(html.indexOf('two'))
	})

	test('expands $each once per item', async () => {
		const html = await render(
			{ tag: 'ul', $each: { items: ['a', 'b', 'c'], template: { tag: 'li', text: 'x' } } },
			{}
		)
		expect(html.match(/<li /g)?.length).toBe(3)
	})

	test('emits the same data-aven-path identifiers the DOM renderer uses', async () => {
		const html = await render({ tag: 'div', children: [{ tag: 'span', text: 'x' }] })
		expect(html).toContain('data-aven-path="0"')
		expect(html).toContain('data-aven-path="0.0"')
	})
})

describe('it inherits the DOM renderer safety rules', () => {
	test('an unsafe tag falls back to div rather than rendering', async () => {
		const html = await render({ tag: 'script', text: 'alert(1)' })
		expect(html).not.toContain('<script')
		expect(html).toContain('<div ')
	})

	test('void elements get no closing tag', async () => {
		const html = await render({ tag: 'img', attrs: { alt: '' } })
		expect(html).toContain('<img ')
		expect(html).not.toContain('</img>')
	})
})

describe('it escapes what the DOM renderer escapes implicitly', () => {
	test('text content cannot open a tag', async () => {
		const html = await render({ tag: 'p', text: '<script>alert(1)</script>' })
		expect(html).not.toContain('<script>')
		expect(html).toContain('&lt;script&gt;')
	})

	test('an attribute value cannot break out of its quotes', async () => {
		const html = await render({ tag: 'div', attrs: { title: 'a" onload="alert(1)' } })
		// The defence here is the shared whitelist sanitiser, which STRIPS the
		// quote rather than escaping it — the same one the DOM renderer uses, so
		// both agree. What matters is the property, not the mechanism: the value
		// cannot close its own attribute and open a handler.
		expect(html).not.toContain('onload="')
		expect(html.match(/"/g)?.length).toBe(4) // exactly the two attribute pairs
	})

	test('ampersands survive as entities rather than corrupting the markup', async () => {
		const html = await render({ tag: 'p', text: 'Fish & Chips' })
		expect(html).toContain('Fish &amp; Chips')
	})
})

describe('the output is usable as a static file', () => {
	test('a realistic card renders complete, with its text present in the markup', async () => {
		const view: ViewDef = {
			tag: 'section',
			class: 'panel stack stack-center',
			children: [
				{ tag: 'h1', class: 'title', text: 'Zahlung abgeschlossen' },
				{ tag: 'p', class: 'lede', text: 'Danke — der Kauf ist bei uns angekommen.' },
				{
					tag: 'div',
					class: 'well',
					children: [
						{ tag: 'p', class: 'eyebrow', text: 'Gekaufter Name' },
						{ tag: 'p', class: 'digits', text: 'samuel.aven' }
					]
				}
			]
		}
		const html = await render(view)
		// The point of this renderer: the words are IN the file, not produced by
		// a script once a browser runs. That is what keeps the site prerenderable.
		expect(html).toContain('Zahlung abgeschlossen')
		expect(html).toContain('samuel.aven')
		expect(html).toContain('class="panel stack stack-center"')
		expect(html.startsWith('<section ')).toBe(true)
		expect(html.endsWith('</section>')).toBe(true)
	})

	test('carries no event wiring — behaviour is the client renderer’s job', async () => {
		const html = await render({ tag: 'button', text: 'Go', $on: { click: { send: 'GO' } } })
		expect(html).not.toContain('onclick')
		expect(html).toContain('>Go</button>')
	})
})
