import { createHash, randomUUID } from 'node:crypto'
import {
	customerComponentManifestSchema,
	databaseNameForEnvironment,
	databaseRoleName,
	deriveDatabasePassword,
	quoteIdentifier
} from '@avenos/aven-customer-contracts'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { ComponentCatalogEntry } from '../src/catalog.js'
import { provisionerConfigSchema } from '../src/config.js'
import type { Operation } from '../src/control.js'
import { CustomerDatabaseProvisioner } from '../src/postgres.js'
import { functionSignature } from '../src/runtime-grants.js'

const url = process.env.PROVISIONER_TEST_DATABASE_URL
const environmentId = randomUUID()
const databaseName = databaseNameForEnvironment(environmentId)
const schema = 'fixture_private'
const root = Buffer.alloc(32, 7).toString('base64url')
const setKind = 'ceo.aven:db-role:intents:api@1'
const readKind = 'os.aven:db-role:actors:worker@1'
const secretId = randomUUID()
// A synthetic component exercises real provisioner functions without registering a customer feature.
const sql = `
CREATE TABLE fixture_private.values (id uuid PRIMARY KEY, value text NOT NULL);
CREATE FUNCTION fixture_private.set_value(p_id uuid,p_value text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  INSERT INTO fixture_private.values VALUES(p_id,p_value)
  ON CONFLICT(id) DO UPDATE SET value=EXCLUDED.value
$$;
CREATE FUNCTION fixture_private.read_label(p_id uuid) RETURNS text
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT CASE WHEN EXISTS(SELECT FROM fixture_private.values WHERE id=p_id)
    THEN 'Configured test connection' ELSE 'Not configured' END
$$;
CREATE FUNCTION fixture_private.read_label(p_id text) RETURNS text
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT value FROM fixture_private.values WHERE id::text=p_id
$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA fixture_private FROM PUBLIC;
`
const digest = createHash('sha256').update(sql).digest('hex')
const entry: ComponentCatalogEntry = {
	manifest: customerComponentManifestSchema.parse({
		componentRef: 'ceo.aven:component:fixture:private-functions@1',
		contractVersion: 1,
		schema,
		targetSchemaVersion: 1,
		migrationSetDigest: digest,
		minimumRuntimeSchemaVersion: 1,
		maximumRuntimeSchemaVersion: 1,
		ownerRoleSuffix: 'fixture_owner',
		functionRoles: [
			{
				kind: setKind,
				roleSuffix: 'fixture_set',
				grantsFile: 'grants/fixture-set.sql',
				connectionLimit: 4
			},
			{
				kind: readKind,
				roleSuffix: 'fixture_read',
				grantsFile: 'grants/fixture-read.sql',
				connectionLimit: 4
			}
		],
		dependencies: [],
		requiredByDefault: false
	}),
	migrations: [{ id: '0001_private_functions', sql, digest }],
	grants: {
		[setKind]: { tables: [], functions: [{ name: 'set_value', argumentTypes: ['uuid', 'text'] }] },
		[readKind]: { tables: [], functions: [{ name: 'read_label', argumentTypes: ['uuid'] }] }
	}
}
const operation: Operation = {
	id: randomUUID(),
	environmentId,
	databaseName,
	componentRef: entry.manifest.componentRef,
	action: 'reconcile',
	targetSchemaVersion: 1,
	migrationSetDigest: digest,
	routingGeneration: 1
}
let admin: pg.Pool, customerAdmin: pg.Pool, setter: pg.Pool, reader: pg.Pool
let provisioner: CustomerDatabaseProvisioner

