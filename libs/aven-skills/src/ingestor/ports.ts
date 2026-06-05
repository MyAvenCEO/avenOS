/**
 * Side-effecting capabilities the ingestor needs, expressed as ports so the engine
 * stays environment-agnostic: the browser/Tauri host injects a Groove-backed uploader
 * + Web Crypto hash; tests inject in-memory fakes. Mirrors the actor model's
 * "talk to a capability, don't import it" boundary.
 */

export interface UploadInput {
	filename: string
	mimeType: string
	bytes: Uint8Array
	/** sha256 of `bytes`, pre-computed by the ingest stage. */
	contentSha256: string
}

export interface UploadResult {
	/** Stable id of the persisted source doc (e.g. Groove `files` row id). */
	fileId: string
}

export interface UploaderPort {
	upload(input: UploadInput): Promise<UploadResult>
}

export interface HashPort {
	sha256Hex(bytes: Uint8Array): Promise<string>
}

export interface IngestorPorts {
	uploader: UploaderPort
	hash: HashPort
}

function toHex(buf: ArrayBuffer): string {
	const view = new Uint8Array(buf)
	let out = ''
	for (let i = 0; i < view.length; i++) out += view[i].toString(16).padStart(2, '0')
	return out
}

/** sha256 via Web Crypto — available in browsers, Bun, and modern Node. No deps. */
export const webCryptoHashPort: HashPort = {
	async sha256Hex(bytes) {
		const view = new Uint8Array(bytes)
		const ab = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer
		const digest = await globalThis.crypto.subtle.digest('SHA-256', ab)
		return toHex(digest)
	}
}

/**
 * Uploader that persists nothing and returns a content-addressed id. Used as the
 * default (no host wired) and in tests — keeps provenance deterministic.
 */
export function memoryUploaderPort(): UploaderPort {
	return {
		async upload({ contentSha256 }) {
			return { fileId: `mem:${contentSha256.slice(0, 16)}` }
		}
	}
}

export function defaultPorts(): IngestorPorts {
	return { uploader: memoryUploaderPort(), hash: webCryptoHashPort }
}
