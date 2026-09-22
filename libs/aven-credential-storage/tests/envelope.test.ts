import { randomUUID } from 'node:crypto'
import { generateKeyPair } from 'jose'
import { beforeAll, describe, expect, test } from 'vitest'
import {
	createCredentialSealer,
	createCredentialUnsealer,
	type SecretContext
} from '../src/envelope'

let first: Awaited<ReturnType<typeof generateKeyPair>>
let second: Awaited<ReturnType<typeof generateKeyPair>>
const context: SecretContext = {
	environmentId: randomUUID(),
	ownerSubjectId: randomUUID(),
	credentialRef: randomUUID(),
	kind: 'token',
	secretVersion: 1
}
const value = new TextEncoder().encode(`fictional-${randomUUID()}-钥匙-🔑`)
beforeAll(async () => {
	first = await generateKeyPair('RSA-OAEP-256', { modulusLength: 3072, extractable: false })
	second = await generateKeyPair('RSA-OAEP-256', { modulusLength: 3072, extractable: false })
}, 30_000)
const seal = () => createCredentialSealer('first', first.publicKey).seal(value, context)
const open = (envelope: unknown, expected = context) =>
	createCredentialUnsealer(new Map([['first', first.privateKey]])).unseal(envelope, expected)
const mutate = (text: string) => (text[0] === 'A' ? 'B' : 'A') + text.slice(1)

test('public-only ingress seals; protected nonextractable key restores exact bytes after JSON storage', async () => {
	const sealer = createCredentialSealer('first', first.publicKey)
	expect(Object.keys(sealer)).toEqual(['seal'])
	const original = value.slice()
	const envelope = await sealer.seal(value, context)
	expect(value).toEqual(original)
	expect(JSON.stringify(envelope)).not.toContain(new TextDecoder().decode(value))
	expect(await open(JSON.parse(JSON.stringify(envelope)))).toEqual(value)
	await expect(crypto.subtle.exportKey('pkcs8', first.privateKey)).rejects.toThrow()
	expect(() => createCredentialUnsealer(new Map([['first', first.publicKey]]))).toThrow(
		'CREDENTIAL_KEY_INVALID'
	)
})

test('identical values and contexts receive independent content keys and nonces', async () => {
	const a = await seal(),
		b = await seal()
	expect(a.jwe.encrypted_key).not.toBe(b.jwe.encrypted_key)
	expect(a.jwe.iv).not.toBe(b.jwe.iv)
	expect(a.jwe.ciphertext).not.toBe(b.jwe.ciphertext)
	expect(await open(a)).toEqual(await open(b))
})

test.each([
	['environmentId', randomUUID()],
	['ownerSubjectId', randomUUID()],
	['credentialRef', randomUUID()],
	['kind', 'password'],
	['secretVersion', 2]
] as const)('a copied envelope cannot change authenticated %s', async (field, changed) => {
	const envelope = await seal()
	await expect(open(envelope, { ...context, [field]: changed })).rejects.toThrow(
		'CREDENTIAL_ENVELOPE_INVALID'
	)
	// Editing the public AAD to match the target still invalidates its authentication tag.
	const target = await createCredentialSealer('first', first.publicKey).seal(value, {
		...context,
		[field]: changed
	})
	envelope.jwe.aad = target.jwe.aad
	await expect(open(envelope, { ...context, [field]: changed })).rejects.toThrow(
		'CREDENTIAL_ENVELOPE_INVALID'
	)
})

test.each(['ciphertext', 'encrypted_key', 'iv', 'tag', 'protected', 'aad'] as const)(
	'altering %s fails without leaking plaintext or crypto internals',
	async (field) => {
		const envelope = await seal()
		envelope.jwe[field] = mutate(envelope.jwe[field])
		try {
			await open(envelope)
			throw Error('Unexpected successful release')
		} catch (error) {
			expect(String(error)).toBe('Error: CREDENTIAL_ENVELOPE_INVALID')
			expect((error as Error).cause).toBeUndefined()
			expect(JSON.stringify(error)).not.toContain(new TextDecoder().decode(value))
		}
	}
)

test('another private key under the same identifier cannot decrypt', async () => {
	await expect(
		createCredentialUnsealer(new Map([['first', second.privateKey]])).unseal(await seal(), context)
	).rejects.toThrow('CREDENTIAL_ENVELOPE_INVALID')
})

