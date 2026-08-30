import { describe, expect, test } from 'bun:test'
import { wrapTerminalText } from './deployment-bootstrap-tui.js'

describe('deployment bootstrap terminal forms', () => {
	test('wraps prose and provider URLs without dropping content', () => {
		const lines = wrapTerminalText(
			'Provider access must be ready\nhttps://console.hetzner.com/projects/1234567/servers',
			24
		)
		expect(lines.every((line) => line.length <= 24)).toBe(true)
		expect(lines.join('').replaceAll(' ', '')).toContain('Provideraccessmustbeready')
		expect(lines.join('')).toContain('https://console.hetzner')
	})
})
