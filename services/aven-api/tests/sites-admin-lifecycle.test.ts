import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { validateBinding } from '../../static-site-host/src/binding.js'
import { SiteBindingService } from '../src/lib/server/sites/service.js'
import { createTestDatabase, insertUser, type TestDatabase } from './helpers.js'

describe('admin static-site authorization lifecycle on the local stack', () => {
	let database: TestDatabase
	let userId: string
	let name: string
	let sites: SiteBindingService

	beforeAll(async () => {
		database = await createTestDatabase()
		userId = (await insertUser(database)).id
		name = `adminsite${randomUUID().replaceAll('-', '').slice(0, 8)}`
		await database.pool.query(
			`INSERT INTO names(name,owner_user_id,status,purchased_at,created_at,updated_at)
			 VALUES($1,$2,'owned',now(),now(),now())`,
			[name, userId]
		)
		await database.pool.query(
			`INSERT INTO customer_environments
			 (id,owner_user_id,name,database_name,artifact_scope_id,owner_role,stack_name,
			  effective_config,status,queued_at,updated_at)
			 VALUES($1,$2,$3,$4,$5,$6,$7,'{}','ready',now(),now())`,
			[randomUUID(), userId, name, `cust_${name}`, randomUUID(), `role_${name}`, `stack_${name}`]
		)
		sites = new SiteBindingService(database.pool, { ipv4: '192.0.2.10', ipv6: [] })
	})

	afterAll(async () => database.teardown())

	test('promotion authorizes, demotion withdraws, and re-promotion restores the binding', async () => {
		await database.pool.query('UPDATE "user" SET role=$1 WHERE id=$2', ['admin', userId])
		const created = await sites.create(userId, {
			name,
			hostname: 'local-stack-test.aven.ceo',
			repository: 'myavenceo/local-stack-test',
			sourceBranch: 'next',
			deploymentBranch: 'deploy/next'
		})

		const authorized = (await sites.directory()).bindings.find(
			(binding) => binding.id === created.site.id
		)
		expect(authorized).toMatchObject({
			hostname: 'local-stack-test.aven.ceo',
			owner_is_admin: true
		})
		expect(() => validateBinding(authorized)).not.toThrow()

		await database.pool.query('UPDATE "user" SET role=$1 WHERE id=$2', ['user', userId])
		expect(
			(await sites.directory()).bindings.find((binding) => binding.id === created.site.id)
		).toBeUndefined()
		expect(await sites.listForUser(userId)).toMatchObject([
			{ id: created.site.id, hostname: 'local-stack-test.aven.ceo' }
		])

		await database.pool.query('UPDATE "user" SET role=$1 WHERE id=$2', ['admin', userId])
		const restored = (await sites.directory()).bindings.find(
			(binding) => binding.id === created.site.id
		)
		expect(restored).toMatchObject({
			hostname: 'local-stack-test.aven.ceo',
			owner_is_admin: true
		})
		expect(() => validateBinding(restored)).not.toThrow()
	})
})
