import { randomUUID } from 'node:crypto'
import { generateKeyPair, SignJWT } from 'jose'
import { describe, expect, test } from 'vitest'
import {
	databaseNameForEnvironment,
	MAX_WORK_GRANT_SECONDS,
	signWorkGrant,
	verifyTenantGrant,
	verifyWorkGrant,
	WORK_GRANT_AUDIENCE,
	type WorkGrantInput,
	workAllows
} from '../src/index.js'

describe('one-turn delegated authority with actual signatures', () => {
	const issuer = 'https://work-proof.example.test'
	const input = (): WorkGrantInput => {
		const environmentId = randomUUID()
		return {
			iss: issuer,
			jti: randomUUID(),
			sub: randomUUID(),
			sid: 'synthetic-session',
			role: 'user',
			membershipRole: 'owner',
			environmentId,
			databaseName: databaseNameForEnvironment(environmentId),
			routingGeneration: 1,
			kind: 'chat-turn',
			inputId: randomUUID(),
			inputRevision: 1,
			materialDigest: 'a'.repeat(64),
			permissions: [
				{
					componentRef: 'ceo.aven:component:data:productivity@1',
					actions: ['productivity:read', 'productivity:write']
				}
			]
		}
	}
	test('binds one input and a bounded action set without a reusable identity token', async () => {
		const keys = await generateKeyPair('EdDSA'),
			grant = input()
		const token = await signWorkGrant(grant, keys.privateKey)
		const claims = await verifyWorkGrant(token, keys.publicKey, issuer)
		expect(claims.inputId).toBe(grant.inputId)
		expect(claims.materialDigest).toBe(grant.materialDigest)
		expect(claims.exp - claims.iat).toBe(MAX_WORK_GRANT_SECONDS)
		expect(
			workAllows(claims, 'ceo.aven:component:data:productivity@1', ['productivity:write'])
		).toBe(true)
		expect(workAllows(claims, 'ceo.aven:component:data:intents@1', ['intents:delete'])).toBe(false)
		expect(workAllows(claims, 'ceo.aven:component:data:productivity@1', [])).toBe(false)
		await expect(
			verifyTenantGrant(token, keys.publicKey, {
				issuer,
				audience: 'ceo.aven:component:data:productivity@1',
				action: 'productivity:write'
			})
		).rejects.toThrow()
	})
	test('rejects a different issuer/key, expiration, future issue time and token-type substitution', async () => {
		const keys = await generateKeyPair('EdDSA'),
			other = await generateKeyPair('EdDSA'),
			grant = input()
		const token = await signWorkGrant(grant, keys.privateKey)
		await expect(
			verifyWorkGrant(token, keys.publicKey, 'https://another.example.test')
		).rejects.toThrow()
		await expect(verifyWorkGrant(token, other.publicKey, issuer)).rejects.toThrow()
		const expired = await signWorkGrant(
			grant,
			keys.privateKey,
			1,
			Math.floor(Date.now() / 1000) - 30
		)
		await expect(verifyWorkGrant(expired, keys.publicKey, issuer)).rejects.toThrow()
		const future = await signWorkGrant(
			grant,
			keys.privateKey,
			60,
			Math.floor(Date.now() / 1000) + 60
		)
		await expect(verifyWorkGrant(future, keys.publicKey, issuer)).rejects.toThrow()
		const claims = await verifyWorkGrant(token, keys.publicKey, issuer)
		const wrongType = await new SignJWT(claims)
			.setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
			.sign(keys.privateKey)
		await expect(verifyWorkGrant(wrongType, keys.publicKey, issuer)).rejects.toThrow()
	})
	test('rejects excessive lifetime, mismatched database, duplicate scopes and membership escalation before signing', async () => {
		const keys = await generateKeyPair('EdDSA'),
			grant = input()
		await expect(
			signWorkGrant(grant, keys.privateKey, MAX_WORK_GRANT_SECONDS + 1)
		).rejects.toThrow()
		await expect(
			signWorkGrant(
				{ ...grant, databaseName: databaseNameForEnvironment(randomUUID()) },
				keys.privateKey
			)
		).rejects.toThrow()
		await expect(
			signWorkGrant(
				{ ...grant, permissions: [...grant.permissions, ...grant.permissions] },
				keys.privateKey
			)
		).rejects.toThrow()
		await expect(
			signWorkGrant(
				{
					...grant,
					membershipRole: 'member',
					permissions: [
						{ componentRef: 'ceo.aven:component:data:intents@1', actions: ['intents:delete'] }
					]
				},
				keys.privateKey
			)
		).rejects.toThrow()
		const now = Math.floor(Date.now() / 1000)
		const signedBad = await new SignJWT({
			...grant,
			aud: WORK_GRANT_AUDIENCE,
			iat: now,
			exp: now + 7200
		})
			.setProtectedHeader({ alg: 'EdDSA', typ: 'aven-work+jwt' })
			.sign(keys.privateKey)
		await expect(verifyWorkGrant(signedBad, keys.publicKey, issuer)).rejects.toThrow()
	})
})
