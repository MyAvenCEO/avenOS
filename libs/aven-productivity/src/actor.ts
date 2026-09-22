import { Actor, type Manifest, resourceId } from '@avenos/actors'
import { z } from 'zod'
import { TaskRequestError } from './remote'
import {
	type TaskCause,
	TaskConflict,
	TaskNotFound,
	type TaskPage,
	type TaskRepository,
	taskArchiveSchema,
	taskCreateSchema,
	taskListSchema,
	taskUpdateSchema
} from './tasks'

export const TASK_RECEIPT_SCHEMA = resourceId({
	authority: 'ceo.aven',
	kind: 'schema',
	namespace: 'productivity',
	name: 'task-result',
	version: '1'
})
const operations = [
	{
		name: 'list',
		schema: taskListSchema,
		description:
			'Read saved tasks and their current revisions. Pages are bounded by content size as well as limit. Follow next (as after, with the same filters) until complete before claiming a complete list. This is a live list, not a frozen snapshot.'
	},
	{
		name: 'create',
		schema: taskCreateSchema,
		description:
			'Save the tasks the user requested. Pass one tasks array; title, group, due, tags, responsible and optional initial status belong inside each task, not beside the array. Status defaults to open; use doing or done only if requested. Returns durable IDs and revisions. Do not create tasks merely because a topic was mentioned.'
	},
	{
		name: 'update',
		schema: taskUpdateSchema,
		description:
			'Change tasks using exact IDs and revisions from an available list or receipt. If those values are not present in your context, call todo_list first; never reconstruct an ID from a title or earlier prose. Done means complete, not archive. On a revision conflict, reread and reconsider instead of guessing a revision.'
	},
	{
		name: 'archive',
		schema: taskArchiveSchema,
		description:
			'Archive or restore exactly the selected task revisions. Archive only when requested; completed tasks remain visible until archived. History is retained.'
	}
] as const
export const TASK_MANIFEST: Manifest = {
	id: 'todo',
	authority: 'ceo.aven',
	namespace: 'productivity.todos',
	version: '1',
	name: 'Tasks',
	description:
		'Saved tasks shared by conversation, list and board. Changes retain their history. Productive Skill composition requires a separately installed and authorized task capability.',
	tags: ['productivity', 'todo'],
	methods: operations.map((operation) => ({
		name: `todo_${operation.name}`,
		description: operation.description,
		parameters: z.toJSONSchema(operation.schema, { io: 'input' }),
		mode: operation.name === 'list' ? 'observe' : 'effect',
		idempotency: 'idempotent',
		requires: [],
		produces: ['ceo.aven.productivity.task_result(R)'],
		inputSlots: [],
		outputSlots: [
			{
				name: 'result',
				schema: TASK_RECEIPT_SCHEMA,
				predicate: 'ceo.aven.productivity.task_result(R)',
				role: 'result',
				cardinality: 'one'
			}
		]
	}))
}
export function taskManifest(mode: TaskRepository['mode']): Manifest {
	if (mode === 'production') return TASK_MANIFEST
	return {
		...TASK_MANIFEST,
		name: 'Tasks · trial',
		methods: TASK_MANIFEST.methods.map((method) => ({
			...method,
			description: `TRIAL ONLY: this operation uses an isolated temporary copy. It cannot change the saved task list. Use it to exercise requested trial changes, and label results as temporary. ${method.description}`
		}))
	}
}
export interface TaskInvocation extends TaskCause {
	ownerSubjectId: string
}

/** Leave room inside the chat evidence budget. A page must mean the same thing
 * to the current model, saved history and the reviewer; do not return a huge page
 * that only the current model can see. The repository's stable cursor still owns
 * ordering and filtering. Effects retain their original immutable receipts.
 */
const TASK_LIST_RESULT_LIMIT = 7000
function taskListRecord(page: TaskPage, mode: TaskRepository['mode']): string {
	const value = { ok: true, mode, ...page, tasks: [...page.tasks] }
	let record = JSON.stringify(value)
	while (record.length > TASK_LIST_RESULT_LIMIT && value.tasks.length > 1) {
		value.tasks.pop()
		value.next = value.tasks[value.tasks.length - 1].id
		value.complete = false
		record = JSON.stringify(value)
	}
	if (record.length > TASK_LIST_RESULT_LIMIT)
		throw new Error(
			'A task exceeds the readable page size. No rows were skipped; this list is not complete. Inspect the task in the task list before continuing.'
		)
	return record
}
/** The host supplies authority and operation identity. Neither comes from model parameters. */
export function createTaskActor(repository: TaskRepository, invocation: () => TaskInvocation) {
	return new Actor(
		taskManifest(repository.mode),
		Object.fromEntries(
			operations.map((operation) => [
				`todo_${operation.name}`,
				async (raw: Record<string, unknown>) => {
					const context = invocation()
					let dispatched = false
					try {
						const input = operation.schema.parse(raw)
						dispatched = true
						if (operation.name === 'list') {
							const page = await repository.list(
								context.ownerSubjectId,
								input as z.infer<typeof taskListSchema>
							)
							const record = taskListRecord(page, repository.mode)
							return { record, wire: record }
						}
						const result = await repository.execute(
							context.ownerSubjectId,
							{ ...input, operation: operation.name } as Parameters<TaskRepository['execute']>[1],
							{
								operationId: context.operationId,
								intentId: context.intentId,
								contributionId: context.contributionId
							}
						)
						const record = JSON.stringify({ ok: true, mode: repository.mode, ...result })
						return { record, wire: record }
					} catch (error) {
						// A malformed response after dispatch is not a rejected input. The write
						// may already exist even when its receipt cannot be decoded.
						const status =
							error instanceof TaskRequestError
								? error.status
								: error instanceof z.ZodError && !dispatched
									? 400
									: error instanceof TaskConflict
										? 409
										: error instanceof TaskNotFound
											? 404
											: null
						const effect =
							operation.name === 'list' || (status !== null && status >= 400 && status < 500)
								? 'not-applied'
								: 'uncertain'
						const message =
							error instanceof z.ZodError
								? dispatched
									? 'The service result could not be confirmed. Check its saved receipt before retrying.'
									: error.issues
											.slice(0, 3)
											.map(
												(issue) =>
													`${issue.path.join('.') || 'request'}: ${issue.code === 'unrecognized_keys' ? `Unknown fields: ${issue.keys.slice(0, 3).join(', ')}. Use the fields in this tool's schema.` : issue.message}`
											)
											.join('; ')
								: error instanceof Error
									? error.message
									: String(error)
						const record = JSON.stringify({
							ok: false,
							mode: repository.mode,
							operationId: context.operationId,
							status,
							effect,
							error: message
						})
						return {
							record,
							wire: record,
							...(effect === 'uncertain' && { outcome: 'uncertain' as const })
						}
					}
				}
			])
		)
	)
}
