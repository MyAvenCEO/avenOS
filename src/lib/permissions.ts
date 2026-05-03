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
})

export default permissions
