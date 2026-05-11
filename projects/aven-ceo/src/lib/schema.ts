import { schema as s } from 'jazz-tools'

/**
 * Structural changes (tables/columns) change the WASM schema hash. Sync targets branches named
 * `{env}-{schemaHash12}-{userBranch}` (see `composeTargetBranchName` in jazz-tools). Existing OPFS
 * data may still reflect an older hash until cleared — use dev “Clear local Jazz DB” on `/me` or
 * `Db.deleteClientStorage()`. Keeping old rows without wiping requires `defineMigration` + push.
 */
export const app = s.defineApp({
	profiles: s.table({
		name: s.string()
	}),
	intents: s.table({
		title: s.string(),
		done: s.boolean()
	}),
	/** Spawned worker instances — no seed; rows created from intent flow (testing). */
	workers: s.table({
		ownerUserId: s.string(),
		categoryKey: s.string(),
		label: s.string(),
		taskLine: s.string(),
		status: s.string(),
		score: s.string()
	})
})
