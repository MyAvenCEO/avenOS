import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FakePaymentProvider } from '../src/lib/server/billing/fake.js'
import { parseCreemEvent } from '../src/lib/server/billing/provider.js'
import { sha256Hex } from '../src/lib/server/crypto.js'
import { EnvironmentService } from '../src/lib/server/environments/service.js'
import { EnvironmentWorker } from '../src/lib/server/environments/worker.js'
import { NameService } from '../src/lib/server/names/service.js'
import { PasskeyService } from '../src/lib/server/passkeys.js'
import { createTestDatabase, type TestDatabase, testConfig, testNotifier } from './helpers.js'

describe('checkout grant', () => {
	let database: TestDatabase
	beforeAll(async () => {
		database = await createTestDatabase()
	})
	afterAll(async () => {
		await database.teardown()
	})

	it('creates the user, setup link, environment job, and one payment event', async () => {
		const config = testConfig()
		const payments = new FakePaymentProvider(config)
		const passkeys = new PasskeyService(database.pool, true)
		const environments = new EnvironmentService(database.pool)
		const service = new NameService(
			database.pool,
			config,
			testNotifier(config),
			payments,
			(connection, userId) => passkeys.issueSetupLink(connection, userId),
			async (connection, input) => {
				await environments.enqueueProvision(connection, input)
			},
			(connection, input) => environments.enqueueSuspension(connection, input)
		)
		const name = `n${randomUUID().replaceAll('-', '').slice(0, 12)}`
		const email = `${name}@example.test`
		await service.secure(name, email)
		const hold = (await database.pool.query('SELECT id FROM name_holds WHERE name=$1', [name]))
			.rows[0]
		const token = `claim-${randomUUID().replaceAll('-', '')}`
		await database.pool.query('UPDATE name_holds SET claim_token_hash=$1 WHERE id=$2', [
			sha256Hex(token),
			hold.id
		])
		const checkout = await service.claim(token)
		const checkoutId = new URL(checkout.checkoutUrl).searchParams.get('checkoutId')!
		const event = parseCreemEvent(
			payments.buildCompletedWebhookBody({
				checkoutId,
				holdId: hold.id,
				name,
				email,
				amountEur: 25
			})
		)

		expect(await service.grantFromEvent(event)).toEqual({ granted: true })
		expect(await service.grantFromEvent(event)).toEqual({ granted: false })
		expect(
			(
				await database.pool.query('SELECT COUNT(*)::int AS count FROM payment_events WHERE id=$1', [
					event.id
				])
			).rows[0].count
		).toBe(1)
		const environment = (
			await database.pool.query(
				'SELECT id,owner_user_id,status,contract_version,artifact_scope_id,artifact_store_status,effective_config FROM customer_environments WHERE name=$1',
				[name]
			)
		).rows[0]
		expect(environment.status).toBe('queued')
		expect(environment.contract_version).toBe(2)
		expect(environment.artifact_scope_id).toBe(environment.id)
		expect(environment.artifact_store_status).toBe('pending')
		expect(environment.effective_config.artifactStore).toEqual({
			schemaVersion: 1,
			scopeId: environment.id
		})
		expect(
			(
				await database.pool.query(
					"SELECT 1 FROM customer_environment_jobs WHERE operation='provision'"
				)
			).rowCount
		).toBe(1)
		await database.pool.query(
			"UPDATE customer_environment_jobs SET status='succeeded' WHERE environment_id=$1",
			[environment.id]
		)
		await database.pool.query("UPDATE customer_environments SET status='ready' WHERE id=$1", [
			environment.id
		])
		const artifactConfig = testConfig({
			ARTIFACT_STORE_PROVISIONER_BASE_URL: 'http://artifact-provisioner.test',
			ARTIFACT_STORE_PROVISIONER_BEARER_TOKEN: 'artifact-provisioner-test-token-0001',
			ARTIFACT_STORE_RUNTIME_ROLE: 'aven_artifact_store',
			ARTIFACT_STORE_RUNTIME_PASSWORD: 'artifact-runtime-test-password-0001'
		})
		const worker = new EnvironmentWorker(database.pool, artifactConfig, pino({ level: 'silent' }))
		expect(await worker.enqueueArtifactStoreUpgrades()).toBe(1)
		await database.pool.query(
			"UPDATE customer_environments SET artifact_store_status='ready' WHERE id=$1",
			[environment.id]
		)
		expect(await environments.artifactTargetForUser(environment.owner_user_id)).toEqual({
			environmentId: environment.id,
			databaseName: `cust_${name}`,
			scopeId: environment.id
		})
		expect((await database.pool.query('SELECT 1 FROM setup_links')).rowCount).toBe(1)
		expect(
			(
				await database.pool.query(
					"SELECT template_key FROM email_queue WHERE template_key='name.purchased'"
				)
			).rowCount
		).toBe(1)

		const refund = { ...event, id: `refund-${randomUUID()}`, type: 'refund.created' }
		expect(await service.revokeFromEvent(refund)).toEqual({ revoked: true })
		expect(
			(await database.pool.query('SELECT status FROM names WHERE name=$1', [name])).rows[0].status
		).toBe('revoked')
		expect(
			(
				await database.pool.query(
					"SELECT 1 FROM customer_environment_jobs WHERE operation='suspend'"
				)
			).rowCount
		).toBe(1)
	})
})
