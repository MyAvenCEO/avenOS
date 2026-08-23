import { expect, test } from 'bun:test'
import { ArtifactStoreClient } from '../src/client'

test('client sends canonical publication bytes and the epoch precondition', async () => {
	let captured: Request | undefined
	const client = new ArtifactStoreClient({
		baseUrl: 'https://store.example/',
		bearerToken: () => 'secret',
		requestHeaders: () => ({ 'x-aven-artifact-database': 'cust_acme' }),
		fetch: async (input, init) => {
			captured = new Request(input, init)
			return new Response('{"replayed":false}', {
				headers: { 'content-type': 'application/json' }
			})
		}
	})
	await client.publish('scope', 'publication', 'epoch', {
		intent: { z: 1, a: 2 },
		blobAuthorities: {}
	})
	expect(captured?.method).toBe('PUT')
	expect(captured?.headers.get('authorization')).toBe('Bearer secret')
	expect(captured?.headers.get('x-aven-artifact-database')).toBe('cust_acme')
	expect(captured?.headers.get('if-artifact-store-epoch')).toBe('epoch')
	expect(await captured?.text()).toBe('{"blobAuthorities":{},"intent":{"a":2,"z":1}}')
})

test('client forwards a streaming upload with its exact declaration', async () => {
	let captured: Request | undefined
	const client = new ArtifactStoreClient({
		baseUrl: 'https://store.example',
		bearerToken: () => 'secret',
		fetch: async (input, init) => {
			captured = new Request(input, init)
			return new Response('{"length":5,"sha256":"abc"}', {
				headers: { 'content-type': 'application/json' }
			})
		}
	})
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new TextEncoder().encode('hello'))
			controller.close()
		}
	})

	await client.uploadBody(
		'scope',
		'claim',
		{ sha256: 'abc', length: 5, declaredMediaType: 'text/plain' },
		body
	)

	expect(captured?.method).toBe('PUT')
	expect(captured?.headers.get('authorization')).toBe('Bearer secret')
	expect(captured?.headers.get('content-length')).toBe('5')
	expect(captured?.headers.get('content-type')).toBe('text/plain')
	expect(captured?.headers.get('x-expected-sha256')).toBe('abc')
	expect(await captured?.text()).toBe('hello')
})
