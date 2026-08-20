export interface EnvironmentProvisionInput {
	provisionerUrl: string
	databaseName: string
	ownerRole: string
	log: { info(message: string): Promise<void> | void }
}

export async function provisionEnvironmentDatabase(
	input: EnvironmentProvisionInput
): Promise<void> {
	const { default: postgres } = await import('pg')
	const cluster = new postgres.Client({ connectionString: input.provisionerUrl })
	cluster.on('error', () => {})
	await cluster.connect()
	try {
		await cluster.query("SELECT pg_advisory_lock(hashtext('customer-environment:' || $1))", [
			input.databaseName
		])
		const role = (
			await cluster.query('SELECT rolcanlogin FROM pg_roles WHERE rolname=$1', [input.ownerRole])
		).rows[0] as { rolcanlogin: boolean } | undefined
		if (role?.rolcanlogin) throw new Error(`Existing owner role ${input.ownerRole} permits login.`)
		if (!role) {
			await input.log.info(`Create owner role ${input.ownerRole}.`)
			await cluster.query(`CREATE ROLE "${input.ownerRole}" NOLOGIN`)
		}
		await cluster.query(`GRANT "${input.ownerRole}" TO CURRENT_USER WITH SET TRUE`)

		const database = (
			await cluster.query(
				'SELECT owner.rolname AS owner FROM pg_database db JOIN pg_roles owner ON owner.oid=db.datdba WHERE db.datname=$1',
				[input.databaseName]
			)
		).rows[0] as { owner: string } | undefined
		if (database && database.owner !== input.ownerRole)
			throw new Error(`Existing database ${input.databaseName} has a different owner.`)
		if (!database) {
			await input.log.info(`Create database ${input.databaseName}.`)
			await cluster.query(`CREATE DATABASE "${input.databaseName}" OWNER "${input.ownerRole}"`)
		}
		await cluster.query(`REVOKE CONNECT ON DATABASE "${input.databaseName}" FROM PUBLIC`)
		await cluster.query(`GRANT CONNECT ON DATABASE "${input.databaseName}" TO CURRENT_USER`)
	} finally {
		await cluster.end()
	}

	const tenantUrl = new URL(input.provisionerUrl)
	tenantUrl.pathname = `/${input.databaseName}`
	const tenant = new (await import('pg')).default.Client({ connectionString: tenantUrl.toString() })
	tenant.on('error', () => {})
	await tenant.connect()
	try {
		const current = String(
			(await tenant.query('SELECT current_database() AS name')).rows[0]?.name ?? ''
		)
		if (current !== input.databaseName) throw new Error('Customer database readiness check failed.')
	} finally {
		await tenant.end()
	}
	await input.log.info(`Database ${input.databaseName} ready.`)
}
