export interface EnvironmentProvisionInput {
	provisionerUrl: string
	databaseName: string
	ownerRole: string
	artifactStore?: {
		provisionerBaseUrl: string
		bearerToken: string
		runtimeRole: string
		scopeId: string
	}
	artifactProcessor?: {
		provisionerBaseUrl: string
		bearerToken: string
		runtimeRole: string
		scopeId: string
	}
	log: { info(message: string): Promise<void> | void }
}

export const CURRENT_ARTIFACT_STORE_SCHEMA_VERSION = 3
export const CURRENT_ARTIFACT_PROCESSOR_SCHEMA_VERSION = 4

const DATABASE_NAME = /^cust_[a-z0-9_]+$/
const ROLE_NAME = /^[a-z][a-z0-9_]{0,62}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function validateIdentifier(value: string, pattern: RegExp, label: string): void {
	if (value.length > 63 || !pattern.test(value)) throw new Error(`${label} is invalid.`)
}

function validateDatabaseName(databaseName: string): void {
	validateIdentifier(databaseName, DATABASE_NAME, 'Customer database name')
}

function validateRoleName(role: string, label: string): void {
	validateIdentifier(role, ROLE_NAME, label)
}

async function openProvisioner(connectionString: string) {
	const { default: postgres } = await import('pg')
	const client = new postgres.Client({
		connectionString,
		connectionTimeoutMillis: 10_000,
		query_timeout: 65_000,
		statement_timeout: 60_000,
		options: '-c lock_timeout=10s'
	})
	client.on('error', () => {})
	await client.connect()
	return client
}

async function assertSafeRuntimeRole(
	cluster: Awaited<ReturnType<typeof openProvisioner>>,
	runtimeRole: string,
	label = 'Artifact Store runtime'
): Promise<boolean> {
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
		throw new Error(`Existing ${label} role ${runtimeRole} has unsafe attributes.`)
	}
	if (
		runtime &&
		(
			await cluster.query(
				`SELECT 1 FROM pg_auth_members membership
				 JOIN pg_roles member_role ON member_role.oid=membership.member
				 WHERE member_role.rolname=$1 LIMIT 1`,
				[runtimeRole]
			)
		).rowCount
	) {
		throw new Error(`Existing ${label} role ${runtimeRole} has unsafe memberships.`)
	}
	return Boolean(runtime)
}

export async function ensureArtifactRuntimeRole(input: {
	provisionerUrl: string
	runtimeRole: string
	runtimePassword: string
	log: { info(message: string): Promise<void> | void }
}): Promise<void> {
	validateRoleName(input.runtimeRole, 'Artifact Store runtime role')
	const cluster = await openProvisioner(input.provisionerUrl)
	try {
		if (!(await assertSafeRuntimeRole(cluster, input.runtimeRole))) {
			await input.log.info(`Create Artifact Store runtime role ${input.runtimeRole}.`)
			await cluster.query(
				`CREATE ROLE "${input.runtimeRole}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION`
			)
		}
		const passwordLiteral = String(
			(await cluster.query('SELECT quote_literal($1) AS value', [input.runtimePassword])).rows[0]
				?.value ?? ''
		)
		if (!passwordLiteral) throw new Error('Could not encode Artifact Store runtime credential.')
		await cluster.query(`ALTER ROLE "${input.runtimeRole}" PASSWORD ${passwordLiteral}`)
		await cluster.query(
			'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename=$1 AND pid <> pg_backend_pid()',
			[input.runtimeRole]
		)
	} finally {
		await cluster.end()
	}
}

export async function ensureProcessorRuntimeRole(input: {
	provisionerUrl: string
	runtimeRole: string
	runtimePassword: string
	log: { info(message: string): Promise<void> | void }
}): Promise<void> {
	validateRoleName(input.runtimeRole, 'Artifact Processor runtime role')
	const cluster = await openProvisioner(input.provisionerUrl)
	try {
		if (!(await assertSafeRuntimeRole(cluster, input.runtimeRole, 'Artifact Processor runtime'))) {
			await input.log.info(`Create Artifact Processor runtime role ${input.runtimeRole}.`)
			await cluster.query(
				`CREATE ROLE "${input.runtimeRole}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION`
			)
		}
		const passwordLiteral = String(
			(await cluster.query('SELECT quote_literal($1) AS value', [input.runtimePassword])).rows[0]
				?.value ?? ''
		)
		if (!passwordLiteral) throw new Error('Could not encode Artifact Processor credential.')
		await cluster.query(`ALTER ROLE "${input.runtimeRole}" PASSWORD ${passwordLiteral}`)
		await cluster.query(
			' SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename=$1 AND pid <> pg_backend_pid()',
			[input.runtimeRole]
		)
	} finally {
		await cluster.end()
	}
}

