import { randomUUID } from 'node:crypto'
import { generateKeyPair, SignJWT } from 'jose'
import { expect, test } from 'vitest'
import {
	databaseNameForEnvironment,
	signWorkerPlacement,
	verifyTenantGrant,
	verifyWorkerPlacement,
	verifyWorkGrant,
	workerPlacementRequestSchema
} from '../src/index.js'

test('one-workspace lookup and directory pagination cannot be mixed', () => {
	const input = { runtimeId: 'primary', componentRef: 'ceo.aven:component:data:intents@1' }
	expect(workerPlacementRequestSchema.parse({ ...input, environmentId: randomUUID() }).limit).toBe(
		16
	)
	expect(
		workerPlacementRequestSchema.parse({ ...input, after: randomUUID(), limit: 1 }).limit
	).toBe(1)
	expect(() =>
		workerPlacementRequestSchema.parse({
			...input,
			after: randomUUID(),
			environmentId: randomUUID()
		})
	).toThrow()
	expect(() =>
		workerPlacementRequestSchema.parse({ ...input, environmentId: 'not-a-workspace' })
	).toThrow()
	expect(() =>
		workerPlacementRequestSchema.parse({ ...input, databaseName: 'customer_selected' })
	).toThrow()
})

test('a queue placement is bound to its worker and runtime, never a login or execution grant', async () => {
	const keys = await generateKeyPair('EdDSA'),
		environmentId = randomUUID(),
		issuer = 'https://placement.example.test'
	const componentRef = 'ceo.aven:component:data:intents@1' as const
	const input = {
		iss: issuer,
		runtimeId: 'primary',
		componentRef,
		environmentId,
		databaseName: databaseNameForEnvironment(environmentId),
		routingGeneration: 1
	}
	const expected = { issuer, runtimeId: 'primary', componentRef }
	const token = await signWorkerPlacement(input, keys.privateKey)
	const claims = await verifyWorkerPlacement(token, keys.publicKey, expected)
	expect(claims.exp - claims.iat).toBe(60)
	expect(claims).not.toHaveProperty('sub')
	expect(claims).not.toHaveProperty('sid')
	await expect(
		verifyWorkerPlacement(token, keys.publicKey, { ...expected, runtimeId: 'different' })
	).rejects.toThrow()
	await expect(
		verifyWorkerPlacement(token, keys.publicKey, {
			...expected,
			componentRef: 'os.aven:component:actors:run-repository@1'
		})
	).rejects.toThrow()
	await expect(
		verifyWorkerPlacement(token, (await generateKeyPair('EdDSA')).publicKey, expected)
	).rejects.toThrow()
	await expect(verifyWorkGrant(token, keys.publicKey, issuer)).rejects.toThrow()
	await expect(
		verifyTenantGrant(token, keys.publicKey, {
			issuer,
			audience: componentRef,
			action: 'intents:write'
		})
	).rejects.toThrow()
	await expect(
		signWorkerPlacement(
			{ ...input, databaseName: databaseNameForEnvironment(randomUUID()) },
			keys.privateKey
		)
	).rejects.toThrow()
	const expired = await signWorkerPlacement(
		input,
		keys.privateKey,
		Math.floor(Date.now() / 1000) - 61
	)
	await expect(verifyWorkerPlacement(expired, keys.publicKey, expected)).rejects.toThrow()
	const future = await signWorkerPlacement(
		input,
		keys.privateKey,
		Math.floor(Date.now() / 1000) + 10
	)
	await expect(verifyWorkerPlacement(future, keys.publicKey, expected)).rejects.toThrow()
	const confused = await new SignJWT(claims)
		.setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
		.sign(keys.privateKey)
	await expect(verifyWorkerPlacement(confused, keys.publicKey, expected)).rejects.toThrow()
})
