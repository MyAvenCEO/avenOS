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
	test('rejects non-deployment artifact branches', () =>
		expect(() => validateBinding({ ...valid, artifact_ref: 'refs/heads/main' })).toThrow())
})
