import { randomUUID } from 'node:crypto'
import {
	databaseNameForEnvironment,
	databaseRoleName,
	deriveDatabasePassword,
	quoteIdentifier
} from '@avenos/aven-customer-contracts'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { type ComponentCatalogEntry, loadCatalog } from '../src/catalog'
import { provisionerConfigSchema } from '../src/config'
import type { Operation } from '../src/control'
import { CustomerDatabaseProvisioner } from '../src/postgres'

const url = process.env.PROVISIONER_TEST_DATABASE_URL
const environmentId = randomUUID(),
	subjectId = randomUUID(),
	database = databaseNameForEnvironment(environmentId)
let entry: ComponentCatalogEntry,
	operation: Operation,
	provisioner: CustomerDatabaseProvisioner,
	admin: pg.Pool
const pools = new Map<string, pg.Pool>()
const root = Buffer.alloc(32, 29).toString('base64url')
describe.skipIf(!url)('provisioned credential component', () => {
	beforeAll(async () => {
		if (
			!url ||
			!['localhost', '127.0.0.1'].includes(new URL(url).hostname) ||
			new URL(url).pathname !== '/postgres'
		)
			throw Error('Isolated local test database required')
		entry = (await loadCatalog()).get('ceo.aven:component:data:credentials@1')!
		const config = provisionerConfigSchema.parse({
			CLUSTER_DATABASE_URL: url,
			CONTROL_DATABASE_URL: url,
			INTENTS_API_DB_CREDENTIAL_ROOT: root,
			PRODUCTIVITY_API_DB_CREDENTIAL_ROOT: root,
			ACTOR_API_DB_CREDENTIAL_ROOT: root,
			ACTOR_WORKER_DB_CREDENTIAL_ROOT: root,
			ARTIFACT_API_DB_CREDENTIAL_ROOT: root,
			CREDENTIAL_SET_DB_CREDENTIAL_ROOT: root,
			CREDENTIAL_METADATA_DB_CREDENTIAL_ROOT: root,
			CREDENTIAL_MATCH_DB_CREDENTIAL_ROOT: root,
			CREDENTIAL_HTTP_DB_CREDENTIAL_ROOT: root,
			CREDENTIAL_IMAP_DB_CREDENTIAL_ROOT: root,
			BACKUP_DATABASE_ROLE: new URL(url).username,
			ARTIFACT_STORE_PROVISIONER_URL: 'http://127.0.0.1:1',
			ARTIFACT_STORE_PROVISIONER_TOKEN: 'x'.repeat(32)
		})
		admin = new pg.Pool({ connectionString: url })
		operation = {
			id: randomUUID(),
			environmentId,
			databaseName: database,
			componentRef: entry.manifest.componentRef,
			action: 'reconcile',
			targetSchemaVersion: 1,
			migrationSetDigest: entry.manifest.migrationSetDigest,
			routingGeneration: 1
		}
		provisioner = new CustomerDatabaseProvisioner(url, config)
		await provisioner.reconcile(operation, entry)
		for (const role of entry.manifest.functionRoles) {
			const connection = new URL(url)
			connection.pathname = `/${database}`
			connection.username = databaseRoleName(environmentId, role.roleSuffix)
			connection.password = deriveDatabasePassword({
				root,
				environmentId,
				routingGeneration: 1,
				roleKind: role.kind
			})
			pools.set(role.roleSuffix, new pg.Pool({ connectionString: connection.toString(), max: 1 }))
		}
	}, 30000)
	afterAll(async () => {
		await Promise.all([...pools.values()].map((pool) => pool.end()))
		if (!admin) return
		try {
			await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(database)} WITH(FORCE)`)
			for (const suffix of [
				...entry.manifest.functionRoles.map((r) => r.roleSuffix),
				'cred_owner',
				'platform_owner',
				'db_owner'
			])
				await admin.query(
					`DROP ROLE IF EXISTS ${quoteIdentifier(databaseRoleName(environmentId, suffix))}`
				)
		} finally {
			await admin.end()
		}
	})
	test('actual catalog installs and verifies function-only roles', async () => {
		await expect(provisioner.verify(operation, entry)).resolves.toBeUndefined()
		for (const suffix of ['cred_meta', 'cred_match']) {
			const result = await pools
				.get(suffix)!
				.query('SELECT aven_credentials.metadata($1,$2,1) AS value', [environmentId, subjectId])
			expect(result.rows[0].value).toEqual({ credentials: [], bindings: [] })
		}
	})
	test('neither ingress nor executors can select ciphertext or invoke private cores', async () => {
		for (const pool of pools.values()) {
			await expect(
				pool.query('SELECT envelope FROM aven_credentials.credentials')
			).rejects.toMatchObject({ code: '42501' })
			await expect(
				pool.query("SELECT aven_credentials.claim_unit('http','{}',0,$1)", ['a'.repeat(64)])
			).rejects.toMatchObject({ code: '42501' })
			await expect(
				pool.query(`SET ROLE ${quoteIdentifier(databaseRoleName(environmentId, 'cred_owner'))}`)
			).rejects.toMatchObject({ code: '42501' })
		}
		await expect(
			pools
				.get('cred_http')!
				.query("SELECT aven_credentials.claim_imap('{}',0,$1)", ['a'.repeat(64)])
		).rejects.toMatchObject({ code: '42501' })
		await expect(
			pools
				.get('cred_imap')!
				.query("SELECT aven_credentials.claim_http('{}',0,$1)", ['a'.repeat(64)])
		).rejects.toMatchObject({ code: '42501' })
	})
	test('reconciliation is repeatable without widening grants', async () => {
		await provisioner.reconcile(operation, entry)
		await expect(provisioner.verify(operation, entry)).resolves.toBeUndefined()
		await expect(
			pools
				.get('cred_meta')!
				.query("SELECT aven_credentials.admin_command($1,$2,1,$3,'{}')", [
					environmentId,
					subjectId,
					randomUUID()
				])
		).rejects.toMatchObject({ code: '42501' })
	})
})