export async function provisionEnvironmentDatabase(
	input: EnvironmentProvisionInput
): Promise<void> {
	validateDatabaseName(input.databaseName)
	validateRoleName(input.ownerRole, 'Customer owner role')
	if (input.artifactStore) {
		validateRoleName(input.artifactStore.runtimeRole, 'Artifact Store runtime role')
		if (!UUID.test(input.artifactStore.scopeId)) throw new Error('Artifact Store scope is invalid.')
	}
	if (input.artifactProcessor) {
		validateRoleName(input.artifactProcessor.runtimeRole, 'Artifact Processor runtime role')
		if (!UUID.test(input.artifactProcessor.scopeId))
			throw new Error('Artifact Processor scope is invalid.')
	}
	const cluster = await openProvisioner(input.provisionerUrl)
	try {
		await cluster.query("SELECT pg_advisory_lock(hashtext('customer-environment:' || $1))", [
			input.databaseName
		])
		const role = (
			await cluster.query(
				'SELECT rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication FROM pg_roles WHERE rolname=$1',
				[input.ownerRole]
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
			role &&
			(role.rolcanlogin ||
				role.rolsuper ||
				role.rolcreatedb ||
				role.rolcreaterole ||
				role.rolreplication)
		) {
			throw new Error(`Existing owner role ${input.ownerRole} has unsafe attributes.`)
		}
		if (
			role &&
			(
				await cluster.query(
					`SELECT 1 FROM pg_auth_members membership
					 JOIN pg_roles member_role ON member_role.oid=membership.member
					 WHERE member_role.rolname=$1 LIMIT 1`,
					[input.ownerRole]
				)
			).rowCount
		) {
			throw new Error(`Existing owner role ${input.ownerRole} has unsafe memberships.`)
		}
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
			if (!(await assertSafeRuntimeRole(cluster, runtimeRole))) {
				throw new Error(`Artifact Store runtime role ${runtimeRole} is not initialized.`)
			}
			await cluster.query(`GRANT CONNECT ON DATABASE "${input.databaseName}" TO "${runtimeRole}"`)
		}
		if (input.artifactProcessor) {
			const runtimeRole = input.artifactProcessor.runtimeRole
			if (!(await assertSafeRuntimeRole(cluster, runtimeRole, 'Artifact Processor runtime'))) {
				throw new Error(`Artifact Processor runtime role ${runtimeRole} is not initialized.`)
			}
			await cluster.query(`GRANT CONNECT ON DATABASE "${input.databaseName}" TO "${runtimeRole}"`)
		}
	} finally {
		await cluster.end()
	}

	const tenantUrl = new URL(input.provisionerUrl)
	tenantUrl.pathname = `/${input.databaseName}`
	const tenant = await openProvisioner(tenantUrl.toString())
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
	if (input.artifactProcessor) {
		const endpoint = new URL(input.artifactProcessor.provisionerBaseUrl)
		endpoint.pathname = `/internal/v1/databases/${encodeURIComponent(input.databaseName)}/scopes/${encodeURIComponent(input.artifactProcessor.scopeId)}`
		const response = await fetch(endpoint, {
			method: 'PUT',
			headers: { authorization: `Bearer ${input.artifactProcessor.bearerToken}` },
			signal: AbortSignal.timeout(60_000)
		})
		if (!response.ok) {
			await response.body?.cancel().catch(() => {})
			throw new Error(`Artifact Processor provisioning failed with HTTP ${response.status}.`)
		}
		await input.log.info(`Artifact Processor scope ${input.artifactProcessor.scopeId} ready.`)
	}
	await input.log.info(`Database ${input.databaseName} ready.`)
}

export async function suspendEnvironmentDatabase(input: {
	provisionerUrl: string
	databaseName: string
	runtimeRole?: string
	runtimeRoles?: string[]
	log: { info(message: string): Promise<void> | void }
}): Promise<void> {
	const runtimeRoles = [
		...new Set([...(input.runtimeRoles ?? []), ...(input.runtimeRole ? [input.runtimeRole] : [])])
	]
	if (runtimeRoles.length === 0) {
		await input.log.info('Environment suspended. No customer-data runtime is configured.')
		return
	}
	validateDatabaseName(input.databaseName)
	for (const runtimeRole of runtimeRoles)
		validateRoleName(runtimeRole, 'Customer-data runtime role')
	const cluster = await openProvisioner(input.provisionerUrl)
	try {
		const databaseExists = Boolean(
			(await cluster.query('SELECT 1 FROM pg_database WHERE datname=$1', [input.databaseName]))
				.rowCount
		)
		if (!databaseExists) {
			await input.log.info('Environment suspended; the customer database does not exist.')
			return
		}
		for (const runtimeRole of runtimeRoles) {
			const roleExists = Boolean(
				(await cluster.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [runtimeRole])).rowCount
			)
			if (!roleExists) continue
			await cluster.query(
				`REVOKE CONNECT ON DATABASE "${input.databaseName}" FROM "${runtimeRole}"`
			)
			await cluster.query(
				'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND usename=$2 AND pid <> pg_backend_pid()',
				[input.databaseName, runtimeRole]
			)
		}
	} finally {
		await cluster.end()
	}
	await input.log.info('Environment suspended and customer-data runtime connections revoked.')
}
