import { taskPageSchema, taskReceiptSchema } from './tasks'

/** A smaller observation of the same validated result, never another task contract.
 * Keep editable identities, user-visible values, scope and pagination. Omitted
 * rows are explicit; a complete service page is not necessarily fully retained. */
export function taskResultEvidence(
	value: Record<string, unknown>,
	limit: number
): Record<string, unknown> | undefined {
	const { ok, mode, ...body } = value
	if (ok !== true || (mode !== 'production' && mode !== 'trial')) return
	const parsed =
		'operation' in body ? taskReceiptSchema.safeParse(body) : taskPageSchema.safeParse(body)
	if (!parsed.success) return
	const { tasks, ...scope } = parsed.data
	const rows = tasks.map(
		({ ownerSubjectId: _owner, createdAt: _created, updatedAt: _updated, ...task }) => task
	)
	const projected = () => ({
		ok,
		mode,
		...scope,
		tasks: rows,
		retention: {
			complete: rows.length === tasks.length,
			returnedTasks: tasks.length,
			omittedTasks: tasks.length - rows.length,
			omittedFields: ['ownerSubjectId', 'createdAt', 'updatedAt'],
			notice:
				'Task observation at the time of this call, not current-state or whole-workspace proof. Page complete/next describes the service selection; retention describes which returned rows remain here.'
		}
	})
	while (rows.length && JSON.stringify(projected()).length > limit) rows.pop()
	const result = projected()
	return JSON.stringify(result).length <= limit ? result : undefined
}
