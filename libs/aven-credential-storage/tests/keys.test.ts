import { randomUUID } from 'node:crypto'
import {
	chmod,
	copyFile,
	link,
	mkdtemp,
	readFile,
	rm,
	symlink,
	unlink,
	writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exportPKCS8, exportSPKI, generateKeyPair } from 'jose'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { loadConnectionPolicyKey, loadCredentialSealer, loadCredentialUnsealer } from '../src/keys'

let directory: string, publicPath: string, privatePath: string
let publicRecord: object, privateRecord: object
beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), 'aven-synthetic-key-files-'))
	publicPath = join(directory, 'public.json')
	privatePath = join(directory, 'private.json')
	// Only this offline test provisioning step creates extractable key material.
	const pair = await generateKeyPair('RSA-OAEP-256', { modulusLength: 3072, extractable: true })
	publicRecord = {
		format: 'aven-credential-sealing-key-v1',
		keyId: 'synthetic-one',
		publicKey: await exportSPKI(pair.publicKey)
	}
	privateRecord = {
		format: 'aven-credential-unsealing-keys-v1',
		keys: [{ keyId: 'synthetic-one', privateKey: await exportPKCS8(pair.privateKey) }]
	}
	await writeFile(publicPath, JSON.stringify(publicRecord), { mode: 0o644 })
	await writeFile(privatePath, JSON.stringify(privateRecord), { mode: 0o600 })
}, 30000)
afterAll(async () => {
	if (directory) await rm(directory, { recursive: true, force: true })
})

test('policy signing keys are separate, non-extractable and fail closed on wrong material', async () => {
	const pair = await generateKeyPair('EdDSA', { extractable: true })
	const path = join(directory, 'policy.json')
	await writeFile(
		path,
		JSON.stringify({
			format: 'aven-connection-policy-key-v1',
			privateKey: await exportPKCS8(pair.privateKey)
		}),
		{ mode: 0o600 }
	)
	const loaded = await loadConnectionPolicyKey(path)
	expect(loaded.privateKey.extractable).toBe(false)
	expect(loaded.publicKey.extractable).toBe(false)
	const message = new TextEncoder().encode('synthetic reviewed request')
	const signature = await crypto.subtle.sign('Ed25519', loaded.privateKey, message)
	expect(await crypto.subtle.verify('Ed25519', loaded.publicKey, signature, message)).toBe(true)
	await expect(loadCredentialUnsealer(path)).rejects.toThrow('CREDENTIAL_KEY_FILE_UNAVAILABLE')
	await expect(loadConnectionPolicyKey(privatePath)).rejects.toThrow(
		'CREDENTIAL_KEY_FILE_UNAVAILABLE'
	)
	await chmod(path, 0o644)
	await expect(loadConnectionPolicyKey(path)).rejects.toThrow('CREDENTIAL_KEY_FILE_UNAVAILABLE')
})

test('separate public/private files survive explicit loss and escrow restoration', async () => {
	const context = {
		environmentId: randomUUID(),
		ownerSubjectId: randomUUID(),
		credentialRef: randomUUID(),
		kind: 'token' as const,
		secretVersion: 1
	}
	const bytes = new TextEncoder().encode(`independently-invented-token-${randomUUID()}`)
	const sealer = await loadCredentialSealer(publicPath)
	expect(Object.keys(sealer)).toEqual(['seal'])
	const ciphertext = await sealer.seal(bytes, context)
	const backup = join(directory, 'escrow.json')
	await copyFile(privatePath, backup)
	await chmod(backup, 0o600)
	const restoredPath = join(directory, 'restored.json')
	await expect(loadCredentialUnsealer(restoredPath)).rejects.toThrow(
		'CREDENTIAL_KEY_FILE_UNAVAILABLE'
	)
	await copyFile(backup, restoredPath)
	await chmod(restoredPath, 0o600)
	const unsealer = await loadCredentialUnsealer(restoredPath)
	expect(Object.keys(unsealer)).toEqual(['unseal'])
	expect(await unsealer.unseal(JSON.parse(JSON.stringify(ciphertext)), context)).toEqual(bytes)
	await unlink(restoredPath)
	// Startup keys are immutable snapshots, not silently reread during use.
	expect(await unsealer.unseal(ciphertext, context)).toEqual(bytes)
	await expect(loadCredentialUnsealer(restoredPath)).rejects.toThrow(
		'CREDENTIAL_KEY_FILE_UNAVAILABLE'
	)
	await expect(loadCredentialSealer(privatePath)).rejects.toThrow('CREDENTIAL_KEY_FILE_UNAVAILABLE')
	await expect(loadCredentialUnsealer(publicPath)).rejects.toThrow(
		'CREDENTIAL_KEY_FILE_UNAVAILABLE'
	)
})

test('unsafe private permissions, links, unknown fields and malformed material fail without details', async () => {
	const path = join(directory, 'bad.json')
	for (const value of [
		JSON.stringify({ ...privateRecord, remote: 'https://example.test/keys' }),
		JSON.stringify({
			...privateRecord,
			keys: [...(privateRecord as any).keys, ...(privateRecord as any).keys]
		}),
		JSON.stringify({
			format: 'aven-credential-unsealing-keys-v1',
			keys: [{ keyId: 'bad', privateKey: 'not-a-key'.repeat(20) }]
		}),
		JSON.stringify(publicRecord),
		'{',
		'x'.repeat(150001)
	]) {
		await writeFile(path, value, { mode: 0o600 })
		try {
			await loadCredentialUnsealer(path)
			throw Error('unexpected success')
		} catch (error) {
			expect(String(error)).toBe('Error: CREDENTIAL_KEY_FILE_UNAVAILABLE')
			expect((error as Error).cause).toBeUndefined()
			expect(JSON.stringify(error)).not.toContain(directory)
		}
	}
	await writeFile(path, JSON.stringify(privateRecord))
	await chmod(path, 0o644)
	await expect(loadCredentialUnsealer(path)).rejects.toThrow('CREDENTIAL_KEY_FILE_UNAVAILABLE')
	await chmod(path, 0o600)
	const hard = join(directory, 'hard.json'),
		soft = join(directory, 'soft.json')
	await link(path, hard)
	await symlink(privatePath, soft)
	await expect(loadCredentialUnsealer(hard)).rejects.toThrow('CREDENTIAL_KEY_FILE_UNAVAILABLE')
	await expect(loadCredentialUnsealer(soft)).rejects.toThrow('CREDENTIAL_KEY_FILE_UNAVAILABLE')
	await expect(loadCredentialSealer('relative.json')).rejects.toThrow(
		'CREDENTIAL_KEY_FILE_UNAVAILABLE'
	)
	expect(await readFile(publicPath, 'utf8')).not.toContain('PRIVATE KEY')
})
