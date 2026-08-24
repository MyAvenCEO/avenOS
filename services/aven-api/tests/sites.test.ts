import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { hashVerificationToken, SiteBindingService } from '../src/lib/server/sites/service.js'
import { createTestDatabase, insertUser, type TestDatabase } from './helpers.js'

describe('static site bindings', () => {
	let database: TestDatabase
	let userId: string
	let name: string
	let sites: SiteBindingService

	beforeAll(async () => {
		database = await createTestDatabase()
		userId = (await insertUser(database)).id
		name = `site${randomUUID().replaceAll('-', '').slice(0, 10)}`
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
		sites = new SiteBindingService(database.pool)
	})

	afterAll(async () => database.teardown())

	test('stores only the verification token hash and exposes the active directory', async () => {
		const configured = await sites.configure(userId, {
			name,
			hostname: 'customer.example',
			repository: 'myavenceo/avenceo',
			sourceBranch: 'next',
			deploymentBranch: 'deploy/next'
		})
		const directory = await sites.directory()
		expect(directory.bindings).toHaveLength(1)
		expect(directory.bindings[0]).toMatchObject({
			hostname: 'customer.example',
			repository_full_name: 'myavenceo/avenceo',
			artifact_ref: 'refs/heads/deploy/next'
		})
		expect(directory.bindings[0].verification_token_hash).toBe(
			hashVerificationToken(configured.dns.txtValue)
		)
		expect(JSON.stringify(directory)).not.toContain(configured.dns.txtValue)
	})

	test('removes the host authorization when the name is revoked', async () => {
		await database.pool.query("UPDATE names SET status='revoked' WHERE name=$1", [name])
		expect((await sites.directory()).bindings).toHaveLength(0)
	})
})
