import pg from 'pg'
import { afterAll, describe, expect, it } from 'vitest'
import { environmentNames } from '../src/lib/server/environments/naming.js'
import {
	ensureArtifactRuntimeRole,
	provisionEnvironmentDatabase,
	suspendEnvironmentDatabase
} from '../src/lib/server/environments/provisioning.js'

const adminUrl =
	process.env.TEST_ADMIN_DATABASE_URL ?? 'postgres://postgres:aven-dev@127.0.0.1:55432/postgres'
const names = environmentNames(`p${Date.now().toString(36)}`)
const runtimeRole = `artifact_${Date.now().toString(36)}`
const runtimeParent = `artifact_parent_${Date.now().toString(36)}`

describe('environment database provisioning', () => {
	afterAll(async () => {
		const admin = new pg.Client({ connectionString: adminUrl })
		await admin.connect()
		await admin
			.query(`DROP DATABASE IF EXISTS "${names.databaseName}" WITH (FORCE)`)
			.catch(() => {})
		await admin.query(`DROP ROLE IF EXISTS "${names.ownerRole}"`).catch(() => {})
		await admin.query(`DROP ROLE IF EXISTS "${runtimeRole}"`).catch(() => {})
		await admin.query(`DROP ROLE IF EXISTS "${runtimeParent}"`).catch(() => {})
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

		const unsafe = new pg.Client({ connectionString: adminUrl })
		await unsafe.connect()
		await unsafe.query(`ALTER ROLE "${names.ownerRole}" CREATEDB`)
		await expect(provisionEnvironmentDatabase(input)).rejects.toThrow('unsafe attributes')
		await unsafe.query(`ALTER ROLE "${names.ownerRole}" NOCREATEDB`)
		await unsafe.end()
	})

	it('rotates a constrained runtime login independently of tenant jobs', async () => {
		const firstPassword = 'first-artifact-runtime-test-password'
		const secondPassword = 'second-artifact-runtime-test-password'
		await ensureArtifactRuntimeRole({
			provisionerUrl: adminUrl,
			runtimeRole,
			runtimePassword: firstPassword,
			log: { info: () => {} }
		})
		await ensureArtifactRuntimeRole({
			provisionerUrl: adminUrl,
			runtimeRole,
			runtimePassword: secondPassword,
			log: { info: () => {} }
		})

		const admin = new pg.Client({ connectionString: adminUrl })
		await admin.connect()
		const role = (
			await admin.query(
				'SELECT rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication FROM pg_roles WHERE rolname=$1',
				[runtimeRole]
			)
		).rows[0]
		await admin.end()
		expect(role).toEqual({
			rolcanlogin: true,
			rolsuper: false,
			rolcreatedb: false,
			rolcreaterole: false,
			rolreplication: false
		})

		const runtimeUrl = new URL(adminUrl)
		runtimeUrl.username = runtimeRole
		runtimeUrl.password = secondPassword
		const runtime = new pg.Client({ connectionString: runtimeUrl.toString() })
		await runtime.connect()
		await expect(runtime.query('SELECT 1')).resolves.toBeDefined()
		await runtime.end()

		const membership = new pg.Client({ connectionString: adminUrl })
		await membership.connect()
		await membership.query(`CREATE ROLE "${runtimeParent}" NOLOGIN`)
		await membership.query(`GRANT "${runtimeParent}" TO "${runtimeRole}"`)
		await expect(
			ensureArtifactRuntimeRole({
				provisionerUrl: adminUrl,
				runtimeRole,
				runtimePassword: secondPassword,
				log: { info: () => {} }
			})
		).rejects.toThrow('unsafe memberships')
		await membership.query(`REVOKE "${runtimeParent}" FROM "${runtimeRole}"`)
		await membership.end()
	})

	it('treats suspension of absent resources as converged and rejects unsafe identifiers', async () => {
		await expect(
			suspendEnvironmentDatabase({
				provisionerUrl: adminUrl,
				databaseName: 'cust_does_not_exist',
				runtimeRole,
				log: { info: () => {} }
			})
		).resolves.toBeUndefined()

		await expect(
			provisionEnvironmentDatabase({
				provisionerUrl: 'postgres://unreachable.invalid/postgres',
				databaseName: 'cust_bad-name',
				ownerRole: names.ownerRole,
				log: { info: () => {} }
			})
		).rejects.toThrow('Customer database name is invalid')
	})
})
