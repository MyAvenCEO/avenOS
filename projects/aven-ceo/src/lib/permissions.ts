import { schema as s } from 'jazz-tools'
import { app } from './schema'

/**
 * Quickstart-aligned permissions (`install/client` — enable sync reads/writes).
 * Tighten to row-level rules once the pipeline is verified.
 */
const permissions = s.definePermissions(app, ({ policy }) => {
	policy.profiles.allowRead.always()
	policy.profiles.allowInsert.always()
	policy.profiles.allowUpdate.always()
	policy.profiles.allowDelete.always()

	policy.intents.allowRead.always()
	policy.intents.allowInsert.always()
	policy.intents.allowUpdate.always()
	policy.intents.allowDelete.always()

	policy.workers.allowRead.always()
	policy.workers.allowInsert.always()
	policy.workers.allowUpdate.always()
	policy.workers.allowDelete.always()

	policy.memoryArtifacts.allowRead.always()
	policy.memoryArtifacts.allowInsert.always()
	policy.memoryArtifacts.allowUpdate.always()
	policy.memoryArtifacts.allowDelete.always()

	policy.memoryNotes.allowRead.always()
	policy.memoryNotes.allowInsert.always()
	policy.memoryNotes.allowUpdate.always()
	policy.memoryNotes.allowDelete.always()

	policy.memoryLinks.allowRead.always()
	policy.memoryLinks.allowInsert.always()
	policy.memoryLinks.allowUpdate.always()
	policy.memoryLinks.allowDelete.always()

	policy.memoryChunks.allowRead.always()
	policy.memoryChunks.allowInsert.always()
	policy.memoryChunks.allowUpdate.always()
	policy.memoryChunks.allowDelete.always()

	policy.extractionRuns.allowRead.always()
	policy.extractionRuns.allowInsert.always()
	policy.extractionRuns.allowUpdate.always()
	policy.extractionRuns.allowDelete.always()
})

export default permissions
