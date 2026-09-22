/** Operator-mounted keys for separate set-only ingress and protected executors.
 * Never import this module into an Actor, browser or ordinary runner factory. */
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { exportJWK, importJWK, importPKCS8, importSPKI } from 'jose'
import { z } from 'zod'
import { createCredentialSealer, createCredentialUnsealer } from './envelope'

const keyId = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/)
const pem = z.string().min(64).max(16384)
const sealingKey = z
	.object({
		format: z.literal('aven-credential-sealing-key-v1'),
		keyId,
		publicKey: pem
	})
	.strict()
const unsealingKeys = z
	.object({
		format: z.literal('aven-credential-unsealing-keys-v1'),
		keys: z
			.array(z.object({ keyId, privateKey: pem }).strict())
			.min(1)
			.max(8)
	})
	.strict()

/** Error text must not carry paths, PEM, schema values or nested import errors. */
export class CredentialKeyFileError extends Error {
	constructor() {
		super('CREDENTIAL_KEY_FILE_UNAVAILABLE')
	}
}

async function readKeyFile(path: string, privateMaterial: boolean): Promise<unknown> {
	let file: Awaited<ReturnType<typeof open>> | undefined
	let bytes: Buffer | undefined
	try {
		if (!isAbsolute(path)) throw Error('absolute operator path required')
		if (typeof constants.O_NOFOLLOW !== 'number') throw Error('unsupported key-file platform')
		file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
		const stat = await file.stat()
		if (!stat.isFile() || stat.size < 1 || stat.size > 150_000 || stat.nlink !== 1)
			throw Error('invalid file')
		// A public key can be public, but neither file may be writable by other users.
		if ((stat.mode & (privateMaterial ? 0o077 : 0o022)) !== 0) throw Error('permissions')
		if (stat.uid !== 0 && stat.uid !== process.getuid?.()) throw Error('owner')
		bytes = Buffer.alloc(150_001)
		let length = 0
		for (;;) {
			const part = await file.read(bytes, length, bytes.length - length)
			length += part.bytesRead
			if (length > 150_000) throw Error('size')
			if (part.bytesRead === 0) break
		}
		return JSON.parse(bytes.subarray(0, length).toString('utf8'))
	} catch {
		throw new CredentialKeyFileError()
	} finally {
		bytes?.fill(0)
		await file?.close().catch(() => {})
	}
}

/** Public-key-only file; no private key or unseal method crosses into ingress. */
export async function loadCredentialSealer(path: string) {
	try {
		const config = sealingKey.parse(await readKeyFile(path, false))
		const key = await importSPKI(config.publicKey, 'RSA-OAEP-256', { extractable: false })
		return createCredentialSealer(config.keyId, key)
	} catch {
		throw new CredentialKeyFileError()
	}
}

/** Entire ring is snapshotted at startup. Missing/invalid keys never create new
 * keys, try another key, consult the network or fall back to plaintext storage. */
export async function loadCredentialUnsealer(path: string) {
	try {
		const config = unsealingKeys.parse(await readKeyFile(path, true))
		const keys = new Map<string, CryptoKey>()
		for (const entry of config.keys) {
			if (keys.has(entry.keyId)) throw Error('duplicate key identifier')
			keys.set(
				entry.keyId,
				await importPKCS8(entry.privateKey, 'RSA-OAEP-256', { extractable: false })
			)
		}
		return createCredentialUnsealer(keys)
	} catch {
		throw new CredentialKeyFileError()
	}
}

/** Policy signing authority is independent of credential wrapping and tenant
 * grants. This key belongs only in the API; executors receive its public half. */
export async function loadConnectionPolicyKey(path: string) {
	try {
		const value = z
			.object({
				format: z.literal('aven-connection-policy-key-v1'),
				privateKey: pem
			})
			.strict()
			.parse(await readKeyFile(path, true))
		const imported = await importPKCS8(value.privateKey, 'EdDSA', { extractable: true })
		const { d: _private, ...publicJwk } = await exportJWK(imported)
		const publicKey = await importJWK(publicJwk, 'EdDSA', { extractable: false })
		const privateKey = await importPKCS8(value.privateKey, 'EdDSA', { extractable: false })
		if (publicKey instanceof Uint8Array) throw Error('invalid signing key')
		return { privateKey, publicKey }
	} catch {
		throw new CredentialKeyFileError()
	}
}
