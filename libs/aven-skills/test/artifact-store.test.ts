import { describe, expect, test } from 'bun:test'
import { memoryArtifactStore } from '../src/runner/ports'

describe('ArtifactStore (board 0089)', () => {
	test('put → get round-trips bytes + mime, content-addressed + idempotent', async () => {
		const store = memoryArtifactStore()
		const bytes = new TextEncoder().encode('hello %PDF fake bytes')
		const sha = await store.put(bytes, 'application/pdf')
		expect(sha).toMatch(/^[0-9a-f]{64}$/) // sha256 hex
		// same bytes → same content address (idempotent)
		expect(await store.put(bytes, 'application/pdf')).toBe(sha)
		const got = await store.get(sha)
		expect(got?.mime).toBe('application/pdf')
		expect(got ? new TextDecoder().decode(got.bytes) : null).toBe('hello %PDF fake bytes')
		// different bytes → different address
		const sha2 = await store.put(new TextEncoder().encode('other'), 'text/plain')
		expect(sha2).not.toBe(sha)
		expect(await store.get('deadbeef')).toBeNull()
	})
})
