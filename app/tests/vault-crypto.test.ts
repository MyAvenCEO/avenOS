import { describe, expect, test } from 'bun:test'
import {
	b64,
	deriveKek,
	generateMasterKey,
	newSalt,
	openSecret,
	sealSecret,
	unwrapMasterKey,
	wrapMasterKey
} from '../src/lib/vault/crypto'

// The PRF would come from the passkey (unlock.ts); here we mock it with fixed bytes so the
// test is deterministic and isolated from WebAuthn/signing. board 0055.
const PRF = new Uint8Array(32).fill(7)
const TOKEN = 'fo1_SUPERSECRET_FLY_TOKEN_abc123'

describe('vault crypto (board 0055)', () => {
	test('PRF determinism: re-derive the SAME key from the pinned salt → decrypts', async () => {
		const salt = newSalt() // pinned on the vault row

		// create-time: KEK #1 from (PRF, salt); wrap a fresh master DEK; seal the token.
		const kek1 = await deriveKek(PRF, salt)
		const dek = await generateMasterKey()
		const wrapped = await wrapMasterKey(dek, kek1)
		const sealed = await sealSecret(TOKEN, dek)

		// unlock-time: KEK #2 re-derived from the SAME (PRF, pinned salt) → unwrap → open.
		const kek2 = await deriveKek(PRF, salt)
		const dek2 = await unwrapMasterKey(wrapped, kek2)
		expect(await openSecret(sealed, dek2)).toBe(TOKEN)
	})

	test('server-blind: serialized vault+secrets rows hold no plaintext token / no master key', async () => {
		const salt = newSalt()
		const kek = await deriveKek(PRF, salt)
		const dek = await generateMasterKey()
		const wrapped = await wrapMasterKey(dek, kek)
		const sealed = await sealSecret(TOKEN, dek)

		// exactly what the server persists
		const vaultRow = JSON.stringify({ prf_salt: b64(salt), ...wrapped })
		const secretRow = JSON.stringify(sealed)
		const stored = vaultRow + secretRow

		expect(stored).not.toContain(TOKEN) // no plaintext token
		const rawDek = b64(new Uint8Array(await crypto.subtle.exportKey('raw', dek)))
		expect(stored).not.toContain(rawDek) // no plaintext master key
		expect(stored).not.toContain(b64(PRF)) // no PRF
	})

	test('a wrong PRF cannot unwrap the master key', async () => {
		const salt = newSalt()
		const dek = await generateMasterKey()
		const wrapped = await wrapMasterKey(dek, await deriveKek(PRF, salt))
		const wrongKek = await deriveKek(new Uint8Array(32).fill(9), salt)
		await expect(unwrapMasterKey(wrapped, wrongKek)).rejects.toThrow()
	})
})
