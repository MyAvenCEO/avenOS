// The production forced-command dispatcher invokes narrowly scoped operations here.
export {}

// Product provisioning itself has no HTTP endpoint and is driven only by control rows.
if (process.argv[2] === 'catalog') {
	const { catalogDigest, loadCatalog } = await import('./catalog.js')
	const catalog = await loadCatalog()
	console.log(JSON.stringify({ digest: catalogDigest(catalog), components: [...catalog.keys()] }))
} else if (process.argv[2] === 'install-optional' && process.argv.length === 5) {
	const { loadCatalog } = await import('./catalog.js')
	const { loadProvisionerConfig } = await import('./config.js')
	const { installOptionalComponent } = await import('./install-component.js')
	const { default: pg } = await import('pg')
	const config = loadProvisionerConfig()
	const entry = (await loadCatalog()).get(process.argv[4]!)
	if (!entry || entry.manifest.requiredByDefault) throw Error('Unknown optional component.')
	if (
		entry.manifest.componentRef === 'ceo.aven:component:data:credentials@1' &&
		!['SET', 'METADATA', 'MATCH', 'HTTP', 'IMAP'].every((kind) =>
			Boolean((config as Record<string, unknown>)[`CREDENTIAL_${kind}_DB_CREDENTIAL_ROOT`])
		)
	)
		throw Error('All five credential role roots must be configured before installation.')
	const pool = new pg.Pool({ connectionString: config.CONTROL_DATABASE_URL, max: 1 })
	try {
		console.log(
			JSON.stringify(
				await installOptionalComponent(pool, config.CUSTOMER_RUNTIME_ID, process.argv[3]!, entry)
			)
		)
	} finally {
		await pool.end()
	}
} else if (
	(process.argv[2] === 'upgrade-installed' && process.argv.length === 4) ||
	(process.argv[2] === 'upgrade-runtime' && process.argv.length === 3)
) {
	const { loadCatalog } = await import('./catalog.js')
	const { loadProvisionerConfig } = await import('./config.js')
	const { queueInstalledComponentReconciliation } = await import('./movement-components.js')
	const { default: pg } = await import('pg')
	const config = loadProvisionerConfig()
	const catalog = await loadCatalog()
	const pool = new pg.Pool({ connectionString: config.CONTROL_DATABASE_URL, max: 4 })
	try {
		const environmentIds =
			process.argv[2] === 'upgrade-installed'
				? [process.argv[3]!]
				: (
						await pool.query<{ id: string }>(
							"SELECT id FROM customer_environments WHERE runtime_id=$1 AND desired_state='ready' AND movement_id IS NULL ORDER BY id",
							[config.CUSTOMER_RUNTIME_ID]
						)
					).rows.map((row) => row.id)
		const operationIds: string[] = []
		for (const environmentId of environmentIds) {
			const client = await pool.connect()
			try {
				await client.query('BEGIN')
				const { operations } = await queueInstalledComponentReconciliation(
					client,
					environmentId,
					config.CUSTOMER_RUNTIME_ID,
					catalog,
					{ mode: 'changed', installMissingDefaults: true }
				)
				operationIds.push(...operations.map((operation) => operation.id))
				await client.query('COMMIT')
			} catch (error) {
				await client.query('ROLLBACK').catch(() => {})
				throw error
			} finally {
				client.release()
			}
		}
		const deadline = Date.now() + 300_000
		while (operationIds.length && Date.now() < deadline) {
			const states = await pool.query<{ status: string }>(
				'SELECT status FROM customer_component_operations WHERE id=ANY($1::uuid[])',
				[operationIds]
			)
			if (states.rows.some((row) => row.status === 'failed' || row.status === 'unknown'))
				throw new Error('Installed component upgrade failed; inspect the control record.')
			if (
				states.rowCount === operationIds.length &&
				states.rows.every((row) => row.status === 'succeeded')
			)
				break
			await Bun.sleep(250)
		}
		if (operationIds.length) {
			const completed = await pool.query<{ count: string }>(
				"SELECT count(*) FROM customer_component_operations WHERE id=ANY($1::uuid[]) AND status='succeeded'",
				[operationIds]
			)
			if (Number(completed.rows[0]?.count) !== operationIds.length)
				throw new Error('Timed out waiting for installed component upgrades.')
		}
		console.log(
			JSON.stringify({ environments: environmentIds.length, upgrades: operationIds.length })
		)
	} finally {
		await pool.end()
	}
} else {
	console.error('unsupported platform provisioner operation')
	process.exit(2)
}
