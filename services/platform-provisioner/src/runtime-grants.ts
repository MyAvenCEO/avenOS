import { quoteIdentifier } from '@avenos/aven-customer-contracts'
import type pg from 'pg'

/** Closed, built-in argument types: catalog data is never an SQL signature fragment. */
const argumentTypes = new Set([
	'uuid',
	'text',
	'int4',
	'int8',
	'bool',
	'jsonb',
	'bytea',
	'timestamptz'
])
export interface FunctionGrant {
	name: string
	argumentTypes: Array<
		'uuid' | 'text' | 'int4' | 'int8' | 'bool' | 'jsonb' | 'bytea' | 'timestamptz'
	>
}
export interface RuntimeGrants {
	tables: Array<{ name: string; privileges: string[] }>
	functions?: FunctionGrant[]
}

export function functionSignature(schema: string, fn: FunctionGrant): string {
	if (fn.argumentTypes.some((type) => !argumentTypes.has(type)))
		throw new Error('unsupported catalog function argument type')
	return `${quoteIdentifier(schema)}.${quoteIdentifier(fn.name)}(${fn.argumentTypes.map((type) => `pg_catalog.${type}`).join(',')})`
}

/** Call as the component owner. Functions must explicitly revoke PUBLIC in their migration. */
export async function grantRuntimeAccess(
	client: Pick<pg.PoolClient, 'query'>,
	schema: string,
	role: string,
	grants: RuntimeGrants
): Promise<void> {
	for (const table of grants.tables) {
		if (
			!table.privileges.length ||
			table.privileges.some((value) => !['SELECT', 'INSERT', 'UPDATE', 'DELETE'].includes(value))
		)
			throw new Error('unsupported catalog table privilege')
		await client.query(
			`GRANT ${table.privileges.join(',')} ON TABLE ${quoteIdentifier(schema)}.${quoteIdentifier(table.name)} TO ${quoteIdentifier(role)}`
		)
	}
	for (const fn of grants.functions ?? [])
		await client.query(
			`GRANT EXECUTE ON FUNCTION ${functionSignature(schema, fn)} TO ${quoteIdentifier(role)}`
		)
}

/** Verify as the actual runtime login without invoking mutators or reading secret rows. */
export async function verifyRuntimeAccess(
	client: Pick<pg.Pool, 'query'>,
	schema: string,
	grants: RuntimeGrants
): Promise<void> {
	for (const table of grants.tables) {
		for (const privilege of table.privileges) {
			const row = (
				await client.query<{ allowed: boolean }>(
					'SELECT pg_catalog.has_table_privilege(current_user,$1,$2) AS allowed',
					[`${quoteIdentifier(schema)}.${quoteIdentifier(table.name)}`, privilege]
				)
			).rows[0]
			if (!row?.allowed) throw new Error('runtime table privilege verification failed')
		}
	}
	for (const fn of grants.functions ?? []) {
		const row = (
			await client.query<{ allowed: boolean }>(
				"SELECT pg_catalog.has_function_privilege(current_user,$1,'EXECUTE') AS allowed",
				[functionSignature(schema, fn)]
			)
		).rows[0]
		if (!row?.allowed) throw new Error('runtime function privilege verification failed')
	}
}
