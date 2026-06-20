// Envelope encryption for the secrets vault (board 0055). The vault has ONE random master
// DEK; the DEK is AES-256-GCM-wrapped under a KEK derived from the passkey PRF (HKDF) with a
// PINNED per-vault salt; each secret is AES-256-GCM under the DEK. The server only ever stores
// ciphertext + wrapped-key + salt + nonces — never the token, DEK, KEK, or PRF. Provider-agnostic:
// `deriveVaultKey` (unlock.ts) supplies the 32-byte PRF; nothing here knows where it came from.

const enc = new TextEncoder()
const dec = new TextDecoder()

// WebCrypto's BufferSource wants ArrayBuffer-backed views; the modern TS lib types a bare
// Uint8Array as `Uint8Array<ArrayBufferLike>` (could be SharedArrayBuffer), which it rejects.
// All our byte producers (new Uint8Array(n), getRandomValues, new Uint8Array(buf)) are
// ArrayBuffer-backed, so we annotate them precisely.
type Bytes = Uint8Array<ArrayBuffer>

export function b64(bytes: Uint8Array): string {
	let s = ''
	for (const b of bytes) s += String.fromCharCode(b)
	return btoa(s)
}

export function unb64(s: string): Bytes {
	const bin = atob(s)
	const out = new Uint8Array(bin.length)
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
	return out
}

function randomBytes(n: number): Bytes {
	return crypto.getRandomValues(new Uint8Array(n))
}

/** A fresh PINNED salt for a new vault (stored on the vault row; reused on every unlock). */
export function newSalt(): Bytes {
	return randomBytes(32)
}

/** PRF (32B) + the pinned per-vault salt → the AES-GCM KEK. Deterministic: same inputs → same key. */
export async function deriveKek(prf: Bytes, salt: Bytes): Promise<CryptoKey> {
	const base = await crypto.subtle.importKey('raw', prf, 'HKDF', false, ['deriveKey'])
	return crypto.subtle.deriveKey(
		{ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('aven-vault-kek') },
		base,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	)
}

export type WrappedKey = { wrappedMasterKey: string; wrapNonce: string; alg: 'AES-256-GCM' }
export type Sealed = { ciphertext: string; nonce: string; alg: 'AES-256-GCM' }

/** A new random master DEK (extractable so we can wrap its raw bytes under the KEK). */
export async function generateMasterKey(): Promise<CryptoKey> {
	return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
}

/** Wrap the master DEK under the KEK — AES-GCM over the raw DEK bytes. */
export async function wrapMasterKey(dek: CryptoKey, kek: CryptoKey): Promise<WrappedKey> {
	const raw = new Uint8Array(await crypto.subtle.exportKey('raw', dek))
	const nonce = randomBytes(12)
	const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, kek, raw))
	return { wrappedMasterKey: b64(ct), wrapNonce: b64(nonce), alg: 'AES-256-GCM' }
}

/** Unwrap the master DEK with a KEK re-derived from the same PRF + pinned salt. */
export async function unwrapMasterKey(w: WrappedKey, kek: CryptoKey): Promise<CryptoKey> {
	const raw = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv: unb64(w.wrapNonce) },
		kek,
		unb64(w.wrappedMasterKey)
	)
	return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

/** Seal a secret (e.g. the Fly token) under the master DEK. */
export async function sealSecret(plaintext: string, dek: CryptoKey): Promise<Sealed> {
	const nonce = randomBytes(12)
	const ct = new Uint8Array(
		await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, dek, enc.encode(plaintext))
	)
	return { ciphertext: b64(ct), nonce: b64(nonce), alg: 'AES-256-GCM' }
}

/** Open a sealed secret with the master DEK. */
export async function openSecret(s: Sealed, dek: CryptoKey): Promise<string> {
	const pt = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv: unb64(s.nonce) },
		dek,
		unb64(s.ciphertext)
	)
	return dec.decode(pt)
}
