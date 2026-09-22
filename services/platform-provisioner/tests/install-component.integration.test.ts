import { randomUUID } from 'node:crypto'
import { quoteIdentifier } from '@avenos/aven-customer-contracts'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { type ComponentCatalogEntry, loadCatalog } from '../src/catalog'
import { installOptionalComponent } from '../src/install-component'
import {
	installedComponents,
	movementComponents,
	queueInstalledComponentReconciliation
} from '../src/movement-components'

const url = process.env.PROVISIONER_TEST_DATABASE_URL
const schema = `install_proof_${randomUUID().replaceAll('-', '')}`
let admin: pg.Pool, pool: pg.Pool, entry: ComponentCatalogEntry
let created = false
describe.skipIf(!url)('optional component admission on real PostgreSQL', () => {
	beforeAll(async () => {
		if (
			!url ||
			!['localhost', '127.0.0.1'].includes(new URL(url).hostname) ||
			new URL(url).pathname !== '/postgres'
		)
			throw Error('Isolated local PostgreSQL required')
		admin = new pg.Pool({ connectionString: url, max: 1 })
		await admin.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`)
		created = true
		pool = new pg.Pool({ connectionString: url, max: 4, options: `-c search_path=${schema}` })
		await pool.query(`CREATE TABLE customer_runtimes(id text PRIMARY KEY,retired_at timestamptz,component_catalog jsonb);
		CREATE TABLE customer_environments(id uuid PRIMARY KEY,runtime_id text REFERENCES customer_runtimes(id),routing_generation bigint,desired_state text,observed_state text,movement_id uuid,last_error text,updated_at timestamptz DEFAULT now());
		CREATE TABLE customer_environment_components(environment_id uuid REFERENCES customer_environments(id),component_ref text,desired_state text,observed_state text,target_schema_version int,observed_schema_version int,migration_set_digest text,observed_migration_set_digest text,routing_generation bigint,last_error text,updated_at timestamptz DEFAULT now(),PRIMARY KEY(environment_id,component_ref));
		CREATE TABLE customer_component_operations(id uuid PRIMARY KEY,environment_id uuid REFERENCES customer_environments(id),component_ref text,action text,status text,target_schema_version int,migration_set_digest text,routing_generation bigint,attempt int DEFAULT 0,lease_owner text,lease_expires_at timestamptz,last_error text,updated_at timestamptz DEFAULT now(),UNIQUE(environment_id,component_ref,action,routing_generation,target_schema_version,migration_set_digest));`)
		const credentialEntry = (await loadCatalog()).get('ceo.aven:component:data:credentials@1')
		if (!credentialEntry) throw new Error('Credential component fixture is missing.')
		// Exercise the generic opt-in mechanism with a synthetic optional catalog
		// entry. Protected connections themselves are a default component.
		entry = {
			...credentialEntry,
			manifest: { ...credentialEntry.manifest, requiredByDefault: false }
		}
		await pool.query(
			`INSERT INTO customer_runtimes VALUES('proof',NULL,$1),('wrong-release',NULL,'[]')`,
			[JSON.stringify([entry.manifest])]
		)
	})
	afterAll(async () => {
		await pool?.end()
		if (created) await admin.query(`DROP SCHEMA ${quoteIdentifier(schema)} CASCADE`)
		await admin?.end()
	})
	async function workspace(runtime = 'proof', state = 'ready', movement: string | null = null) {
		const id = randomUUID()
		await pool.query(`INSERT INTO customer_environments VALUES($1,$2,3,'ready',$3,$4)`, [
			id,
			runtime,
			state,
			movement
		])
		return id
	}
	test('concurrent installation queues once, never advances the generation or declares ready', async () => {
		const id = await workspace()
		const results = await Promise.all([
			installOptionalComponent(pool, 'proof', id, entry),
			installOptionalComponent(pool, 'proof', id, entry)
		])
		expect(results.filter((r) => r.queued)).toHaveLength(1)
		expect(
			(
				await pool.query(
					'SELECT status,routing_generation FROM customer_component_operations WHERE environment_id=$1',
					[id]
				)
			).rows
		).toEqual([{ status: 'queued', routing_generation: '3' }])
		expect(
			(
				await pool.query(
					'SELECT observed_state FROM customer_environment_components WHERE environment_id=$1',
					[id]
				)
			).rows
		).toEqual([{ observed_state: 'pending' }])
	})
	test('runtime upgrade installs newly required defaults but not optional capabilities', async () => {
		const id = await workspace()
		const required = {
			...entry,
			manifest: { ...entry.manifest, requiredByDefault: true }
		}
		const catalog = new Map([[required.manifest.componentRef, required]])
		const client = await pool.connect()
		try {
			await client.query('BEGIN')
			const result = await queueInstalledComponentReconciliation(client, id, 'proof', catalog, {
				mode: 'changed',
				installMissingDefaults: true
			})
			await client.query('COMMIT')
			expect(result.operations.map((operation) => operation.componentRef)).toEqual([
				required.manifest.componentRef
			])
		} finally {
			client.release()
		}
		const installed = await pool.query(
			`SELECT component_ref,desired_state,observed_state
			 FROM customer_environment_components WHERE environment_id=$1`,
			[id]
		)
		expect(installed.rows).toEqual([
			{
				component_ref: required.manifest.componentRef,
				desired_state: 'ready',
				observed_state: 'pending'
			}
		])
	})
	test('refuses moving, unavailable, wrong-runtime and unadvertised-release targets', async () => {
		for (const [id, runtime] of [
			[await workspace('proof', 'ready', randomUUID()), 'proof'],
			[await workspace('proof', 'failed'), 'proof'],
			[await workspace(), 'other'],
			[await workspace('wrong-release'), 'wrong-release']
		] satisfies Array<[string, string]>) {
			await expect(installOptionalComponent(pool, runtime, id, entry)).rejects.toThrow()
			expect(
				(
					await pool.query(
						'SELECT count(*) AS n FROM customer_environment_components WHERE environment_id=$1',
						[id]
					)
				).rows[0].n
			).toBe('0')
		}
	})
	test('moves exactly the ready installed component set, not every advertised capability', async () => {
		const catalog = await loadCatalog()
		const required = [...catalog.values()].find(
			(candidate) =>
				candidate.manifest.requiredByDefault &&
				candidate.manifest.componentRef !== entry.manifest.componentRef
		)
		if (!required) throw new Error('Default component fixture is missing.')
		const id = await workspace()
		await pool.query(
			`INSERT INTO customer_environment_components
			 (environment_id,component_ref,desired_state,observed_state,target_schema_version,migration_set_digest,routing_generation)
			 VALUES($1,$2,'ready','ready',$3,$4,3)`,
			[
				id,
				required.manifest.componentRef,
				required.manifest.targetSchemaVersion,
				required.manifest.migrationSetDigest
			]
		)
		expect(
			(await movementComponents(pool, id, catalog)).map(
				(candidate) => candidate.manifest.componentRef
			)
		).toEqual([required.manifest.componentRef])

		await pool.query(
			`INSERT INTO customer_environment_components
			 (environment_id,component_ref,desired_state,observed_state,target_schema_version,migration_set_digest,routing_generation)
			 VALUES($1,$2,'ready','pending',$3,$4,3)`,
			[
				id,
				entry.manifest.componentRef,
				entry.manifest.targetSchemaVersion,
				entry.manifest.migrationSetDigest
			]
		)
		await expect(movementComponents(pool, id, catalog)).rejects.toThrow(/ready customer component/)
		expect(
			(await installedComponents(pool, id, catalog))
				.map((candidate) => candidate.manifest.componentRef)
				.sort()
		).toEqual([required.manifest.componentRef, entry.manifest.componentRef].sort())
		await pool.query(
			"UPDATE customer_environment_components SET observed_state='ready' WHERE environment_id=$1 AND component_ref=$2",
			[id, entry.manifest.componentRef]
		)
		expect(
			(await movementComponents(pool, id, catalog))
				.map((candidate) => candidate.manifest.componentRef)
				.sort()
		).toEqual([required.manifest.componentRef, entry.manifest.componentRef].sort())
	})
	test('upgrades changed and externally provisioned installed components', async () => {
		const catalog = await loadCatalog()
		const actor = catalog.get('os.aven:component:actors:run-repository@1')
		const artifacts = catalog.get('ceo.aven:component:data:artifacts@1')
		if (!actor || !artifacts) throw new Error('Component fixture is missing.')
		const id = await workspace()
		await pool.query(
			`INSERT INTO customer_environment_components
			 (environment_id,component_ref,desired_state,observed_state,target_schema_version,
			  observed_schema_version,migration_set_digest,observed_migration_set_digest,routing_generation)
			 VALUES($1,$2,'ready','ready',$3,$3,$4,$4,3),
			       ($1,$5,'ready','ready',$6,$6,$7,$7,3),
			       ($1,$8,'ready','ready',$9,$9,$10,$10,3)`,
			[
				id,
				actor.manifest.componentRef,
				actor.manifest.targetSchemaVersion - 1,
				'0'.repeat(64),
				entry.manifest.componentRef,
				entry.manifest.targetSchemaVersion,
				entry.manifest.migrationSetDigest,
				artifacts.manifest.componentRef,
				artifacts.manifest.targetSchemaVersion,
				artifacts.manifest.migrationSetDigest
			]
		)
		const client = await pool.connect()
		try {
			await client.query('BEGIN')
			const result = await queueInstalledComponentReconciliation(client, id, 'proof', catalog, {
				mode: 'changed'
			})
			await client.query('COMMIT')
			expect(result.operations.map((operation) => operation.componentRef).sort()).toEqual(
				[actor.manifest.componentRef, artifacts.manifest.componentRef].sort()
			)
		} finally {
			client.release()
		}
		expect(
			(
				await pool.query(
					`SELECT component_ref,target_schema_version,migration_set_digest,observed_state
					 FROM customer_environment_components WHERE environment_id=$1 ORDER BY component_ref`,
					[id]
				)
			).rows
		).toEqual([
			{
				component_ref: artifacts.manifest.componentRef,
				target_schema_version: artifacts.manifest.targetSchemaVersion,
				migration_set_digest: artifacts.manifest.migrationSetDigest,
				observed_state: 'pending'
			},
			{
				component_ref: entry.manifest.componentRef,
				target_schema_version: entry.manifest.targetSchemaVersion,
				migration_set_digest: entry.manifest.migrationSetDigest,
				observed_state: 'ready'
			},
			{
				component_ref: actor.manifest.componentRef,
				target_schema_version: actor.manifest.targetSchemaVersion,
				migration_set_digest: actor.manifest.migrationSetDigest,
				observed_state: 'pending'
			}
		])
	})
})
