// board 0082 — content-addressed file references for the mainnet PRIVATE file store. Pure (no DOM/fs):
// the hash + path derivation live here and are unit-tested; the actual disk write/read is a thin Tauri
// fs call in the app. Source docs + generated PDFs are stored at `<spark root>/sparks/PRIVATE/<hash>`
// and referenced by content hash from the JSON — never base64-inlined, natural dedup (same bytes →
// same hash → same path). Testnet keeps its avenDB `files`-table flow; this is mainnet-only.

/** Lowercase hex SHA-256 of the bytes (Web Crypto — works in the browser, Bun and Node). */
export async function contentHash(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource)
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Path of a stored file relative to the spark/network root: `sparks/PRIVATE/<hash>[.ext]`. */
export function filePath(hash: string, ext?: string | null): string {
	const e = ext ? `.${ext.replace(/^\.+/, '')}` : ''
	return `sparks/PRIVATE/${hash}${e}`
}

/** A content-addressed reference to one file: the JSON stores this, not the bytes. */
export type FileRef = { hash: string; filename: string; mime: string; path: string }

function extOf(filename: string): string {
	const i = filename.lastIndexOf('.')
	return i > 0 && i < filename.length - 1 ? filename.slice(i + 1) : ''
}

/** Hash the bytes and bundle the reference (hash + path + filename + mime) for storage. */
export async function fileRef(bytes: Uint8Array, filename: string, mime: string): Promise<FileRef> {
	const hash = await contentHash(bytes)
	return { hash, filename, mime, path: filePath(hash, extOf(filename)) }
}
