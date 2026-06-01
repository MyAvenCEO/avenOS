import { describe, expect, test } from 'bun:test'
import { validateStyleDef } from '../src/style-validator.js'
import { invoiceStyle } from '../src/vibes/invoice/style.js'

describe('validateStyleDef', () => {
	test('accepts structured invoice style', () => {
		expect(() => validateStyleDef(invoiceStyle)).not.toThrow()
	})

	test('rejects rawCss', () => {
		expect(() =>
			validateStyleDef({
				tokens: {},
				rawCss: 'body { background: red; }',
			} as never),
		).toThrow(/Raw CSS is not allowed/)
	})

	test('rejects @import in token values', () => {
		expect(() =>
			validateStyleDef({
				tokens: { evil: '@import url("https://evil.example/x.css")' },
			}),
		).toThrow(/Forbidden CSS value/)
	})

	test('rejects javascript: in component values', () => {
		expect(() =>
			validateStyleDef({
				components: {
					bad: { background: 'javascript:alert(1)' },
				},
			}),
		).toThrow(/Forbidden CSS value/)
	})
})
