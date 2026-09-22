import { expect, test } from 'bun:test'
import { createTaskActor } from '@avenos/productivity/actor'
import { changedTasks, taskCommandSchema } from '@avenos/productivity/tasks'
import { TrialTaskRepository } from '@avenos/productivity/trial'

test('initial status is shared by task creation and receipts, without a second update', async () => {
	const ownerSubjectId = crypto.randomUUID()
	const cause = { operationId: crypto.randomUUID(), intentId: null, contributionId: null }
	const command = taskCommandSchema.parse({
		operation: 'create',
		tasks: [
			{ title: 'Sketch the model orchard' },
			{ title: 'Cut felt clouds', status: 'open' },
			{ title: 'Paint the prop doorway', status: 'doing' },
			{ title: 'Fold the paper ridge', status: 'done' }
		]
	})
	const rows = changedTasks(ownerSubjectId, command, cause, [], '2034-06-03T09:00:00Z')
	expect(rows.map((row) => row.status)).toEqual(['open', 'open', 'doing', 'done'])
	expect(rows.every((row) => row.revision === 1 && !row.archived)).toBe(true)
	const repository = new TrialTaskRepository()
	const actor = createTaskActor(repository, () => ({ ownerSubjectId, ...cause }))
	try {
		const result = JSON.parse((await actor.deliver('todo_create', { tasks: command.tasks })).record)
		expect(result.ok).toBe(true)
		expect(result.tasks.map((row: { status: string }) => row.status)).toEqual(
			rows.map((row) => row.status)
		)
		expect((await repository.list(ownerSubjectId, {})).tasks).toHaveLength(4)
	} finally {
		actor.dispose()
	}
})

test('task creation still rejects unknown state and fields without applying a mutation', async () => {
	const repository = new TrialTaskRepository()
	const ownerSubjectId = crypto.randomUUID()
	const actor = createTaskActor(repository, () => ({
		ownerSubjectId,
		operationId: crypto.randomUUID(),
		intentId: null,
		contributionId: null
	}))
	try {
		for (const extra of [
			{ status: 'finished' },
			{ done: true },
			{ ownerSubjectId: crypto.randomUUID() }
		]) {
			const result = JSON.parse(
				(
					await actor.deliver('todo_create', {
						tasks: [{ title: 'Arrange wooden stars', ...extra }]
					})
				).record
			)
			expect(result).toMatchObject({ ok: false, status: 400, effect: 'not-applied' })
			if (!('status' in extra)) expect(result.error).toContain('Unknown fields:')
		}
		expect((await repository.list(ownerSubjectId, {})).tasks).toHaveLength(0)
	} finally {
		actor.dispose()
	}
})
