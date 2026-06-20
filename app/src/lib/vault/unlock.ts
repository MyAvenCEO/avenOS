// Vault unlock SSOT (board 0055): produce the 32-byte key material that crypto.ts HKDFs into the
// vault KEK. Two providers, picked by what's available / what the vault was created with:
//  - passkey  — WebAuthn PRF on the Better-Auth-registered passkey (strongest; signed build).
//  - device   — a random per-device seed in a plain file on disk (non-Apple, like a .env). Genuinely
//               server-blind (key never leaves the machine, not in source/Neon), but weaker than the
//               passkey: no biometric, device-bound, readable by anything running as you.
// Everything else (crypto, store, UI) is unlock-agnostic.

import { invoke } from '@tauri-apps/api/core'
import { b64, unb64 } from './crypto'

export const DEVICE_CRED = 'device' // vault.credential_id marker for a device-key vault
const PASSKEY_CRED = '(passkey)' // placeholder until the signed-build passkey credentialID is wired

export type UnlockResult = { prf: Uint8Array<ArrayBuffer>; provider: 'passkey' | 'device' }

/** PRF from a WebAuthn assertion on the registered passkey, using the PINNED vault salt. */
async function passkeyPrf(opts: {
	rpId: string
	salt: Uint8Array<ArrayBuffer>
	credentialId?: string
}): Promise<Uint8Array<ArrayBuffer> | null> {
	if (typeof navigator === 'undefined' || !navigator.credentials?.get) return null
	// Only pin a specific credential when we have a real id (not a marker); otherwise let the
	// platform pick the resident passkey for this rp.id.
	const realId =
		opts.credentialId && opts.credentialId !== DEVICE_CRED && opts.credentialId !== PASSKEY_CRED
			? opts.credentialId
			: undefined
	const assertion = (await navigator.credentials.get({
		publicKey: {
			challenge: crypto.getRandomValues(new Uint8Array(32)),
			rpId: opts.rpId,
			allowCredentials: realId ? [{ id: unb64(realId), type: 'public-key' as const }] : undefined,
			userVerification: 'required',
			extensions: { prf: { eval: { first: opts.salt } } } as AuthenticationExtensionsClientInputs
		}
	})) as PublicKeyCredential | null
	const ext = assertion?.getClientExtensionResults() as
		| (AuthenticationExtensionsClientOutputs & { prf?: { results?: { first?: ArrayBuffer } } })
		| undefined
	const first = ext?.prf?.results?.first
	return first ? new Uint8Array(first) : null
}

/** The device seed (base64) from the on-disk plain file, creating it on first use. */
async function deviceSeed(): Promise<Uint8Array<ArrayBuffer>> {
	let seed = await invoke<string | null>('device_seed_load')
	if (!seed) {
		seed = b64(crypto.getRandomValues(new Uint8Array(32)))
		await invoke('device_seed_save', { seed })
	}
	return unb64(seed)
}

/** Device-key provider: HKDF(device seed, pinned salt) — the device equivalent of the passkey PRF. */
async function devicePrf(salt: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
	const base = await crypto.subtle.importKey('raw', await deviceSeed(), 'HKDF', false, [
		'deriveBits'
	])
	const bits = await crypto.subtle.deriveBits(
		{ name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode('aven-vault-device') },
		base,
		256
	)
	return new Uint8Array(bits)
}

/** Single source of truth for the vault key material: passkey PRF when usable, else device key. */
export async function deriveVaultKey(opts: {
	rpId: string
	salt: Uint8Array<ArrayBuffer>
	credentialId?: string
}): Promise<UnlockResult> {
	// A device-keyed vault must NOT attempt the passkey (its salt is for the device seed).
	if (opts.credentialId !== DEVICE_CRED) {
		try {
			const prf = await passkeyPrf(opts)
			if (prf) return { prf, provider: 'passkey' }
		} catch (e) {
			console.warn('[vault] passkey unavailable; using the device key:', e)
		}
	}
	return { prf: await devicePrf(opts.salt), provider: 'device' }
}
