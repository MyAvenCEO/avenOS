import { expect, test } from 'bun:test'
import {
	changedTasks,
	TaskConflict,
	taskCommandSchema,
	taskMaterial
} from '@avenos/productivity/tasks'

test('reassociation is a revision-checked update, preserving identity, values and command origin', () => {
	const owner = crypto.randomUUID(),
		origin = crypto.randomUUID(),
		destination = crypto.randomUUID()
	const cause = { operationId: crypto.randomUUID(), intentId: origin, contributionId: null }
	const original = changedTasks(
		owner,
		{
			operation: 'create',
			tasks: [
				{
					title: 'Sketch a paper lighthouse',
					group: 'me',
					tags: ['miniatures'],
					due: null,
					responsible: null
				}
			]
		},
		cause,
		[],
		'2035-04-12T10:00:00Z'
	)
	const command = taskCommandSchema.parse({
		operation: 'update',
		tasks: original.map(({ id, revision }) => ({ id, revision })),
		patch: { intentId: destination }
	})
	const moved = changedTasks(owner, command, cause, original, '2035-04-12T11:00:00Z')
	expect(moved).toEqual(
		original.map((task) => ({
			...task,
			intentId: destination,
			revision: 2,
			updatedAt: '2035-04-12T11:00:00Z'
		}))
	)
	expect(original[0].intentId).toBe(origin)
	expect(cause.intentId).toBe(origin)
	expect(() => changedTasks(owner, command, cause, moved, '2035-04-12T12:00:00Z')).toThrow(
		TaskConflict
	)
	const detached = {
		...command,
		tasks: moved.map(({ id, revision }) => ({ id, revision })),
		patch: { intentId: null }
	}
	expect(changedTasks(owner, detached, cause, moved, '2035-04-12T12:00:00Z')[0]).toMatchObject({
		id: original[0].id,
		revision: 3,
		intentId: null
	})
	expect(taskMaterial(command, cause)).not.toBe(
		taskMaterial({ ...command, patch: { intentId: null } }, cause)
	)
})
