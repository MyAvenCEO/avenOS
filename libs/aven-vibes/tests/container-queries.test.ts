import { describe, expect, test } from 'bun:test'
import { StyleEngine } from '../src/engine/style-engine'
import { validateStyleDef } from '../src/engine/style-validator'
import { goalsStyle } from '../src/index'

// board 0114 — @container queries are a DEFAULT vibe capability, arranged so WebKit grids stay correct:
// the engine puts inline-size containment on the VIEW ROOT (:host > *:first-child, definite width), NEVER
// on :host (WKWebView shrink-wraps a contained host → every auto-fill grid collapsed to one column).

function compiledCss(style: typeof goalsStyle): string {
	const e = new StyleEngine() as unknown as {
		compileToCSS(
			t: Record<string, unknown>,
			c: Record<string, Record<string, unknown>>,
			s: Record<string, Record<string, unknown>>,
			n: string
		): string
	}
	return e.compileToCSS(
		{ containers: { xs: '240px' }, containerName: 't', ...(style.tokens ?? {}) },
		(style.components ?? {}) as never,
		(style.selectors ?? {}) as never,
		't'
	)
}

describe('board 0114 — container queries as default, WebKit-safe', () => {
	test('containment lives on the view root, NEVER on :host', () => {
		const css = compiledCss(goalsStyle)
		expect(css).toContain(':host > *:first-child')
		const rootRule = css.split(':host > *:first-child')[1] ?? ''
		expect(rootRule).toContain('container-type: inline-size')
		// the :host block itself must NOT carry containment (the WebKit shrink trigger).
		const hostBlock = css.split(':host {')[1]?.split('}')[0] ?? ''
		expect(hostBlock).not.toContain('container-type')
	})

	test('the shipping @container example (goals grid) validates + compiles', () => {
		expect(() => validateStyleDef(goalsStyle)).not.toThrow()
		const css = compiledCss(goalsStyle)
		expect(css).toContain('@container (max-width: 420px)')
		const cq = css.split('@container (max-width: 420px)')[1] ?? ''
		expect(cq).toContain('.gl-grid')
		expect(cq).toContain('minmax(8.5rem, 1fr)')
	})

	test('the validator stays strict: only bare width queries, nothing else', () => {
		const bad = (sel: string) =>
			validateStyleDef({
				tokens: {},
				selectors: { [sel]: { '.x': { color: 'red' } } }
			} as never)
		expect(() => bad('@container style(--x: 1)')).toThrow()
		expect(() => bad('@container named (max-width: 400px)')).toThrow()
		expect(() => bad('@container (aspect-ratio: 1/1)')).toThrow()
	})
})
