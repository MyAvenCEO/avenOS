export interface EnvironmentProvisionInput {
	provisionerUrl: string
	databaseName: string
	ownerRole: string
	artifactStore?: {
		provisionerBaseUrl: string
		bearerToken: string
		runtimeRole: string
		runtimePassword: string
		scopeId: string
	}
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
		if (input.artifactStore) {
			const runtimeRole = input.artifactStore.runtimeRole
			if (!/^[a-z][a-z0-9_]{0,62}$/.test(runtimeRole)) {
				throw new Error('Artifact Store runtime role is invalid.')
			}
			const runtime = (
				await cluster.query(
					'SELECT rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication FROM pg_roles WHERE rolname=$1',
					[runtimeRole]
				)
			).rows[0] as
				| {
						rolcanlogin: boolean
						rolsuper: boolean
						rolcreatedb: boolean
						rolcreaterole: boolean
						rolreplication: boolean
				  }
				| undefined
			if (
				runtime &&
				(!runtime.rolcanlogin ||
					runtime.rolsuper ||
					runtime.rolcreatedb ||
					runtime.rolcreaterole ||
					runtime.rolreplication)
			) {
				throw new Error(`Existing Artifact Store role ${runtimeRole} has unsafe attributes.`)
			}
			if (!runtime) {
				await input.log.info(`Create Artifact Store runtime role ${runtimeRole}.`)
				await cluster.query(
					`CREATE ROLE "${runtimeRole}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION`
				)
			}
			const passwordLiteral = String(
				(
					await cluster.query('SELECT quote_literal($1) AS value', [
						input.artifactStore.runtimePassword
					])
				).rows[0]?.value ?? ''
			)
			if (!passwordLiteral) throw new Error('Could not encode Artifact Store runtime credential.')
			await cluster.query(`ALTER ROLE "${runtimeRole}" PASSWORD ${passwordLiteral}`)
			await cluster.query(`GRANT CONNECT ON DATABASE "${input.databaseName}" TO "${runtimeRole}"`)
		}
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

	if (input.artifactStore) {
		const endpoint = new URL(input.artifactStore.provisionerBaseUrl)
		endpoint.pathname = `/internal/v1/databases/${encodeURIComponent(input.databaseName)}/scopes/${encodeURIComponent(input.artifactStore.scopeId)}`
		const response = await fetch(endpoint, {
			method: 'PUT',
			headers: { authorization: `Bearer ${input.artifactStore.bearerToken}` },
			signal: AbortSignal.timeout(60_000)
		})
		if (!response.ok) {
			await response.body?.cancel().catch(() => {})
			throw new Error(`Artifact Store provisioning failed with HTTP ${response.status}.`)
		}
		await input.log.info(`Artifact Store scope ${input.artifactStore.scopeId} ready.`)
	}
	await input.log.info(`Database ${input.databaseName} ready.`)
}

export async function suspendEnvironmentDatabase(input: {
	provisionerUrl: string
	databaseName: string
	runtimeRole?: string
	log: { info(message: string): Promise<void> | void }
}): Promise<void> {
	if (!input.runtimeRole) {
		await input.log.info('Environment suspended. No Artifact Store runtime is configured.')
		return
	}
	if (!/^[a-z][a-z0-9_]{0,62}$/.test(input.runtimeRole)) {
		throw new Error('Artifact Store runtime role is invalid.')
	}
	const cluster = new (await import('pg')).default.Client({
		connectionString: input.provisionerUrl
	})
	cluster.on('error', () => {})
	await cluster.connect()
	try {
		await cluster.query(
			`REVOKE CONNECT ON DATABASE "${input.databaseName}" FROM "${input.runtimeRole}"`
		)
		await cluster.query(
			'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND usename=$2 AND pid <> pg_backend_pid()',
			[input.databaseName, input.runtimeRole]
		)
	} finally {
		await cluster.end()
	}
	await input.log.info('Environment suspended and Artifact Store connections revoked.')
}
