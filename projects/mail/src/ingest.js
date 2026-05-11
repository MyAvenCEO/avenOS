import { parseRfc822Metadata } from './rfc822.js'

/**
 * @param {import('./store-memory.js').InMemoryMailStore} store
 * @param {Uint8Array | ArrayBuffer} bytes
 */
export function ingestRfc822(store, bytes) {
	const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
	const meta = parseRfc822Metadata(u8)
	const id = crypto.randomUUID()
	store._rows.push({
		id,
		subject: meta.subject,
		from: meta.from,
		receivedAt: meta.receivedAt,
		raw: new Uint8Array(u8)
	})
}
