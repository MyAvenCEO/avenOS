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

	policy.todos.allowRead.always()
	policy.todos.allowInsert.always()
	policy.todos.allowUpdate.always()
	policy.todos.allowDelete.always()
})

export default permissions
