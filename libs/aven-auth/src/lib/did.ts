import bs58 from 'bs58'

const ED25519_MULTICODEC_PREFIX = new Uint8Array([0xed, 0x01])

/** Normalize `did:key:…` for stable account ids. */
export function normalizeDid(did: string): string {
	const trimmed = did.trim()
	if (!trimmed.toLowerCase().startsWith('did:key:')) {
		throw new Error('invalid_did: expected did:key prefix')
	}
	return trimmed
}

/** Decode AvenOS Ed25519 `did:key` (multicodec 0xed 0x01 + 32-byte pubkey). */
export function ed25519PublicKeyFromDid(did: string): Uint8Array {
	const normalized = normalizeDid(did)
	const multibase = normalized.slice('did:key:'.length)
	// Standard did:key is multibase base58btc — a leading 'z' marks the encoding.
	const base58 = multibase.startsWith('z') ? multibase.slice(1) : multibase
	const decoded = bs58.decode(base58)
	if (decoded.length !== ED25519_MULTICODEC_PREFIX.length + 32) {
		throw new Error('invalid_did: unexpected length')
	}
	for (let i = 0; i < ED25519_MULTICODEC_PREFIX.length; i++) {
		if (decoded[i] !== ED25519_MULTICODEC_PREFIX[i]) {
			throw new Error('invalid_did: expected Ed25519 multicodec')
		}
	}
	return decoded.slice(ED25519_MULTICODEC_PREFIX.length)
}

export function accountIdForDid(did: string): string {
	return normalizeDid(did)
}

export function providerIdForDid(did: string): { providerId: 'self'; accountId: string } {
	const accountId = accountIdForDid(did)
	return { providerId: 'self', accountId }
}
