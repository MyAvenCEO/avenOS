import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
	type CustomerComponentManifest,
	customerComponentCatalog,
	customerComponentManifestSchema
} from '@avenos/aven-customer-contracts'
import type { FunctionGrant, RuntimeGrants } from './runtime-grants.js'

export interface ComponentCatalogEntry {
	manifest: CustomerComponentManifest
	migrations: { id: string; sql: string; digest: string }[]
	grants: Record<string, RuntimeGrants>
	externalProvisioner?: 'artifact-store'
	verifyTable?: string
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

async function entry(input: {
	folder: string
	componentRef: string
	schema: string
	ownerRoleSuffix: string
	targetSchemaVersion?: number
	migrationFiles?: Array<{ id: string; candidates: string[] }>
	externalProvisioner?: 'artifact-store'
	verifyTable?: string
	functionRoles: {
		kind: string
		roleSuffix: string
		tables: Array<string | { name: string; privileges: string[] }>
		functions?: FunctionGrant[]
	}[]
}): Promise<ComponentCatalogEntry> {
	const defaultId = `0001_${input.folder.replaceAll('-', '_')}`
	const migrationFiles = input.migrationFiles ?? [
		{
			id: defaultId,
			candidates: [resolve(process.cwd(), 'components', input.folder, `${defaultId}.sql`)]
		}
	]
	const migrations = await Promise.all(
		migrationFiles.map(async (migration) => {
			let sql: string | undefined
			for (const candidate of migration.candidates) {
				try {
					sql = await readFile(candidate, 'utf8')
					break
				} catch {}
			}
			if (sql === undefined) throw new Error(`migration source is absent: ${migration.id}`)
			return { id: migration.id, sql, digest: sha256(sql) }
		})
	)
	const migrationSetDigest = sha256(
		migrations.map((migration) => `${migration.id}\0${migration.digest}`).join('\n')
	)
	const pinned = customerComponentCatalog.find((value) => value.componentRef === input.componentRef)
	if (!pinned || pinned.migrationSetDigest !== migrationSetDigest)
		throw new Error(`component catalog digest is not pinned for ${input.componentRef}`)
	const manifest = customerComponentManifestSchema.parse({
		componentRef: input.componentRef,
		contractVersion: 1,
		schema: input.schema,
		targetSchemaVersion: input.targetSchemaVersion ?? 1,
		migrationSetDigest: pinned.migrationSetDigest,
		minimumRuntimeSchemaVersion: pinned.minimumRuntimeSchemaVersion,
		maximumRuntimeSchemaVersion: input.targetSchemaVersion ?? 1,
		ownerRoleSuffix: input.ownerRoleSuffix,
		functionRoles: input.functionRoles.map((role) => ({
			kind: role.kind,
			roleSuffix: role.roleSuffix,
			grantsFile: `grants/${role.roleSuffix.replaceAll('_', '-')}.sql`,
			connectionLimit: 4
		})),
		dependencies: [],
		requiredByDefault: pinned.requiredByDefault
	})
	return {
		manifest,
		migrations,
		grants: Object.fromEntries(
			input.functionRoles.map((role) => [
				role.kind,
				{
					tables: role.tables.map((table) =>
						typeof table === 'string'
							? { name: table, privileges: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] }
							: table
					),
					...(role.functions && { functions: role.functions })
				}
			])
		),
		...(input.externalProvisioner && { externalProvisioner: input.externalProvisioner }),
		...(input.verifyTable && { verifyTable: input.verifyTable })
	}
}

