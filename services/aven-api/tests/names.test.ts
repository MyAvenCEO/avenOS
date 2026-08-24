import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FakePaymentProvider } from '../src/lib/server/billing/fake.js'
import { parsePolarEvent } from '../src/lib/server/billing/provider.js'
import { sha256Hex } from '../src/lib/server/crypto.js'
import { CURRENT_ARTIFACT_STORE_SCHEMA_VERSION } from '../src/lib/server/environments/provisioning.js'
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
		const checkoutId = new URL(checkout.checkoutUrl).searchParams.get('checkoutId')
		if (!checkoutId) throw new Error('Fake checkout did not provide an id')
		const event = parsePolarEvent(
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
				'SELECT id,owner_user_id,status,contract_version,artifact_scope_id,artifact_store_status,artifact_store_schema_version,effective_config FROM customer_environments WHERE name=$1',
				[name]
			)
		).rows[0]
		expect(environment.status).toBe('queued')
		expect(environment.contract_version).toBe(2)
		expect(environment.artifact_scope_id).toBe(environment.id)
		expect(environment.artifact_store_status).toBe('pending')
		expect(environment.artifact_store_schema_version).toBe(0)
		expect(environment.effective_config.artifactStore).toEqual({
			schemaVersion: CURRENT_ARTIFACT_STORE_SCHEMA_VERSION,
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
			"UPDATE customer_environments SET status='ready',artifact_store_status='ready',artifact_store_schema_version=$2 WHERE id=$1",
			[environment.id, CURRENT_ARTIFACT_STORE_SCHEMA_VERSION]
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
		await database.pool.query(
			"UPDATE customer_environment_jobs SET status='running',lease_owner='old-worker',lease_expires_at=now()+interval '5 minutes' WHERE environment_id=$1 AND status='queued'",
			[environment.id]
		)

		const refund = { ...event, id: `refund-${randomUUID()}`, type: 'refund.created' }
		expect(await service.revokeFromEvent(refund)).toEqual({ revoked: true })
		expect(
			(await database.pool.query('SELECT status FROM names WHERE name=$1', [name])).rows[0].status
		).toBe('revoked')
		await expect(
			environments.artifactTargetForUser(environment.owner_user_id)
		).rejects.toMatchObject({
			code: 'NAME_REQUIRED'
		})
		await worker.reconcileDesiredState()
		expect(
			(
				await database.pool.query(
					"SELECT operation FROM customer_environment_jobs WHERE environment_id=$1 AND status='running'",
					[environment.id]
				)
			).rows[0].operation
		).toBe('provision')
		await database.pool.query(
			"UPDATE customer_environment_jobs SET status='succeeded',lease_owner=NULL,lease_expires_at=NULL WHERE environment_id=$1 AND status='running'",
			[environment.id]
		)
		await database.pool.query(
			"UPDATE customer_environments SET status='ready',artifact_store_status='ready',last_operation='provision' WHERE id=$1",
			[environment.id]
		)
		await worker.reconcileDesiredState()
		expect(
			(
				await database.pool.query(
					"SELECT 1 FROM customer_environment_jobs WHERE environment_id=$1 AND operation='suspend' AND status='queued'",
					[environment.id]
				)
			).rowCount
		).toBe(1)

		const legacyName = `l${randomUUID().replaceAll('-', '').slice(0, 12)}`
		await database.pool.query(
			`INSERT INTO names(name,owner_user_id,status,purchased_at,created_at,updated_at)
			 VALUES($1,$2,'owned',now(),now(),now())`,
			[legacyName, environment.owner_user_id]
		)
		const reconciled = await worker.reconcileDesiredState()
		expect(reconciled.backfilled).toBe(1)
		expect(
			(
				await database.pool.query(
					'SELECT artifact_scope_id,status FROM customer_environments WHERE name=$1',
					[legacyName]
				)
			).rows[0]
		).toMatchObject({ status: 'queued' })
		await database.pool.query(
			`UPDATE customer_environment_jobs
			 SET status='running',lease_owner='dead-worker',lease_expires_at=now()-interval '1 second'
			 WHERE environment_id=(SELECT id FROM customer_environments WHERE name=$1)`,
			[legacyName]
		)
		const recovered = await worker.reconcileDesiredState()
		expect(recovered.recoveredLeases).toBe(1)
		expect(
			(
				await database.pool.query(
					`SELECT status FROM customer_environment_jobs
					 WHERE environment_id=(SELECT id FROM customer_environments WHERE name=$1)
					   AND status='queued'`,
					[legacyName]
				)
			).rowCount
		).toBe(1)
		await database.pool.query(
			`UPDATE customer_environment_jobs SET status='failed'
			 WHERE environment_id=(SELECT id FROM customer_environments WHERE name=$1)`,
			[legacyName]
		)
		await database.pool.query(
			"UPDATE customer_environments SET status='failed',last_operation='provision' WHERE name=$1",
			[legacyName]
		)
		const terminal = await worker.reconcileDesiredState()
		expect(terminal.terminalFailures).toBe(1)
		expect(
			(
				await database.pool.query(
					`SELECT 1 FROM customer_environment_jobs
					 WHERE environment_id=(SELECT id FROM customer_environments WHERE name=$1)
					   AND status IN ('queued','running')`,
					[legacyName]
				)
			).rowCount
		).toBe(0)
	})
})
