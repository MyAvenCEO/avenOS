import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PasskeyService } from '../src/lib/server/passkeys.js'
import { createTestDatabase, insertUser, type TestDatabase } from './helpers.js'

describe('passkey setup link', () => {
	let database: TestDatabase
	beforeAll(async () => {
		database = await createTestDatabase()
	})
	afterAll(async () => {
		await database.teardown()
	})

	it('is reusable until a PRF-capable passkey is complete', async () => {
		const user = await insertUser(database)
		const service = new PasskeyService(database.pool, true)
		const token = await service.issueSetupLink(database.pool, user.id)
		if (!token) throw new Error('no setup link was issued')
		expect(await service.verifySetupLogin(token)).toEqual({ userId: user.id })
		expect(await service.verifySetupLogin(token)).toEqual({ userId: user.id })

		const id = randomUUID()
		await database.pool.query(
			"INSERT INTO passkey(id,name,public_key,user_id,credential_id,counter,device_type,backed_up,created_at,prf_enabled) VALUES($1,'test','key',$2,$3,0,'singleDevice',false,now(),false)",
			[id, user.id, `credential-${id}`]
		)
		expect(await service.verifySetupLogin(token)).toEqual({ userId: user.id })
		await service.finishEnrollment(user.id, true, `credential-${id}`)
		expect(await service.verifySetupLogin(token)).toBeNull()
		expect((await service.status(user.id)).passkeys[0].prf_enabled).toBe(true)
	})
})
