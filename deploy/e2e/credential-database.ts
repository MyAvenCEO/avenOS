/** Isolated actual PostgreSQL component fixture. Never accepts a customer database. */
import { randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
import {
	customerComponentCatalog,
	databaseNameForEnvironment,
	databaseRoleName,
	deriveDatabasePassword
} from '../../libs/aven-customer-contracts/src'

export async function credentialDatabase(
	connection: string,
	environmentId: string,
	tenantPools = false
) {
	const base = new URL(connection)
	if (!['127.0.0.1', 'localhost'].includes(base.hostname) || base.pathname !== '/postgres')
		throw Error('Use the isolated local PostgreSQL maintenance database, not customer data.')
	const suffix = randomUUID().replaceAll('-', ''),
		database = tenantPools
			? databaseNameForEnvironment(environmentId)
			: `credential_live_${suffix}`,
		owner = `cred_owner_${suffix}`
	const roles = {
		set: `cred_set_${suffix}`,
		metadata: `cred_meta_${suffix}`,
		http: `cred_http_${suffix}`,
		imap: `cred_imap_${suffix}`
	}
	const pools: Partial<Record<keyof typeof roles, pg.Pool>> = {}
	const roots = {
		set: randomBytes(32).toString('base64url'),
		metadata: randomBytes(32).toString('base64url'),
		http: randomBytes(32).toString('base64url'),
		imap: randomBytes(32).toString('base64url')
	}
	const roleKinds = { set: 'set', metadata: 'metadata', http: 'use-http', imap: 'use-imap' }
	if (tenantPools)
		for (const kind of Object.keys(roles) as Array<keyof typeof roles>)
			roles[kind] = databaseRoleName(
				environmentId,
				kind === 'metadata' ? 'cred_meta' : `cred_${kind}`
			)
	const admin = new pg.Pool({ connectionString: connection })
	let root: pg.Pool | undefined
	let created = false
	const createdRoles: string[] = []
	const close = async () => {
		await Promise.all(Object.values(pools).map((pool) => pool.end()))
		await root?.end()
		try {
			if (created) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`)
			for (const role of createdRoles) await admin.query(`DROP ROLE IF EXISTS ${role}`)
		} finally {
			await admin.end()
		}
	}
	try {
		await admin.query(`CREATE DATABASE ${database}`)
		created = true
		const target = new URL(base)
		target.pathname = `/${database}`
		root = new pg.Pool({ connectionString: target.toString() })
		await root.query(`CREATE ROLE ${owner} NOLOGIN`)
		createdRoles.push(owner)
		await root.query(`CREATE SCHEMA aven_platform;
      CREATE TABLE aven_platform.environment_identity(singleton boolean PRIMARY KEY,environment_id uuid NOT NULL,routing_generation bigint NOT NULL,execution_enabled boolean NOT NULL DEFAULT true,execution_unsettled uuid[] NOT NULL DEFAULT '{}');
      CREATE SCHEMA aven_credentials AUTHORIZATION ${owner}; GRANT USAGE ON SCHEMA aven_platform TO ${owner};
      GRANT SELECT,UPDATE(execution_unsettled) ON aven_platform.environment_identity TO ${owner}`)
		await root.query(
			'INSERT INTO aven_platform.environment_identity(singleton,environment_id,routing_generation) VALUES(true,$1,1)',
			[environmentId]
		)
		if (tenantPools) {
			const component = customerComponentCatalog.find(
				(c) => c.componentRef === 'ceo.aven:component:data:credentials@1'
			)!
			await root.query(
				'CREATE TABLE aven_platform.component_installations(component_ref text PRIMARY KEY,schema_version integer NOT NULL,migration_set_digest text NOT NULL,routing_generation bigint NOT NULL)'
			)
			await root.query('INSERT INTO aven_platform.component_installations VALUES($1,$2,$3,1)', [
				component.componentRef,
				component.targetSchemaVersion,
				component.migrationSetDigest
			])
		}
		const migration = await readFile(
			new URL(
				'../../services/platform-provisioner/components/credentials/0001_credentials.sql',
				import.meta.url
			),
			'utf8'
		)
		const client = await root.connect()
		try {
			await client.query(`SET ROLE ${owner}`)
			await client.query(migration)
			await client.query('RESET ROLE')
		} finally {
			client.release()
		}
		const grants = {
			set: ['admin_command(uuid,uuid,bigint,uuid,jsonb)', 'command_receipt(uuid,uuid,bigint,uuid)'],
			metadata: ['metadata(uuid,uuid,bigint)'],
			http: [
				'claim_http(jsonb,int,text)',
				'finish_http(uuid,uuid,uuid,int,text,text)',
				'settle_http(uuid,uuid,uuid)'
			],
			imap: [
				'claim_imap(jsonb,int,text)',
				'finish_imap(uuid,uuid,uuid,int,text,text)',
				'settle_imap(uuid,uuid,uuid)'
			]
		}
		for (const kind of Object.keys(roles) as Array<keyof typeof roles>) {
			const password = tenantPools
				? deriveDatabasePassword({
						root: roots[kind],
						environmentId,
						routingGeneration: 1,
						roleKind: `ceo.aven:db-role:credentials:${roleKinds[kind]}@1`
					})
				: randomUUID()
			await root.query(`CREATE ROLE ${roles[kind]} LOGIN PASSWORD '${password}'`)
			createdRoles.push(roles[kind])
			await root.query(`GRANT USAGE ON SCHEMA aven_credentials TO ${roles[kind]}`)
			if (tenantPools)
				await root.query(
					`GRANT USAGE ON SCHEMA aven_platform TO ${roles[kind]}; GRANT SELECT ON aven_platform.component_installations TO ${roles[kind]}`
				)
			for (const fn of grants[kind])
				await root.query(`GRANT EXECUTE ON FUNCTION aven_credentials.${fn} TO ${roles[kind]}`)
			const login = new URL(target)
			login.username = roles[kind]
			login.password = password
			pools[kind] = new pg.Pool({ connectionString: login.toString(), max: 2 })
		}
		return {
			roots,
			unsettled: async () =>
				Number(
					(
						await root!.query(
							'SELECT cardinality(execution_unsettled) AS count FROM aven_platform.environment_identity'
						)
					).rows[0].count
				),
			pools: pools as Record<keyof typeof roles, pg.Pool>,
			databaseUrl: target.toString(),
			close
		}
	} catch (error) {
		await close()
		throw error
	}
}
