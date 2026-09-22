import { z } from 'zod'

export const PRODUCTIVITY_COMPONENT = 'ceo.aven:component:data:productivity@1'
export const taskStatusSchema = z.enum(['open', 'doing', 'done'])
const timezone = z
	.string()
	.min(1)
	.max(100)
	.refine((value) => {
		try {
			new Intl.DateTimeFormat('en', { timeZone: value })
			return true
		} catch {
			return false
		}
	}, 'Use an IANA timezone.')
export const taskDueSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('date'), date: z.iso.date() }).strict(),
	z.object({ kind: z.literal('time'), at: z.iso.datetime({ offset: true }), timezone }).strict(),
	z
		.object({
			kind: z.literal('window'),
			start: z.iso.datetime({ offset: true }),
			end: z.iso.datetime({ offset: true }),
			timezone
		})
		.strict()
		.refine(
			(value) => Date.parse(value.end) > Date.parse(value.start),
			'The end must be after the start.'
		)
])
const fields = z
	.object({
		title: z.string().trim().min(1).max(500),
		tags: z.array(z.string().trim().min(1).max(50)).max(20),
		due: taskDueSchema.nullable(),
		responsible: z.string().trim().min(1).max(160).nullable(),
		group: z.enum(['me', 'team'])
	})
	.strict()
const taskFields = fields.extend({
	tags: fields.shape.tags.default([]),
	due: fields.shape.due.default(null),
	responsible: fields.shape.responsible.default(null),
	group: fields.shape.group.default('me')
})
export const taskSchema = taskFields
	.extend({
		id: z.uuid(),
		revision: z.number().int().positive(),
		status: taskStatusSchema,
		ownerSubjectId: z.uuid(),
		intentId: z.uuid().nullable(),
		archived: z.boolean(),
		createdAt: z.iso.datetime({ offset: true }),
		updatedAt: z.iso.datetime({ offset: true })
	})
	.strict()
export type Task = z.infer<typeof taskSchema>
export const taskCreateSchema = z
	.object({
		tasks: z
			.array(
				taskFields.extend({
					status: taskStatusSchema
						.optional()
						.describe(
							'Defaults to open. Use doing or done only when the user asks for that initial state.'
						)
				})
			)
			.min(1)
			.max(50)
			.describe(
				'A JSON array of task objects, not a string containing JSON. Create only the requested tasks.'
			)
	})
	.strict()
const taskVersion = z
	.object({
		id: z
			.uuid()
			.describe('Copy the exact task ID from a tool receipt or todo_list; never invent it.'),
		revision: z.number().int().positive().describe('The revision returned with that exact task ID.')
	})
	.strict()
export const taskUpdateSchema = z
	.object({
		tasks: z.array(taskVersion).min(1).max(50),
		patch: fields
			.partial()
			.extend({
				status: taskStatusSchema.optional(),
				intentId: z
					.uuid()
					.nullable()
					.optional()
					.describe(
						'Only when requested: associate the selected tasks with this existing Intent, or null to remove their association. Copy an exact verified Intent ID; do not infer it from a title. Task identities and history are retained.'
					)
			})
			.strict()
			.refine((value) => Object.keys(value).length > 0, 'Choose a field to change.')
	})
	.strict()
	.refine((value) => !value.patch.title || value.tasks.length === 1, 'Rename one task at a time.')
export const taskArchiveSchema = z
	.object({
		tasks: z.array(taskVersion).min(1).max(50),
		archived: z.boolean()
	})
	.strict()
export const taskListSchema = z
	.object({
		group: z.enum(['me', 'team']).optional(),
		intentId: z.uuid().optional(),
		status: taskStatusSchema.optional(),
		archived: z
			.boolean()
			.default(false)
			.describe(
				'false (default): current non-archived tasks, including completed tasks. true: ONLY archived tasks, excluding every current task.'
			),
		after: z.uuid().optional(),
		limit: z.number().int().min(1).max(100).default(50)
	})
	.strict()
