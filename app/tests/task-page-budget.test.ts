import { expect, test } from 'bun:test'
import { retainedToolResult, TOOL_EVIDENCE_LIMIT } from '@avenos/chat-engine/tool-result-evidence'
import { createTaskActor } from '@avenos/productivity/actor'
import { changedTasks, type TaskQuery, taskPageSchema } from '@avenos/productivity/tasks'
import { TrialTaskRepository } from '@avenos/productivity/trial'

const owner = crypto.randomUUID(),
	intentId = crypto.randomUUID(),
	elsewhere = crypto.randomUUID()
const snapshot = changedTasks(
	owner,
	{
		operation: 'create',
		tasks: Array.from({ length: 50 }, (_, i) => ({
			title: `Display cabinet ${i + 1}: ${'Document the miniature specimen and its protective sleeve. '.repeat(7)}`,
			tags: ['miniatures', '展示', 'réserve'],
			due: null,
			responsible: null,
			group: 'team'
		}))
	},
	{ operationId: crypto.randomUUID(), intentId, contributionId: null },
	[],
	'2035-04-12T10:00:00Z'
)

test('every long task row has a continuation and identical current/reviewer coverage', async () => {
	const repository = new TrialTaskRepository(snapshot)
	const actor = createTaskActor(repository, () => ({
		ownerSubjectId: owner,
		operationId: crypto.randomUUID(),
		intentId,
		contributionId: null
	}))
	try {
		const seen: string[] = []
		let after: string | undefined
		for (let pages = 0; pages < 51; pages++) {
			const query: TaskQuery = { intentId, group: 'team', limit: 100, ...(after && { after }) }
			const result = (await actor.deliver('todo_list', query)) as { record: string; wire: string }
			expect(result.wire).toBe(result.record)
			expect(result.record.length).toBeLessThanOrEqual(TOOL_EVIDENCE_LIMIT)
			const parsed = JSON.parse(result.record)
			const { ok, mode, ...body } = parsed
			expect(ok).toBe(true)
			expect(mode).toBe('trial')
			const page = taskPageSchema.parse(body)
			expect(retainedToolResult(result.record, 'Unavailable')).toEqual(parsed)
			expect(page.selection).toMatchObject(query)
			seen.push(...page.tasks.map((task) => task.id))
			if (page.complete) {
				expect(page.next).toBeNull()
				break
			}
			expect(page.tasks.length).toBeGreaterThan(0)
			expect(page.next).toBe(page.tasks.at(-1)?.id)
			expect(page.next).not.toBe(after)
			if (!page.next) throw Error('A partial page must have a continuation.')
			after = page.next
		}
		expect(seen).toEqual(snapshot.map((task) => task.id).sort())
		expect(new Set(seen).size).toBe(snapshot.length)
		expect((await repository.list(owner, { limit: 100 })).tasks).toHaveLength(snapshot.length)
	} finally {
		actor.dispose()
	}
})

test('an individually oversized escaped row fails explicitly, never an empty complete page', async () => {
	const tasks = changedTasks(
		owner,
		{
			operation: 'create',
			tasks: [
				{
					title: '\u0001'.repeat(500),
					tags: Array.from({ length: 20 }, () => '\u0002'.repeat(50)),
					due: null,
					responsible: null,
					group: 'me'
				}
			]
		},
		{ operationId: crypto.randomUUID(), intentId, contributionId: null },
		[],
		'2035-04-12T10:00:00Z'
	)
	const repository = new TrialTaskRepository(tasks)
	const actor = createTaskActor(repository, () => ({
		ownerSubjectId: owner,
		operationId: crypto.randomUUID(),
		intentId,
		contributionId: null
	}))
	try {
		const result = (await actor.deliver('todo_list', { intentId })) as { record: string }
		expect(JSON.parse(result.record)).toMatchObject({ ok: false, effect: 'not-applied' })
		expect(JSON.parse(result.record).error).toContain('No rows were skipped')
		expect(JSON.parse(result.record)).not.toHaveProperty('complete')
		expect((await repository.list(owner, {})).tasks).toEqual(tasks)
	} finally {
		actor.dispose()
	}
})

test('small pages and an empty selected Intent keep their original semantics', async () => {
	const repository = new TrialTaskRepository(snapshot)
	const actor = createTaskActor(repository, () => ({
		ownerSubjectId: owner,
		operationId: crypto.randomUUID(),
		intentId,
		contributionId: null
	}))
	try {
		for (const query of [
			{ intentId, limit: 1 },
			{ intentId: elsewhere, limit: 100 },
			{ archived: true }
		]) {
			const result = (await actor.deliver('todo_list', query)) as { record: string }
			expect(JSON.parse(result.record)).toEqual({
				ok: true,
				mode: 'trial',
				...(await repository.list(owner, query))
			})
		}
	} finally {
		actor.dispose()
	}
})
