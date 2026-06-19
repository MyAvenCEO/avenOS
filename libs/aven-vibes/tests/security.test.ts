import { describe, expect, test } from 'bun:test'
import { validateStyleDef } from '../src/engine/style-validator.js'
import { validateViewDef } from '../src/engine/view-validator.js'
import { todoStyle } from '../src/vibes/todos/style.js'
import { todoView } from '../src/vibes/todos/view.js'

describe('strict vibe view allowlist', () => {
	test('accepts the bundled todos view', () => {
		expect(() => validateViewDef(todoView)).not.toThrow()
	})

	test('rejects non-whitelisted tags and view fields', () => {
		expect(() => validateViewDef({ tag: 'script', text: 'alert(1)' })).toThrow(/Forbidden tag/)
		expect(() => validateViewDef({ rawHtml: '<img onerror=alert(1)>' } as never)).toThrow(
			/Forbidden view field/
		)
	})

	test('rejects non-whitelisted attributes and unsafe URLs', () => {
		expect(() =>
			validateViewDef({ tag: 'button', attrs: { onclick: 'alert(1)', type: 'button' } })
		).toThrow(/Forbidden attribute/)
		expect(() => validateViewDef({ attrs: { style: 'position:fixed' } })).toThrow(
			/Forbidden attribute/
		)
		expect(() => validateViewDef({ tag: 'a', attrs: { href: 'javascript:alert(1)' } })).toThrow(
			/Forbidden URL attribute/
		)
	})

	test('rejects non-whitelisted DOM events', () => {
		expect(() =>
			validateViewDef({ tag: 'img', attrs: { src: '/ok.png' }, $on: { error: { send: 'X' } } })
		).toThrow(/Forbidden event/)
	})
})

describe('strict vibe style allowlist', () => {
	test('accepts the bundled todos style', () => {
		expect(() => validateStyleDef(todoStyle)).not.toThrow()
	})

	test('rejects raw CSS, external URLs, unknown properties, and global selectors', () => {
		expect(() => validateStyleDef({ rawCss: 'body { color: red }' } as never)).toThrow(
			/tokens\/components\/selectors|Raw CSS/
		)
		expect(() => validateStyleDef({ tokens: { bad: 'url(https://evil.example/a.png)' } })).toThrow(
			/Forbidden CSS value/
		)
		expect(() => validateStyleDef({ selectors: { '.card': { position: 'fixed' } } })).toThrow(
			/Forbidden CSS property/
		)
		expect(() => validateStyleDef({ selectors: { body: { color: 'red' } } })).toThrow(
			/Forbidden CSS selector/
		)
	})
})