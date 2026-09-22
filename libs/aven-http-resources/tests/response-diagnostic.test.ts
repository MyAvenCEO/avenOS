import { expect, test } from 'vitest'
import { httpResponseDiagnostic } from '../src/response-diagnostic'

test.each([200, 204, 205, 206, 302, 304, 401, 403, 404, 410, 429, 503])(
	'HTTP %s carries a bounded protocol-only meaning without invented values or authority',
	(status) => {
		const value = httpResponseDiagnostic(status)
		expect(value.scope).toBe('http-status-only')
		expect(value.explanation.length).toBeLessThan(400)
		expect(value.explanation.length).toBeGreaterThan(50)
		expect(Object.keys(value)).toEqual(['scope', 'explanation'])
	}
)
test('404, no content and partial content remain different from zero or complete records', () => {
	expect(httpResponseDiagnostic(404).explanation).toContain('existence was not disclosed')
	expect(httpResponseDiagnostic(404).explanation).toContain('Do not invent the response shape')
	expect(httpResponseDiagnostic(404).explanation).toContain('does not establish access denial')
	expect(httpResponseDiagnostic(204).explanation).toContain('No body value')
	expect(httpResponseDiagnostic(206).explanation).toContain('complete resource')
	expect(httpResponseDiagnostic(304).explanation).toContain('independently authorized')
})
test.each([NaN, Infinity, -1, 0, 100, 199, 200.5, 600])(
	'rejects invalid final status %s',
	(status) => {
		expect(() => httpResponseDiagnostic(status)).toThrow('HTTP_RESPONSE_STATUS_INVALID')
	}
)
