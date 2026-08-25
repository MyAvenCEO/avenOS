import { describe, expect, test } from 'bun:test'
import { type DirectoryBinding, validateBinding } from '../src/repository.js'

const valid: DirectoryBinding = {
	id: '00000000-0000-4000-8000-000000000001',
	hostname: 'customer.example',
	repository_full_name: 'myavenceo/avenceo',
	clone_url: 'https://github.com/myavenceo/avenceo.git',
	source_ref: 'refs/heads/next',
	artifact_ref: 'refs/heads/deploy/next',
	artifact_path: 'dist',
	verification_token_hash: 'a'.repeat(64),
	verified_at: null
}

describe('directory binding validation', () => {
	test('accepts the deployment branch contract', () =>
		expect(() => validateBinding(valid)).not.toThrow())
	test('rejects arbitrary clone URLs', () =>
		expect(() => validateBinding({ ...valid, clone_url: 'http://127.0.0.1/repo' })).toThrow())
	test('rejects malformed identifiers and repository traversal-like names', () => {
		expect(() => validateBinding({ ...valid, id: '0'.repeat(36) })).toThrow()
		expect(() =>
			validateBinding({
				...valid,
				repository_full_name: 'myavenceo/..',
				clone_url: 'https://github.com/myavenceo/...git'
			})
		).toThrow()
	})
	test('rejects non-deployment artifact branches', () =>
		expect(() => validateBinding({ ...valid, artifact_ref: 'refs/heads/main' })).toThrow())
	test.each(['refs/heads/-next', 'refs/heads/feature/.hidden', 'refs/heads/deploy/release.lock'])(
		'rejects a Git-invalid ref %s',
		(source_ref) => expect(() => validateBinding({ ...valid, source_ref })).toThrow()
	)
})
