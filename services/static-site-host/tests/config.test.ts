import { describe, expect, test } from 'bun:test'
import { loadConfig } from '../src/config.js'

const validEnvironment: NodeJS.ProcessEnv = {
	SITE_HOST_DIRECTORY_BEARER_TOKEN: 'a'.repeat(32),
	SITE_HOST_DIRECTORY_URL: 'http://app:3000/internal/v1/static-sites/bindings',
	SITE_HOST_ALLOWED_IPV4: '192.0.2.10'
}

describe('site host configuration', () => {
	test('snapshot mode has no control-plane credential or network dependency', () => {
		const config = loadConfig({ SITE_HOST_MODE: 'snapshot' })
		expect(config.mode).toBe('snapshot')
		expect('directoryUrl' in config).toBe(false)
		expect('bearerToken' in config).toBe(false)
	})

	test('derives a same-origin status endpoint and bounded concurrency', () => {
		const config = loadConfig(validEnvironment)
		if (config.mode !== 'managed') throw new Error('expected managed mode')
		expect(config.statusUrl).toBe('http://app:3000/internal/v1/static-sites/status')
		expect(config.maxConcurrentSyncs).toBe(4)
	})

	test('does not send the directory token to a different origin', () => {
		expect(() =>
			loadConfig({
				...validEnvironment,
				SITE_HOST_STATUS_URL: 'https://attacker.example/status'
			})
		).toThrow(/same origin/)
	})

	test('accepts only HTTP directory endpoints', () => {
		expect(() =>
			loadConfig({ ...validEnvironment, SITE_HOST_DIRECTORY_URL: 'file:///tmp/bindings' })
		).toThrow(/HTTP or HTTPS/)
	})

	test('rejects an unknown operating mode', () => {
		expect(() => loadConfig({ SITE_HOST_MODE: 'offline' })).toThrow(/managed or snapshot/)
	})
})
