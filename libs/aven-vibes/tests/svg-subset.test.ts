import { describe, expect, test } from 'bun:test'
import { validateViewDef } from '../src/engine/index'

// board 0115 — the inline-SVG ICON subset: shape/geometry only, fail-closed. Accepts a plain icon;
// rejects every escape hatch by name (HTML embedding, external refs, scripts, event handlers, url()
// paint servers, non-geometry path data).

const icon = (extra: object = {}, tag = 'path', attrs: object = { d: 'M3 12h18M3 6h18' }) => ({
	content: {
		class: 'row',
		children: [
			{
				tag: 'svg',
				class: 'ic',
				attrs: { viewBox: '0 0 24 24', width: '18', height: '18', stroke: 'currentColor' },
				children: [{ tag, attrs, ...extra }]
			}
		]
	}
})

describe('board 0115 — the SVG icon subset', () => {
	test('a plain shape icon validates', () => {
		expect(() => validateViewDef(icon() as never)).not.toThrow()
		expect(() =>
			validateViewDef(icon({}, 'circle', { cx: '12', cy: '12', r: '9', fill: 'none' }) as never)
		).not.toThrow()
	})
	test('foreignObject (HTML embedding) is rejected', () => {
		expect(() => validateViewDef(icon({}, 'foreignObject', {}) as never)).toThrow(/Forbidden tag/)
	})
	test('use / image (external refs) are rejected', () => {
		expect(() => validateViewDef(icon({}, 'use', {}) as never)).toThrow(/Forbidden tag/)
		expect(() => validateViewDef(icon({}, 'image', {}) as never)).toThrow(/Forbidden tag/)
	})
	test('script is rejected', () => {
		expect(() => validateViewDef(icon({}, 'script', {}) as never)).toThrow(/Forbidden tag/)
	})
	test('href / xlink:href on a shape is rejected', () => {
		expect(() => validateViewDef(icon({}, 'path', { d: 'M0 0', href: '#x' }) as never)).toThrow(
			/Forbidden attribute/
		)
	})
	test('event-handler attributes are rejected', () => {
		expect(() =>
			validateViewDef(icon({}, 'path', { d: 'M0 0', onload: 'alert(1)' }) as never)
		).toThrow(/Forbidden attribute/)
	})
	test('url() paint servers + protocols in values are rejected', () => {
		expect(() =>
			validateViewDef(icon({}, 'path', { d: 'M0 0', fill: 'url(#leak)' }) as never)
		).toThrow(/Forbidden SVG attribute value/)
		expect(() =>
			validateViewDef(icon({}, 'path', { d: 'M0 0', fill: 'javascript:x' }) as never)
		).toThrow(/Forbidden/)
	})
	test('non-geometry path data is rejected', () => {
		expect(() =>
			validateViewDef(icon({}, 'path', { d: 'M0 0 <script>' }) as never)
		).toThrow(/Forbidden path data/)
	})
})