describe('closed envelope and algorithm profile', () => {
	test.each([
		{ alg: 'RSA1_5' },
		{ enc: 'A128GCM' },
		{ typ: 'JWT' },
		{ kid: 'unknown' },
		{ jku: 'https://keys.example.test/key' },
		{ zip: 'DEF' },
		{ crit: ['external'] }
	])('refuses header substitution %j', async (change) => {
		const envelope = await seal()
		const header = JSON.parse(Buffer.from(envelope.jwe.protected, 'base64url').toString())
		envelope.jwe.protected = Buffer.from(JSON.stringify({ ...header, ...change })).toString(
			'base64url'
		)
		await expect(open(envelope)).rejects.toThrow(
			'kid' in change ? 'CREDENTIAL_KEY_UNAVAILABLE' : 'CREDENTIAL_ENVELOPE_INVALID'
		)
	})
	test.each(['unprotected', 'header', 'recipients', 'remoteKey'])(
		'refuses extra JWE field %s',
		async (field) => {
			const envelope = await seal()
			await expect(open({ ...envelope, jwe: { ...envelope.jwe, [field]: {} } })).rejects.toThrow(
				'CREDENTIAL_ENVELOPE_INVALID'
			)
		}
	)
	test('refuses unknown formats, missing fields and oversized encoded material', async () => {
		const envelope = await seal()
		for (const invalid of [
			null,
			{},
			{ ...envelope, format: 'plaintext' },
			{ ...envelope, secret: 'forbidden' },
			{ ...envelope, jwe: { ...envelope.jwe, ciphertext: 'A'.repeat(50_000) } }
		])
			await expect(open(invalid)).rejects.toThrow('CREDENTIAL_ENVELOPE_INVALID')
	})
})

test('key rotation keeps old decrypt-only keys until explicitly removed; no fallback key is tried', async () => {
	const old = await seal()
	const ring = new Map([
		['first', first.privateKey],
		['second', second.privateKey]
	])
	const unsealer = createCredentialUnsealer(ring)
	ring.clear() // Host configuration is snapshotted, not mutated by an outstanding caller.
	const restored = await unsealer.unseal(old, context)
	const rewrapped = await createCredentialSealer('second', second.publicKey).seal(restored, context)
	restored.fill(0)
	const onlyNew = createCredentialUnsealer(new Map([['second', second.privateKey]]))
	expect(await onlyNew.unseal(rewrapped, context)).toEqual(value)
	await expect(onlyNew.unseal(old, context)).rejects.toThrow('CREDENTIAL_KEY_UNAVAILABLE')
	await expect(open(rewrapped)).rejects.toThrow('CREDENTIAL_KEY_UNAVAILABLE')
})

test('bounds bytes, not code points, and rejects invalid context without returning schema values', async () => {
	const sealer = createCredentialSealer('first', first.publicKey)
	for (const secret of [new Uint8Array(), new Uint8Array(32769)])
		await expect(sealer.seal(secret, context)).rejects.toThrow('CREDENTIAL_VALUE_INVALID')
	const maximum = new Uint8Array(32768).fill(7)
	expect(await open(await sealer.seal(maximum, context))).toEqual(maximum)
	for (const expected of [
		{ ...context, secretVersion: 0 },
		{ ...context, kind: 'unknown' },
		{ ...context, environmentId: 'invalid' },
		{ ...context, unrelated: 'not-admitted' }
	])
		await expect(sealer.seal(value, expected as SecretContext)).rejects.toThrow(
			'CREDENTIAL_CONTEXT_INVALID'
		)
})

test('weak, exportable-private and wrong-algorithm configuration fails before use', async () => {
	const weak = await generateKeyPair('RSA-OAEP-256', { modulusLength: 2048 })
	const exportable = await generateKeyPair('RSA-OAEP-256', {
		modulusLength: 3072,
		extractable: true
	})
	const signing = await generateKeyPair('RS256', { modulusLength: 3072 })
	for (const key of [weak.publicKey, signing.publicKey, first.privateKey])
		expect(() => createCredentialSealer('key', key)).toThrow('CREDENTIAL_KEY_INVALID')
	expect(() => createCredentialSealer('https://remote.example.test/key', first.publicKey)).toThrow(
		'CREDENTIAL_KEY_INVALID'
	)
	expect(() => createCredentialUnsealer(new Map())).toThrow('CREDENTIAL_KEY_INVALID')
	expect(() => createCredentialUnsealer(new Map([['key', exportable.privateKey]]))).toThrow(
		'CREDENTIAL_KEY_INVALID'
	)
}, 30_000)
