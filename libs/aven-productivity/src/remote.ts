import {
	type TaskCause,
	type TaskCommand,
	type TaskQuery,
	type TaskRepository,
	taskCauseSchema,
	taskCommandSchema,
	taskListSchema,
	taskPageSchema,
	taskReceiptSchema
} from './tasks'

/** The host supplies one authenticated, environment-pinned transport, never model-chosen URLs. */
export type TaskTransport = (
	method: 'GET' | 'POST',
	path: string,
	body?: unknown
) => Promise<unknown>
export class TaskRequestError extends Error {
	constructor(
		message: string,
		readonly code: string,
		readonly status: number
	) {
		super(message)
	}
}
export class RemoteTaskRepository implements TaskRepository {
	readonly mode = 'production' as const
	constructor(
		private readonly subjectId: string,
		private readonly request: TaskTransport
	) {}
	private checkOwner(owner: string) {
		if (owner !== this.subjectId)
			throw new Error('The task session changed. Reconnect before continuing.')
	}
	async list(owner: string, raw: TaskQuery) {
		this.checkOwner(owner)
		const query = taskListSchema.parse(raw)
		const params = new URLSearchParams(
			Object.entries(query)
				.filter(([, value]) => value !== undefined)
				.map(([key, value]) => [key, String(value)])
		)
		const page = taskPageSchema.parse(await this.request('GET', `/tasks?${params}`))
		if (
			Object.keys(query).some(
				(key) => query[key as keyof typeof query] !== page.selection[key as keyof typeof query]
			) ||
			Object.keys(page.selection).some(
				(key) => page.selection[key as keyof typeof query] !== query[key as keyof typeof query]
			)
		)
			throw new Error('The task result belongs to a different selection. Reload before using it.')
		for (const task of page.tasks) this.checkOwner(task.ownerSubjectId)
		return page
	}
	async execute(owner: string, raw: TaskCommand, rawCause: TaskCause) {
		this.checkOwner(owner)
		const command = taskCommandSchema.parse(raw),
			cause = taskCauseSchema.parse(rawCause)
		const receipt = taskReceiptSchema.parse(
			await this.request('POST', '/commands', { command, cause })
		)
		if (receipt.operationId !== cause.operationId || receipt.operation !== command.operation)
			throw new Error(
				'The task receipt does not match this operation. Check its saved outcome before retrying.'
			)
		for (const task of receipt.tasks) this.checkOwner(task.ownerSubjectId)
		return receipt
	}
	async receipt(owner: string, operationId: string) {
		this.checkOwner(owner)
		const id = taskCauseSchema.shape.operationId.parse(operationId)
		const result = await this.request('GET', `/commands/${id}`)
		if (result === null) return null
		const receipt = taskReceiptSchema.parse(result)
		if (receipt.operationId !== id)
			throw new Error('The saved task receipt belongs to a different operation.')
		for (const task of receipt.tasks) this.checkOwner(task.ownerSubjectId)
		return receipt
	}
}
