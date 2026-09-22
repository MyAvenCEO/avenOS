import { decodeProtectedHeader, FlattenedEncrypt, flattenedDecrypt } from 'jose'
import { z } from 'zod'

const MAX_SECRET_BYTES = 32 * 1024
const TYPE = 'aven-credential+jwe'
const FORMAT = 'jwe-rsa-oaep-256-a256gcm-v1'
const keyIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/)
const uuid = z.uuid().transform((value) => value.toLowerCase())
const contextSchema = z
	.object({
		environmentId: uuid,
		ownerSubjectId: uuid,
		credentialRef: uuid,
		kind: z.enum(['token', 'password']),
		secretVersion: z.number().int().min(1).max(2147483647)
	})
	.strict()
export type SecretContext = z.input<typeof contextSchema>
const base64url = (maximum: number) =>
	z
		.string()
		.min(1)
		.max(maximum)
		.regex(/^[A-Za-z0-9_-]+$/)
const envelopeSchema = z
	.object({
		format: z.literal(FORMAT),
		jwe: z
			.object({
				protected: base64url(1024),
				encrypted_key: base64url(1366),
				iv: base64url(16).length(16),
				ciphertext: base64url(Math.ceil((MAX_SECRET_BYTES * 4) / 3)),
				tag: base64url(22).length(22),
				aad: base64url(1024)
			})
			.strict()
	})
	.strict()
export type SecretEnvelope = z.infer<typeof envelopeSchema>
const headerSchema = z
	.object({
		alg: z.literal('RSA-OAEP-256'),
		enc: z.literal('A256GCM'),
		typ: z.literal(TYPE),
		kid: keyIdSchema
	})
	.strict()

/** No underlying crypto/schema exception is attached: it can contain input material. */
export class CredentialStorageError extends Error {
	constructor(
		readonly code:
			| 'CREDENTIAL_KEY_INVALID'
			| 'CREDENTIAL_KEY_UNAVAILABLE'
			| 'CREDENTIAL_CONTEXT_INVALID'
			| 'CREDENTIAL_VALUE_INVALID'
			| 'CREDENTIAL_ENVELOPE_INVALID'
			| 'CREDENTIAL_SEAL_FAILED'
	) {
		super(code)
	}
}

function contextBytes(input: SecretContext): Uint8Array {
	const parsed = contextSchema.safeParse(input)
	if (!parsed.success) throw new CredentialStorageError('CREDENTIAL_CONTEXT_INVALID')
	const value = parsed.data
	// Versioned fixed ordering, no object-key ordering or caller-supplied scope field.
	return new TextEncoder().encode(
		JSON.stringify([
			FORMAT,
			value.environmentId,
			value.ownerSubjectId,
			value.credentialRef,
			value.kind,
			value.secretVersion
		])
	)
}

function checkKey(key: CryptoKey, type: 'public' | 'private'): void {
	const algorithm = key?.algorithm as RsaHashedKeyAlgorithm | undefined
	if (
		key?.type !== type ||
		algorithm?.name !== 'RSA-OAEP' ||
		algorithm.hash?.name !== 'SHA-256' ||
		algorithm.modulusLength < 3072 ||
		algorithm.modulusLength > 8192 ||
		!key.usages.includes(type === 'public' ? 'encrypt' : 'decrypt') ||
		(type === 'private' && key.extractable)
	)
		throw new CredentialStorageError('CREDENTIAL_KEY_INVALID')
}

/** The ingress receives only a public key. This interface has no read operation. */
export function createCredentialSealer(keyId: string, publicKey: CryptoKey) {
	if (!keyIdSchema.safeParse(keyId).success)
		throw new CredentialStorageError('CREDENTIAL_KEY_INVALID')
	checkKey(publicKey, 'public')
	return {
		async seal(secret: Uint8Array, context: SecretContext): Promise<SecretEnvelope> {
			if (
				!(secret instanceof Uint8Array) ||
				secret.byteLength < 1 ||
				secret.byteLength > MAX_SECRET_BYTES
			)
				throw new CredentialStorageError('CREDENTIAL_VALUE_INVALID')
			const aad = contextBytes(context)
			const bytes = new Uint8Array(secret)
			try {
				const jwe = await new FlattenedEncrypt(bytes)
					.setProtectedHeader({ alg: 'RSA-OAEP-256', enc: 'A256GCM', typ: TYPE, kid: keyId })
					.setAdditionalAuthenticatedData(aad)
					.encrypt(publicKey)
				return envelopeSchema.parse({ format: FORMAT, jwe })
			} catch {
				throw new CredentialStorageError('CREDENTIAL_SEAL_FAILED')
			} finally {
				bytes.fill(0)
			}
		}
	}
}

/** Protected-executor primitive, NOT authorization. Never expose it as an Actor,
 * public route or general secret-resolution API. Admission and durable use claims
 * must precede it. The expected context comes from current authorized database state. */
export function createCredentialUnsealer(configuredKeys: ReadonlyMap<string, CryptoKey>) {
	const keys = new Map(configuredKeys)
	if (keys.size < 1 || keys.size > 8) throw new CredentialStorageError('CREDENTIAL_KEY_INVALID')
	for (const [id, key] of keys) {
		if (!keyIdSchema.safeParse(id).success)
			throw new CredentialStorageError('CREDENTIAL_KEY_INVALID')
		checkKey(key, 'private')
	}
	return {
		async unseal(input: unknown, context: SecretContext): Promise<Uint8Array> {
			const expectedAad = Buffer.from(contextBytes(context)).toString('base64url')
			let plaintext: Uint8Array | undefined
			try {
				const envelope = envelopeSchema.parse(input)
				if (envelope.jwe.aad !== expectedAad) throw Error('context')
				const header = headerSchema.parse(decodeProtectedHeader(envelope.jwe))
				const key = keys.get(header.kid)
				if (!key) throw new CredentialStorageError('CREDENTIAL_KEY_UNAVAILABLE')
				const result = await flattenedDecrypt(envelope.jwe, key, {
					keyManagementAlgorithms: ['RSA-OAEP-256'],
					contentEncryptionAlgorithms: ['A256GCM']
				})
				plaintext = result.plaintext
				if (plaintext.byteLength < 1 || plaintext.byteLength > MAX_SECRET_BYTES)
					throw Error('length')
				return plaintext
			} catch (error) {
				plaintext?.fill(0)
				if (error instanceof CredentialStorageError) throw error
				throw new CredentialStorageError('CREDENTIAL_ENVELOPE_INVALID')
			}
		}
	}
}
