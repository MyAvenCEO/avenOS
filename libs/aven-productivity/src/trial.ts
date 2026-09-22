import { z } from 'zod'
import {
	changedTasks,
	type Task,
	type TaskCause,
	type TaskCommand,
	TaskConflict,
	type TaskQuery,
	type TaskReceipt,
	type TaskRepository,
	taskCauseSchema,
	taskCommandSchema,
	taskMaterial,
	taskPage,
	taskSchema
} from './tasks'

/** Explicit trial storage. This is never selected as a fallback when the server is unavailable. */
export class TrialTaskRepository implements TaskRepository {
	readonly mode = 'trial' as const
	private tasks: Task[]
	private receipts = new Map<string, { material: string; receipt: TaskReceipt }>()
	constructor(snapshot: readonly Task[] = []) {
		this.tasks = snapshot.map((task) => taskSchema.parse(task))
	}
	async list(owner: string, query: TaskQuery) {
		z.uuid().parse(owner)
		return taskPage(this.tasks, owner, query)
	}
	async receipt(owner: string, operationId: string) {
		z.uuid().parse(owner)
		z.uuid().parse(operationId)
		return structuredClone(this.receipts.get(`${owner}:${operationId}`)?.receipt ?? null)
	}
	async execute(owner: string, raw: TaskCommand, rawCause: TaskCause) {
		z.uuid().parse(owner)
		const command = taskCommandSchema.parse(raw),
			cause = taskCauseSchema.parse(rawCause)
		const key = `${owner}:${cause.operationId}`,
			material = taskMaterial(command, cause),
			previous = this.receipts.get(key)
		if (previous) {
			if (previous.material !== material)
				throw new TaskConflict('This operation was already used for a different change.')
			return structuredClone(previous.receipt)
		}
		const completedAt = new Date().toISOString()
		const tasks = changedTasks(owner, command, cause, this.tasks, completedAt)
		this.tasks = [
			...this.tasks.filter((task) => !tasks.some((change) => change.id === task.id)),
			...tasks
		]
		const receipt = {
			operationId: cause.operationId,
			operation: command.operation,
			completedAt,
			tasks
		}
		this.receipts.set(key, { material, receipt })
		return structuredClone(receipt)
	}
}
