import { randomUUID } from 'node:crypto'
import type pg from 'pg'
import { z } from 'zod'
import type { ComponentCatalogEntry } from './catalog'

/** Operator-only opt-in. Queue the ordinary provisioner; never run tenant DDL here. */
export async function installOptionalComponent(
	pool: pg.Pool,
	runtimeId: string,
	environmentId: string,
	entry: ComponentCatalogEntry
) {
	z.uuid().parse(environmentId)
	const manifest = entry.manifest
	if (manifest.requiredByDefault || manifest.dependencies.length)
		throw Error('Only independent optional components can be installed with this operation.')
	const client = await pool.connect()
	try {
		await client.query('BEGIN')
		const row = (
			await client.query<{
				runtime_id: string
				routing_generation: string
				desired_state: string
				observed_state: string
				movement_id: string | null
				retired_at: Date | null
				component_catalog: unknown
			}>(
				`SELECT e.runtime_id,e.routing_generation,e.desired_state,e.observed_state,e.movement_id,
		 r.retired_at,r.component_catalog FROM customer_environments e
		 JOIN customer_runtimes r ON r.id=e.runtime_id WHERE e.id=$1 FOR UPDATE OF e,r`,
				[environmentId]
			)
		).rows[0]
		if (
			!row ||
			row.runtime_id !== runtimeId ||
			row.movement_id ||
			row.retired_at ||
			row.desired_state !== 'ready' ||
			row.observed_state !== 'ready'
		)
			throw Error('Workspace must be ready and stationary on this active runtime.')
		if (row.component_catalog !== null) {
			const components = z
				.array(
					z.object({
						componentRef: z.string(),
						targetSchemaVersion: z.number(),
						migrationSetDigest: z.string(),
						requiredByDefault: z.boolean()
					})
				)
				.parse(row.component_catalog)
			if (
				!components.some(
					(c) =>
						c.componentRef === manifest.componentRef &&
						c.targetSchemaVersion === manifest.targetSchemaVersion &&
						c.migrationSetDigest === manifest.migrationSetDigest
				)
			)
				throw Error('The runtime release does not advertise this component version.')
		} else if (runtimeId !== 'primary') throw Error('Runtime catalog is missing.')
		const existing = await client.query(
			`SELECT 1 FROM customer_environment_components WHERE environment_id=$1 AND component_ref=$2`,
			[environmentId, manifest.componentRef]
		)
		if (existing.rowCount) {
			await client.query('COMMIT')
			return { queued: false }
		}
		await client.query(
			`INSERT INTO customer_environment_components
		 (environment_id,component_ref,desired_state,observed_state,target_schema_version,migration_set_digest,routing_generation)
		 VALUES($1,$2,'ready','pending',$3,$4,$5)`,
			[
				environmentId,
				manifest.componentRef,
				manifest.targetSchemaVersion,
				manifest.migrationSetDigest,
				row.routing_generation
			]
		)
		const operationId = randomUUID()
		await client.query(
			`INSERT INTO customer_component_operations
		 (id,environment_id,component_ref,action,status,target_schema_version,migration_set_digest,routing_generation)
		 VALUES($1,$2,$3,'reconcile','queued',$4,$5,$6)`,
			[
				operationId,
				environmentId,
				manifest.componentRef,
				manifest.targetSchemaVersion,
				manifest.migrationSetDigest,
				row.routing_generation
			]
		)
		await client.query('COMMIT')
		return { queued: true, operationId }
	} catch (error) {
		await client.query('ROLLBACK').catch(() => {})
		throw error
	} finally {
		client.release()
	}
}