export const taskCommandSchema = z.discriminatedUnion('operation', [
	taskCreateSchema.extend({ operation: z.literal('create') }),
	taskUpdateSchema.extend({ operation: z.literal('update') }),
	taskArchiveSchema.extend({ operation: z.literal('archive') })
])
export type TaskCommand = z.infer<typeof taskCommandSchema>
export type TaskQuery = z.input<typeof taskListSchema>
export const taskPageSchema = z
	.object({
		tasks: z.array(taskSchema).max(100),
		next: z.uuid().nullable(),
		complete: z.boolean(),
		selection: taskListSchema.describe(
			'Exact filters for this result. Empty results establish absence only within this selection.'
		)
	})
	.strict()
export type TaskPage = z.infer<typeof taskPageSchema>
export const taskCauseSchema = z
	.object({
		operationId: z.uuid(),
		intentId: z.uuid().nullable(),
		contributionId: z.uuid().nullable()
	})
	.strict()
	.refine(
		(value) => !value.contributionId || Boolean(value.intentId),
		'A contribution requires its Intent.'
	)
export type TaskCause = z.infer<typeof taskCauseSchema>
export const taskReceiptSchema = z
	.object({
		operationId: z.uuid(),
		operation: z.enum(['create', 'update', 'archive']),
		completedAt: z.iso.datetime({ offset: true }),
		tasks: z.array(taskSchema).min(1).max(50)
	})
	.strict()
export type TaskReceipt = z.infer<typeof taskReceiptSchema>
export interface TaskRepository {
	readonly mode: 'production' | 'trial'
	list(owner: string, query: TaskQuery): Promise<TaskPage>
	execute(owner: string, command: TaskCommand, cause: TaskCause): Promise<TaskReceipt>
	receipt(owner: string, operationId: string): Promise<TaskReceipt | null>
}
export class TaskConflict extends Error {}
export class TaskNotFound extends Error {}

/** Domain changes are shared by productive storage and explicitly isolated trials. */
export function changedTasks(
	owner: string,
	command: TaskCommand,
	cause: TaskCause,
	previous: readonly Task[],
	now: string,
	newId: () => string = () => crypto.randomUUID()
): Task[] {
	if (command.operation === 'create')
		return command.tasks.map((fields) =>
			taskSchema.parse({
				...fields,
				id: newId(),
				ownerSubjectId: owner,
				intentId: cause.intentId,
				revision: 1,
				status: fields.status ?? 'open',
				archived: false,
				createdAt: now,
				updatedAt: now
			})
		)
	if (new Set(command.tasks.map((task) => task.id)).size !== command.tasks.length)
		throw new TaskConflict('A task can only appear once in one change.')
	return command.tasks.map((version) => {
		const task = previous.find((task) => task.id === version.id && task.ownerSubjectId === owner)
		if (!task) throw new TaskNotFound('One or more tasks are no longer available.')
		if (task.revision !== version.revision)
			throw new TaskConflict('A task changed. Reload it before applying this change.')
		if (command.operation === 'update' && task.archived)
			throw new TaskConflict('Restore the task before changing it.')
		return taskSchema.parse({
			...task,
			...(command.operation === 'update' ? command.patch : { archived: command.archived }),
			revision: task.revision + 1,
			updatedAt: now
		})
	})
}
export function taskPage(tasks: readonly Task[], owner: string, raw: TaskQuery): TaskPage {
	const query = taskListSchema.parse(raw)
	const found = tasks
		.filter(
			(task) =>
				task.ownerSubjectId === owner &&
				task.archived === query.archived &&
				(!query.group || task.group === query.group) &&
				(!query.intentId || task.intentId === query.intentId) &&
				(!query.status || task.status === query.status) &&
				(!query.after || task.id > query.after)
		)
		.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
	const page = found.slice(0, query.limit),
		complete = found.length <= query.limit
	return {
		tasks: structuredClone(page),
		complete,
		next: complete ? null : page.at(-1)!.id,
		selection: query
	}
}

/** One canonical material identity for API retries, Skills and journal reconciliation. */
export function taskMaterial(command: TaskCommand, cause: TaskCause): string {
	const canonical = (value: unknown): unknown =>
		Array.isArray(value)
			? value.map(canonical)
			: value && typeof value === 'object'
				? Object.fromEntries(
						Object.entries(value)
							.filter(([, v]) => v !== undefined)
							.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
							.map(([k, v]) => [k, canonical(v)])
					)
				: value
	return JSON.stringify(canonical({ command, cause }))
}