describe.skipIf(!url)('real provisioner function-only roles', () => {
	beforeAll(async () => {
		if (!url) throw new Error('An isolated PostgreSQL URL is required')
		const config = provisionerConfigSchema.parse({
			CLUSTER_DATABASE_URL: url,
			CONTROL_DATABASE_URL: url,
			INTENTS_API_DB_CREDENTIAL_ROOT: root,
			PRODUCTIVITY_API_DB_CREDENTIAL_ROOT: root,
			ACTOR_API_DB_CREDENTIAL_ROOT: root,
			ACTOR_WORKER_DB_CREDENTIAL_ROOT: root,
			ARTIFACT_API_DB_CREDENTIAL_ROOT: root,
			BACKUP_DATABASE_ROLE: new URL(url).username,
			ARTIFACT_STORE_PROVISIONER_URL: 'http://127.0.0.1:1',
			ARTIFACT_STORE_PROVISIONER_TOKEN: 'x'.repeat(32)
		})
		admin = new pg.Pool({ connectionString: url })
		provisioner = new CustomerDatabaseProvisioner(url, config)
		await provisioner.reconcile(operation, entry)
		const customer = new URL(url)
		customer.pathname = `/${databaseName}`
		customerAdmin = new pg.Pool({ connectionString: customer.toString() })
		const runtime = (suffix: string, kind: string) => {
			const target = new URL(customer)
			target.username = databaseRoleName(environmentId, suffix)
			target.password = deriveDatabasePassword({
				root,
				environmentId,
				routingGeneration: 1,
				roleKind: kind
			})
			return new pg.Pool({ connectionString: target.toString(), max: 1 })
		}
		setter = runtime('fixture_set', setKind)
		reader = runtime('fixture_read', readKind)
	}, 30000)

	afterAll(async () => {
		await Promise.all([setter?.end(), reader?.end(), customerAdmin?.end()])
		if (!admin) return
		try {
			await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH (FORCE)`)
			for (const suffix of [
				'fixture_set',
				'fixture_read',
				'fixture_owner',
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

	test('set-only function succeeds without granting table access or returning its input', async () => {
		const result = await setter.query('SELECT fixture_private.set_value($1,$2)', [
			secretId,
			'synthetic-secret-value'
		])
		expect(JSON.stringify(result.rows)).not.toContain('synthetic-secret-value')
		expect(
			(await reader.query('SELECT fixture_private.read_label($1::uuid) AS label', [secretId])).rows
		).toEqual([{ label: 'Configured test connection' }])
		for (const runtime of [setter, reader])
			await expect(runtime.query('SELECT * FROM fixture_private.values')).rejects.toMatchObject({
				code: '42501'
			})
	})

	test('function grants distinguish overloads, roles and schema ownership', async () => {
		await expect(
			reader.query('SELECT fixture_private.read_label($1::text)', [secretId])
		).rejects.toMatchObject({ code: '42501' })
		await expect(
			reader.query('SELECT fixture_private.set_value($1,$2)', [secretId, 'replace'])
		).rejects.toMatchObject({ code: '42501' })
		await expect(
			setter.query('SELECT fixture_private.read_label($1::uuid)', [secretId])
		).rejects.toMatchObject({ code: '42501' })
		await expect(
			reader.query('CREATE TABLE fixture_private.unwanted(id int)')
		).rejects.toMatchObject({ code: '42501' })
		await expect(
			reader.query(`SET ROLE ${quoteIdentifier(databaseRoleName(environmentId, 'fixture_owner'))}`)
		).rejects.toMatchObject({ code: '42501' })
	})

	test('verification catches a missing grant on the second runtime role without invoking mutators', async () => {
		const role = quoteIdentifier(databaseRoleName(environmentId, 'fixture_read'))
		await customerAdmin.query(
			`REVOKE EXECUTE ON FUNCTION fixture_private.read_label(uuid) FROM ${role}`
		)
		await expect(provisioner.verify(operation, entry)).rejects.toThrow(
			'runtime function privilege verification failed'
		)
		await provisioner.reconcile(operation, entry)
		await expect(provisioner.verify(operation, entry)).resolves.toBeUndefined()
		expect(
			(await customerAdmin.query('SELECT count(*)::int AS count FROM fixture_private.values')).rows
		).toEqual([{ count: 1 }])
	})
})

test('catalog signatures use closed built-in types, not caller SQL fragments', () => {
	expect(functionSignature(schema, { name: 'set_value', argumentTypes: ['uuid', 'text'] })).toBe(
		'"fixture_private"."set_value"(pg_catalog.uuid,pg_catalog.text)'
	)
	expect(() =>
		functionSignature(schema, {
			name: 'set_value',
			argumentTypes: ['text); DROP TABLE x;--' as 'text']
		})
	).toThrow('unsupported')
	expect(() => functionSignature(schema, { name: 'bad.fn', argumentTypes: [] })).toThrow('unsafe')
})
