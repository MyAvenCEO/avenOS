// Vault unlock SSOT (board 0055): produce the 32-byte passkey PRF that crypto.ts HKDFs into the
// vault KEK. The PRF comes from a WebAuthn assertion on the passkey registered via the Better
// Auth passkey plugin (the SAME passkey that is the avenFOUNDER→avenCEO 2nd factor), run inside
// the native Tauri webview and validated against the associated-domains entitlement. A DEV-flag
// deterministic fallback lets the whole vault iterate locally in an unsigned build (real
// passkeys need a signed build). Everything else (crypto, store, UI) is unlock-agnostic.

import { unb64 } from './crypto'

export type UnlockResult = { prf: Uint8Array<ArrayBuffer>; provider: 'passkey' | 'dev' }

/** PRF from a WebAuthn assertion on the registered passkey, using the PINNED vault salt. */
async function passkeyPrf(opts: {
	rpId: string
	salt: Uint8Array<ArrayBuffer>
	credentialId?: string
}): Promise<Uint8Array<ArrayBuffer> | null> {
	if (typeof navigator === 'undefined' || !navigator.credentials?.get) return null
	const allowCredentials = opts.credentialId
		? [{ id: unb64(opts.credentialId), type: 'public-key' as const }]
		: undefined
	const assertion = (await navigator.credentials.get({
		publicKey: {
			challenge: crypto.getRandomValues(new Uint8Array(32)),
			rpId: opts.rpId,
			allowCredentials,
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

/** Deterministic DEV-only key (INSECURE; never ships) so the vault iterates in unsigned dev. */
async function devPrf(salt: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
	const base = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode('aven-vault-DEV-INSECURE'),
		'HKDF',
		false,
		['deriveBits']
	)
	const bits = await crypto.subtle.deriveBits(
		{ name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode('aven-vault-dev') },
		base,
		256
	)
	return new Uint8Array(bits)
}

/** Single source of truth for the vault key material: passkey PRF, with a DEV fallback. */
export async function deriveVaultKey(opts: {
	rpId: string
	salt: Uint8Array<ArrayBuffer>
	credentialId?: string
}): Promise<UnlockResult> {
	try {
		const prf = await passkeyPrf(opts)
		if (prf) return { prf, provider: 'passkey' }
		if (!import.meta.env.DEV) throw new Error('passkey returned no PRF (is the build signed?)')
	} catch (e) {
		if (!import.meta.env.DEV) throw e
		console.warn('[vault] passkey unlock failed; using DEV fallback:', e)
	}
	return { prf: await devPrf(opts.salt), provider: 'dev' }
}
