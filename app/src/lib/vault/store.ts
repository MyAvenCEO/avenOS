// Vault store glue (board 0055): ties crypto + the unlock SSOT + the vault API into the two
// operations the UI needs — connect (encrypt + store a secret) and load (fetch + decrypt). On a
// signed build the key comes from the passkey PRF; in unsigned local dev `deriveVaultKey` falls
// back to the DEV key, so the whole roundtrip works without a signed build.

import { getVault, listSecrets, putSecret, putVault, type VaultRow } from './client'
import {
	b64,
	deriveKek,
	generateMasterKey,
	newSalt,
	openSecret,
	sealSecret,
	unb64,
	unwrapMasterKey,
	wrapMasterKey
} from './crypto'
import { DEVICE_CRED, deriveVaultKey } from './unlock'

const RP_ID = 'api.next.aven.ceo' // the passkey rp.id (live AASA host)
const FLY_KIND = 'fly_token'

/** Re-derive the vault's master DEK from its pinned salt (passkey PRF, or device key). */
async function openVaultDek(vault: VaultRow): Promise<CryptoKey> {
	const salt = unb64(vault.prf_salt)
	// credential_id tells deriveVaultKey which provider made this vault ('device' vs a passkey).
	const { prf } = await deriveVaultKey({ rpId: RP_ID, salt, credentialId: vault.credential_id })
	const kek = await deriveKek(prf, salt)
	return unwrapMasterKey(
		{ wrappedMasterKey: vault.wrapped_master_key, wrapNonce: vault.wrap_nonce, alg: 'AES-256-GCM' },
		kek
	)
}

/** Encrypt + store the Fly token. Creates the vault (new master DEK + pinned salt) on first use. */
export async function connectFlyToken(token: string): Promise<void> {
	let vault = await getVault()
	if (!vault) {
		const salt = newSalt()
		const { prf, provider } = await deriveVaultKey({ rpId: RP_ID, salt })
		const kek = await deriveKek(prf, salt)
		const dek = await generateMasterKey()
		const wrapped = await wrapMasterKey(dek, kek)
		await putVault({
			credentialId: provider === 'passkey' ? '(passkey)' : DEVICE_CRED,
			prfSalt: b64(salt),
			wrappedMasterKey: wrapped.wrappedMasterKey,
			wrapNonce: wrapped.wrapNonce,
			alg: wrapped.alg
		})
		vault = await getVault()
		if (!vault) throw new Error('vault create failed')
	}
	const dek = await openVaultDek(vault)
	const sealed = await sealSecret(token, dek)
	await putSecret({
		kind: FLY_KIND,
		ciphertext: sealed.ciphertext,
		nonce: sealed.nonce,
		alg: sealed.alg
	})
}

/** Fetch + decrypt the stored Fly token, or null if the vault/secret isn't set up yet. */
export async function loadFlyToken(): Promise<string | null> {
	const vault = await getVault()
	if (!vault) return null
	const secret = (await listSecrets()).find((s) => s.kind === FLY_KIND)
	if (!secret) return null
	const dek = await openVaultDek(vault)
	return openSecret({ ciphertext: secret.ciphertext, nonce: secret.nonce, alg: 'AES-256-GCM' }, dek)
}
