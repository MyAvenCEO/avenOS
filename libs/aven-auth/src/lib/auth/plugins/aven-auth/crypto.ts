import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

export function hashInviteToken(token: string): string {
	return bytesToHex(sha256(new TextEncoder().encode(token)))
}

export function decodeSignature(input: string): Uint8Array {
	const trimmed = input.trim()
	if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length === 128) {
		return Uint8Array.from(trimmed.match(/.{2}/g)!.map((b) => Number.parseInt(b, 16)))
	}
	const b64 = trimmed.replace(/-/g, '+').replace(/_/g, '/')
	const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
	const binary = atob(padded)
	return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

export function syntheticEmailForDid(did: string, domain: string): string {
	const hash = bytesToHex(sha256(new TextEncoder().encode(did))).slice(0, 12)
	return `device+${hash}@${domain}`
}
