import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FakePaymentProvider } from '../src/lib/server/billing/fake.js'
import { parseCreemEvent } from '../src/lib/server/billing/provider.js'
import { sha256Hex } from '../src/lib/server/crypto.js'
import { EnvironmentService } from '../src/lib/server/environments/service.js'
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
		expect(
			(await database.pool.query('SELECT status FROM customer_environments WHERE name=$1', [name]))
				.rows[0].status
		).toBe('queued')
		expect(
			(
				await database.pool.query(
					"SELECT 1 FROM customer_environment_jobs WHERE operation='provision'"
				)
			).rowCount
		).toBe(1)
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
