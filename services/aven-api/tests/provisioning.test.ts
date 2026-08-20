import pg from 'pg'
import { afterAll, describe, expect, it } from 'vitest'
import { environmentNames } from '../src/lib/server/environments/naming.js'
import { provisionEnvironmentDatabase } from '../src/lib/server/environments/provisioning.js'

const adminUrl =
	process.env.TEST_ADMIN_DATABASE_URL ?? 'postgres://postgres:aven-dev@127.0.0.1:55432/postgres'
const names = environmentNames(`p${Date.now().toString(36)}`)

describe('environment database provisioning', () => {
	afterAll(async () => {
		const admin = new pg.Client({ connectionString: adminUrl })
		await admin.connect()
		await admin
			.query(`DROP DATABASE IF EXISTS "${names.databaseName}" WITH (FORCE)`)
			.catch(() => {})
		await admin.query(`DROP ROLE IF EXISTS "${names.ownerRole}"`).catch(() => {})
		await admin.end()
	})

	it('creates an idempotent database with a non-login owner', async () => {
		const messages: string[] = []
		const input = {
			provisionerUrl: adminUrl,
			databaseName: names.databaseName,
			ownerRole: names.ownerRole,
			log: {
				info: (message: string) => {
					messages.push(message)
				}
			}
		}
		await provisionEnvironmentDatabase(input)
		await provisionEnvironmentDatabase(input)

		const admin = new pg.Client({ connectionString: adminUrl })
		await admin.connect()
		const role = (
			await admin.query('SELECT rolcanlogin FROM pg_roles WHERE rolname=$1', [names.ownerRole])
		).rows[0]
		const database = (
			await admin.query(
				'SELECT owner.rolname AS owner FROM pg_database db JOIN pg_roles owner ON owner.oid=db.datdba WHERE db.datname=$1',
				[names.databaseName]
			)
		).rows[0]
		await admin.end()
		expect(role.rolcanlogin).toBe(false)
		expect(database.owner).toBe(names.ownerRole)
		expect(messages.some((message) => message.includes('ready'))).toBe(true)
	})
})
