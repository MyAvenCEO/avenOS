import type pg from 'pg'
import type { ComponentCatalogEntry } from './catalog.js'
import { type QueuedComponentOperation, queueCustomerReconciliation } from './control.js'

/** Resolve explicit customer installations; a runtime catalog is not an opt-in list. */
export async function installedComponents(
	control: Pick<pg.Pool, 'query'>,
	environmentId: string,
	catalog: ReadonlyMap<string, ComponentCatalogEntry>
): Promise<ComponentCatalogEntry[]> {
	const { rows } = await control.query<{
		component_ref: string
		desired_state: string
		observed_state: string
	}>(
		'SELECT component_ref,desired_state,observed_state FROM customer_environment_components WHERE environment_id=$1',
		[environmentId]
	)
	if (!rows.length || rows.some((row) => row.desired_state !== 'ready'))
		throw new Error('Customer component installation is not eligible for reconciliation.')
	const installed = new Set(rows.map((row) => row.component_ref))
	if (rows.some((row) => !catalog.has(row.component_ref)))
		throw new Error('Runtime catalog does not contain every installed customer component.')
	return [...catalog.values()].filter((entry) => installed.has(entry.manifest.componentRef))
}

/** Moving a database additionally requires every installed capability to be settled. */
export async function movementComponents(
	control: Pick<pg.Pool, 'query'>,
	environmentId: string,
	catalog: ReadonlyMap<string, ComponentCatalogEntry>
): Promise<ComponentCatalogEntry[]> {
	const entries = await installedComponents(control, environmentId, catalog)
	const { rows } = await control.query<{ observed_state: string }>(
		'SELECT observed_state FROM customer_environment_components WHERE environment_id=$1',
		[environmentId]
	)
	if (rows.some((row) => row.observed_state !== 'ready'))
		throw new Error('Movement requires a ready customer component installation.')
	return entries
}

/**
 * Align a customer's components with the running catalog. Runtime upgrades may add
 * newly required defaults, but a catalog entry alone is never consent to install an
 * optional component.
 */
export async function queueInstalledComponentReconciliation(
	client: Pick<pg.PoolClient, 'query'>,
	environmentId: string,
	runtimeId: string,
	catalog: ReadonlyMap<string, ComponentCatalogEntry>,
	options: { mode?: 'all' | 'changed'; installMissingDefaults?: boolean } = {}
): Promise<{ entries: ComponentCatalogEntry[]; operations: QueuedComponentOperation[] }> {
	const environment = (
		await client.query<{
			runtime_id: string
			routing_generation: string
			desired_state: string
			movement_id: string | null
		}>(
			`SELECT runtime_id,routing_generation,desired_state,movement_id FROM customer_environments
			 WHERE id=$1 FOR UPDATE`,
			[environmentId]
		)
	).rows[0]
	if (
		!environment ||
		environment.runtime_id !== runtimeId ||
		environment.desired_state !== 'ready' ||
		environment.movement_id
	)
		throw new Error('Customer must be ready and stationary on this runtime.')
	if (options.installMissingDefaults) {
		for (const entry of catalog.values()) {
			if (!entry.manifest.requiredByDefault) continue
			await client.query(
				`INSERT INTO customer_environment_components
				 (environment_id,component_ref,desired_state,observed_state,target_schema_version,
				  migration_set_digest,routing_generation)
				 VALUES($1,$2,'ready','pending',$3,$4,$5)
				 ON CONFLICT(environment_id,component_ref) DO NOTHING`,
				[
					environmentId,
					entry.manifest.componentRef,
					entry.manifest.targetSchemaVersion,
					entry.manifest.migrationSetDigest,
					environment.routing_generation
				]
			)
		}
	}

	const entries = await installedComponents(client, environmentId, catalog)
	const changed: string[] = []
	for (const entry of entries) {
		const result = await client.query(
			`UPDATE customer_environment_components SET
			 target_schema_version=$3,migration_set_digest=$4,
			 observed_state=CASE
			   WHEN target_schema_version IS DISTINCT FROM $3 OR migration_set_digest IS DISTINCT FROM $4
			   THEN 'pending' ELSE observed_state END,
			 last_error=CASE
			   WHEN target_schema_version IS DISTINCT FROM $3 OR migration_set_digest IS DISTINCT FROM $4
			   THEN NULL ELSE last_error END,
			 updated_at=clock_timestamp()
			 WHERE environment_id=$1 AND component_ref=$2 AND desired_state='ready'
			 RETURNING component_ref`,
			[
				environmentId,
				entry.manifest.componentRef,
				entry.manifest.targetSchemaVersion,
				entry.manifest.migrationSetDigest
			]
		)
		if (!result.rowCount)
			throw new Error('Installed customer component disappeared during reconciliation.')
		// RETURNING sees the new values, so compare the observed installation with the target as well.
		const observed = await client.query<{ needs_reconciliation: boolean }>(
			`SELECT observed_state<>'ready'
			 OR observed_schema_version IS DISTINCT FROM target_schema_version
			 OR observed_migration_set_digest IS DISTINCT FROM migration_set_digest AS needs_reconciliation
			 FROM customer_environment_components WHERE environment_id=$1 AND component_ref=$2`,
			[environmentId, entry.manifest.componentRef]
		)
		if (observed.rows[0]?.needs_reconciliation) changed.push(entry.manifest.componentRef)
	}

	// SQL schema/version metadata cannot describe state owned by an external
	// provisioner. Re-run those idempotent provisioners during every explicit
	// runtime upgrade so additions to (for example) the Artifact Store type
	// catalog cannot leave an existing workspace falsely marked ready.
	const selected =
		(options.mode ?? 'all') === 'all'
			? entries.map((entry) => entry.manifest.componentRef)
			: entries
					.filter(
						(entry) =>
							changed.includes(entry.manifest.componentRef) ||
							entry.externalProvisioner !== undefined
					)
					.map((entry) => entry.manifest.componentRef)
	const operations = await queueCustomerReconciliation(client, environmentId, selected)
	if (operations.length) {
		await client.query(
			`UPDATE customer_environment_components SET observed_state='pending',last_error=NULL,
			 updated_at=clock_timestamp() WHERE environment_id=$1 AND component_ref=ANY($2::text[])`,
			[environmentId, operations.map((operation) => operation.componentRef)]
		)
		await client.query(
			`UPDATE customer_environments SET observed_state='reconciling',last_error=NULL,
			 updated_at=clock_timestamp() WHERE id=$1`,
			[environmentId]
		)
	}
	return { entries, operations }
}
