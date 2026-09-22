import { customerComponentManifestSchema } from './manifest.js'

export const customerComponentCatalog = [
	customerComponentManifestSchema.parse({
		componentRef: 'ceo.aven:component:data:credentials@1',
		contractVersion: 1,
		schema: 'aven_credentials',
		targetSchemaVersion: 1,
		migrationSetDigest: '6417b03642cc88d26bec452676e0a89e5c0ffd6ace12faab97e47f0f0b331b4b',
		minimumRuntimeSchemaVersion: 1,
		maximumRuntimeSchemaVersion: 1,
		ownerRoleSuffix: 'cred_owner',
		functionRoles: [
			{
				kind: 'ceo.aven:db-role:credentials:set@1',
				roleSuffix: 'cred_set',
				grantsFile: 'grants/cred-set.sql',
				connectionLimit: 4
			},
			{
				kind: 'ceo.aven:db-role:credentials:metadata@1',
				roleSuffix: 'cred_meta',
				grantsFile: 'grants/cred-meta.sql',
				connectionLimit: 4
			},
			{
				kind: 'ceo.aven:db-role:credentials:match@1',
				roleSuffix: 'cred_match',
				grantsFile: 'grants/cred-match.sql',
				connectionLimit: 4
			},
			{
				kind: 'ceo.aven:db-role:credentials:use-http@1',
				roleSuffix: 'cred_http',
				grantsFile: 'grants/cred-http.sql',
				connectionLimit: 4
			},
			{
				kind: 'ceo.aven:db-role:credentials:use-imap@1',
				roleSuffix: 'cred_imap',
				grantsFile: 'grants/cred-imap.sql',
				connectionLimit: 4
			}
		],
		dependencies: [],
		requiredByDefault: false
	}),
	customerComponentManifestSchema.parse({
		componentRef: 'ceo.aven:component:data:productivity@1',
		contractVersion: 1,
		schema: 'aven_productivity',
		targetSchemaVersion: 1,
		migrationSetDigest: '79510bc7a488cf6b97f4de77c02375612c2c433ff2e3dc949969a9b1c6c888a7',
		minimumRuntimeSchemaVersion: 1,
		maximumRuntimeSchemaVersion: 1,
		ownerRoleSuffix: 'prod_owner',
		functionRoles: [
			{
				kind: 'ceo.aven:db-role:productivity:api@1',
				roleSuffix: 'prod_api',
				grantsFile: 'grants/prod-api.sql',
				connectionLimit: 4
			}
		],
		dependencies: [],
		requiredByDefault: true
	}),
	customerComponentManifestSchema.parse({
		componentRef: 'ceo.aven:component:data:artifacts@1',
		contractVersion: 1,
		schema: 'artifact_store',
		targetSchemaVersion: 4,
		migrationSetDigest: '6de72cc9378f7e98733f02d8cd449db490c3df19002419b4226013903bc78119',
		minimumRuntimeSchemaVersion: 1,
		maximumRuntimeSchemaVersion: 4,
		ownerRoleSuffix: 'art_owner',
		functionRoles: [
			{
				kind: 'ceo.aven:db-role:artifacts:api@1',
				roleSuffix: 'art_api',
				grantsFile: 'grants/art-api.sql',
				connectionLimit: 4
			}
		],
		dependencies: [],
		requiredByDefault: true
	}),
	customerComponentManifestSchema.parse({
		componentRef: 'ceo.aven:component:data:intents@1',
		contractVersion: 1,
		schema: 'aven_intents',
		targetSchemaVersion: 4,
		migrationSetDigest: 'f14d5a20e0258d0f8142bfcccbf209309e7b497c5bc4e87404242bf023908fe9',
		minimumRuntimeSchemaVersion: 4,
		maximumRuntimeSchemaVersion: 4,
		ownerRoleSuffix: 'int_owner',
		functionRoles: [
			{
				kind: 'ceo.aven:db-role:intents:api@1',
				roleSuffix: 'int_api',
				grantsFile: 'grants/int-api.sql',
				connectionLimit: 4
			}
		],
		dependencies: [],
		requiredByDefault: true
	}),
	customerComponentManifestSchema.parse({
		componentRef: 'os.aven:component:actors:run-repository@1',
		contractVersion: 1,
		schema: 'aven_actor_runs',
		targetSchemaVersion: 7,
		migrationSetDigest: '72d6dec06ebe07b71792a53c2a59b114eae47cffc802124ca0f7f3ec7e8f1d68',
		minimumRuntimeSchemaVersion: 7,
		maximumRuntimeSchemaVersion: 7,
		ownerRoleSuffix: 'act_owner',
		functionRoles: [
			{
				kind: 'os.aven:db-role:actors:api@1',
				roleSuffix: 'act_api',
				grantsFile: 'grants/act-api.sql',
				connectionLimit: 4
			},
			{
				kind: 'os.aven:db-role:actors:worker@1',
				roleSuffix: 'act_worker',
				grantsFile: 'grants/act-worker.sql',
				connectionLimit: 4
			}
		],
		dependencies: [],
		requiredByDefault: true
	})
] as const