export async function loadCatalog(): Promise<Map<string, ComponentCatalogEntry>> {
	const artifactMigration = (id: string) => ({
		id,
		candidates: [
			resolve(process.cwd(), 'artifact-migrations', `${id}.sql`),
			resolve(
				process.cwd(),
				'..',
				'artifact-store',
				'crates',
				'postgres',
				'migrations',
				`${id}.sql`
			)
		]
	})
	const entries = await Promise.all([
		entry({
			folder: 'credentials',
			componentRef: 'ceo.aven:component:data:credentials@1',
			schema: 'aven_credentials',
			ownerRoleSuffix: 'cred_owner',
			functionRoles: [
				{
					kind: 'ceo.aven:db-role:credentials:set@1',
					roleSuffix: 'cred_set',
					tables: [],
					functions: [
						{ name: 'admin_command', argumentTypes: ['uuid', 'uuid', 'int8', 'uuid', 'jsonb'] },
						{ name: 'command_receipt', argumentTypes: ['uuid', 'uuid', 'int8', 'uuid'] }
					]
				},
				{
					kind: 'ceo.aven:db-role:credentials:metadata@1',
					roleSuffix: 'cred_meta',
					tables: [],
					functions: [{ name: 'metadata', argumentTypes: ['uuid', 'uuid', 'int8'] }]
				},
				{
					kind: 'ceo.aven:db-role:credentials:match@1',
					roleSuffix: 'cred_match',
					tables: [],
					functions: [{ name: 'metadata', argumentTypes: ['uuid', 'uuid', 'int8'] }]
				},
				{
					kind: 'ceo.aven:db-role:credentials:use-http@1',
					roleSuffix: 'cred_http',
					tables: [],
					functions: [
						{ name: 'claim_http', argumentTypes: ['jsonb', 'int4', 'text'] },
						{
							name: 'finish_http',
							argumentTypes: ['uuid', 'uuid', 'uuid', 'int4', 'text', 'text']
						},
						{ name: 'settle_http', argumentTypes: ['uuid', 'uuid', 'uuid'] }
					]
				},
				{
					kind: 'ceo.aven:db-role:credentials:use-imap@1',
					roleSuffix: 'cred_imap',
					tables: [],
					functions: [
						{ name: 'claim_imap', argumentTypes: ['jsonb', 'int4', 'text'] },
						{
							name: 'finish_imap',
							argumentTypes: ['uuid', 'uuid', 'uuid', 'int4', 'text', 'text']
						},
						{ name: 'settle_imap', argumentTypes: ['uuid', 'uuid', 'uuid'] }
					]
				}
			]
		}),
		entry({
			folder: 'productivity',
			componentRef: 'ceo.aven:component:data:productivity@1',
			schema: 'aven_productivity',
			ownerRoleSuffix: 'prod_owner',
			functionRoles: [
				{
					kind: 'ceo.aven:db-role:productivity:api@1',
					roleSuffix: 'prod_api',
					tables: [
						{ name: 'tasks', privileges: ['SELECT', 'INSERT', 'UPDATE'] },
						{ name: 'task_commands', privileges: ['SELECT', 'INSERT'] },
						{ name: 'task_revisions', privileges: ['SELECT', 'INSERT'] }
					]
				}
			]
		}),
		entry({
			folder: 'artifacts',
			componentRef: 'ceo.aven:component:data:artifacts@1',
			schema: 'artifact_store',
			ownerRoleSuffix: 'art_owner',
			targetSchemaVersion: 4,
			migrationFiles: [
				artifactMigration('0001_core'),
				artifactMigration('0002_upload_cleanup'),
				artifactMigration('0003_intent_declaration_catalog'),
				artifactMigration('0004_library_indexes')
			],
			externalProvisioner: 'artifact-store',
			verifyTable: 'store_state',
			functionRoles: [
				{
					kind: 'ceo.aven:db-role:artifacts:api@1',
					roleSuffix: 'art_api',
					tables: []
				}
			]
		}),
		entry({
			folder: 'intents',
			targetSchemaVersion: 4,
			migrationFiles: [
				'0001_intents',
				'0002_input_admission',
				'0003_turn_supervision',
				'0004_input_replacements'
			].map((id) => ({
				id,
				candidates: [resolve(process.cwd(), 'components', 'intents', `${id}.sql`)]
			})),
			componentRef: 'ceo.aven:component:data:intents@1',
			schema: 'aven_intents',
			ownerRoleSuffix: 'int_owner',
			functionRoles: [
				{
					kind: 'ceo.aven:db-role:intents:api@1',
					roleSuffix: 'int_api',
					tables: [
						'intents',
						'contributions',
						'merge_commands',
						'merge_relations',
						{ name: 'input_admissions', privileges: ['SELECT', 'INSERT'] },
						{ name: 'turn_outbox', privileges: ['SELECT', 'INSERT', 'UPDATE'] }
					]
				}
			]
		}),
		entry({
			folder: 'actor-runs',
			targetSchemaVersion: 7,
			migrationFiles: [
				'0001_actor_runs',
				'0002_studio',
				'0003_studio_origin',
				'0004_execution_journal',
				'0005_studio_draft_receipts',
				'0006_chat_progress_index',
				'0007_reviews'
			].map((id) => ({
				id,
				candidates: [resolve(process.cwd(), 'components', 'actor-runs', `${id}.sql`)]
			})),
			componentRef: 'os.aven:component:actors:run-repository@1',
			schema: 'aven_actor_runs',
			ownerRoleSuffix: 'act_owner',
			functionRoles: [
				{
					kind: 'os.aven:db-role:actors:api@1',
					roleSuffix: 'act_api',
					functions: [
						{ name: 'review_read', argumentTypes: ['uuid', 'int8', 'uuid', 'uuid', 'uuid'] },
						{
							name: 'review_decide',
							argumentTypes: ['uuid', 'int8', 'uuid', 'text', 'uuid', 'uuid', 'jsonb']
						}
					],
					tables: [
						...['runs', 'studio_drafts', 'studio_connections', 'studio_deliveries'].map((name) => ({
							name,
							privileges: ['SELECT', 'INSERT', 'UPDATE']
						})),
						{ name: 'run_settlement', privileges: ['SELECT'] }
					]
				},
				{
					kind: 'os.aven:db-role:actors:worker@1',
					roleSuffix: 'act_worker',
					functions: [
						{ name: 'review_read', argumentTypes: ['uuid', 'int8', 'uuid', 'uuid', 'uuid'] },
						{
							name: 'review_open',
							argumentTypes: ['uuid', 'int8', 'uuid', 'uuid', 'uuid', 'jsonb']
						}
					],
					tables: [
						{ name: 'runs', privileges: ['SELECT', 'UPDATE'] },
						{ name: 'run_steps', privileges: ['SELECT', 'INSERT', 'UPDATE'] },
						{ name: 'run_settlement', privileges: ['SELECT'] },
						{ name: 'studio_drafts', privileges: ['SELECT', 'INSERT', 'UPDATE'] },
						{ name: 'studio_draft_receipts', privileges: ['SELECT', 'INSERT'] }
					]
				}
			]
		})
	])
	return new Map(entries.map((value) => [value.manifest.componentRef, value]))
}

export function catalogDigest(catalog: Map<string, ComponentCatalogEntry>): string {
	return sha256(
		[...catalog.values()]
			.map((entry) => `${entry.manifest.componentRef}\0${entry.manifest.migrationSetDigest}`)
			.sort()
			.join('\n')
	)
}
