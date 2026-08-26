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
		sites = new SiteBindingService(database.pool, { ipv4: '192.0.2.10', ipv6: [] })
	})

	afterAll(async () => database.teardown())

	test('supports multiple independently managed sites for one purchased name', async () => {
		const first = await sites.create(userId, {
			name,
			hostname: 'www.customer.example',
			repository: 'myavenceo/avenceo',
			sourceBranch: 'next',
			deploymentBranch: 'deploy/next'
		})
		const second = await sites.create(userId, {
			name,
			hostname: 'docs.customer.example',
			repository: 'myavenceo/documentation',
			sourceBranch: 'main',
			deploymentBranch: 'deploy/production'
		})
		expect(first.site.id).not.toBe(second.site.id)
		expect(first.dns.ipv4).toBe('192.0.2.10')
		expect(await sites.listForUser(userId)).toMatchObject([
			{ id: second.site.id, name, hostname: 'docs.customer.example' },
			{ id: first.site.id, name, hostname: 'www.customer.example' }
		])
		const directory = await sites.directory()
		expect(directory.bindings).toHaveLength(2)
		const firstDirectory = directory.bindings.find((binding) => binding.id === first.site.id)
		expect(firstDirectory).toBeDefined()
		expect(firstDirectory?.verification_token_hash).toBe(hashVerificationToken(first.dns.txtValue))
		expect(firstDirectory?.owner_is_admin).toBe(false)
		expect(JSON.stringify(directory)).not.toContain(first.dns.txtValue)

		const updated = await sites.update(userId, first.site.id, {
			name,
			hostname: 'app.customer.example',
			repository: 'myavenceo/avenceo',
			sourceBranch: 'production',
			deploymentBranch: 'deploy/next'
		})
		expect(updated.site).toMatchObject({
			id: first.site.id,
			hostname: 'app.customer.example',
			sourceBranch: 'production'
		})
		expect(await sites.remove(userId, first.site.id)).toBe(true)
		expect(await sites.listForUser(userId)).toMatchObject([
			{ id: second.site.id, hostname: 'docs.customer.example' }
		])
	})

	test('publishes operator subdomains only while their owner is an admin', async () => {
		await database.pool.query('UPDATE "user" SET role=$1 WHERE id=$2', ['admin', userId])
		const operatorSite = await sites.create(userId, {
			name,
			hostname: 'preview.aven.ceo',
			repository: 'myavenceo/operator-site',
			sourceBranch: 'next',
			deploymentBranch: 'deploy/operator'
		})
		expect(
			(await sites.directory()).bindings.find((binding) => binding.id === operatorSite.site.id)
		).toMatchObject({ hostname: 'preview.aven.ceo', owner_is_admin: true })

		await database.pool.query('UPDATE "user" SET role=$1 WHERE id=$2', ['user', userId])
		expect(
			(await sites.directory()).bindings.find((binding) => binding.id === operatorSite.site.id)
		).toBeUndefined()
	})

	test('does not let another user mutate a site', async () => {
		const other = await insertUser(database)
		const [site] = await sites.listForUser(userId)
		expect(site).toBeDefined()
		if (!site) throw new Error('expected a site fixture')
		await expect(
			sites.update(other.id, site.id, {
				name,
				hostname: 'stolen.customer.example',
				repository: 'myavenceo/documentation',
				sourceBranch: 'main',
				deploymentBranch: 'deploy/stolen'
			})
		).rejects.toMatchObject({ code: 'SITE_NOT_FOUND' })
		expect(await sites.remove(other.id, site.id)).toBe(false)
	})

	test('removes every site authorization when the shared name is revoked', async () => {
		expect((await sites.directory()).bindings).toHaveLength(1)
		await database.pool.query("UPDATE names SET status='revoked' WHERE name=$1", [name])
		expect((await sites.directory()).bindings).toHaveLength(0)
	})
})
