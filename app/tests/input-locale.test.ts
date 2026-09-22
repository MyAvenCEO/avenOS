import { expect, test } from 'bun:test'
import { inputLocale } from '@avenos/llm-client/input-decision'

test('native POSIX and absent language hints cannot prevent routing', () => {
	for (const value of [undefined, '', 'C', 'C.UTF-8', 'POSIX', 'de_DE.UTF-8'])
		expect(inputLocale(value)).toBe('en-GB')
})

test('valid language, script and numeric region hints are preserved', () => {
	expect(inputLocale('de-de')).toBe('de-DE')
	expect(inputLocale('es-419')).toBe('es-419')
	expect(inputLocale('zh-Hant-TW')).toBe('zh-Hant-TW')
	expect(inputLocale('en')).toBe('en')
})
