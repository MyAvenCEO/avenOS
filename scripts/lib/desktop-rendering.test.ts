import { describe, expect, test } from 'bun:test'
import { desktopRenderingEnv } from './desktop-rendering'

describe('desktop rendering environment', () => {
	test('normal startup leaves hardware selection to WebKit', () => {
		const input = { DISPLAY: ':0' }
		expect(desktopRenderingEnv(input, 'linux')).toEqual(input)
		expect(desktopRenderingEnv(input, 'linux')).not.toBe(input)
	})
	test('explicit software rendering is isolated to the child', () => {
		const input = { DISPLAY: ':89' }
		expect(desktopRenderingEnv(input, 'linux', 'software')).toEqual({
			DISPLAY: ':89',
			WEBKIT_DISABLE_DMABUF_RENDERER: '1',
			WEBKIT_DISABLE_COMPOSITING_MODE: '1'
		})
		expect(input).toEqual({ DISPLAY: ':89' })
		expect(desktopRenderingEnv(input, 'linux', 'auto')).toEqual(input)
	})
	test('auto preserves an explicit driver workaround', () => {
		const input = { WEBKIT_DISABLE_DMABUF_RENDERER: '1' }
		expect(desktopRenderingEnv(input, 'linux')).toEqual(input)
	})
	test('software profile does not apply Linux flags on macOS', () => {
		expect(desktopRenderingEnv({}, 'darwin', 'software')).toEqual({})
	})
	test('rejects misspelled profiles', () => {
		expect(() => desktopRenderingEnv({}, 'linux', 'sofware')).toThrow('Use auto or software')
	})
})
