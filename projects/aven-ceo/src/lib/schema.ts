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
	}),
	memoryArtifacts: s.table({
		sha256: s.string(),
		originalName: s.string(),
		mimeType: s.string(),
		sizeBytes: s.int(),
		storageUri: s.string(),
		createdAt: s.string()
	}),
	memoryNotes: s.table({
		kind: s.string(),
		slug: s.string(),
		title: s.string(),
		bodyMarkdown: s.string(),
		sourceArtifactId: s.ref('memoryArtifacts').optional(),
		createdAt: s.string(),
		updatedAt: s.string(),
		archived: s.boolean()
	}),
	memoryLinks: s.table({
		sourceNoteId: s.ref('memoryNotes'),
		targetNoteId: s.ref('memoryNotes'),
		label: s.string(),
		createdAt: s.string()
	}),
	memoryChunks: s.table({
		noteId: s.ref('memoryNotes'),
		sourceArtifactId: s.ref('memoryArtifacts').optional(),
		chunkIndex: s.int(),
		text: s.string(),
		contentHash: s.string(),
		createdAt: s.string()
	}),
	extractionRuns: s.table({
		artifactId: s.ref('memoryArtifacts'),
		skillId: s.string(),
		status: s.string(),
		extractor: s.string(),
		summary: s.string().optional(),
		error: s.string().optional(),
		startedAt: s.string(),
		completedAt: s.string().optional()
	})
})
