import { customerComponentManifestSchema } from './manifest.js'

export const customerComponentCatalog = [
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
		targetSchemaVersion: 1,
		migrationSetDigest: '542889603d4eb7c3532f694bd69f58888bcc5463bb2c178d5a65bab0bb5e81e0',
		minimumRuntimeSchemaVersion: 1,
		maximumRuntimeSchemaVersion: 1,
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
		targetSchemaVersion: 2,
		migrationSetDigest: 'b530598772310c113ad47cf732fbbb2ceb93e72c128e42f5abf53819f3840b45',
		minimumRuntimeSchemaVersion: 1,
		maximumRuntimeSchemaVersion: 2,
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
