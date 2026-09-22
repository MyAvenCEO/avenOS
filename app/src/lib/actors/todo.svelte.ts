import { createTaskActor, TASK_MANIFEST } from '@avenos/productivity/actor'
import type { Task, TaskCommand } from '@avenos/productivity/tasks'
import { customerWork } from '../artifacts/customer-work.svelte'
import { Actor, type ActorCallContext, type HandlerResult } from './actor'
import { singleton } from './singleton'
import { type TaskSession, taskSession } from './task-client'

export const SPARKS = [
	{ id: 'me', name: 'Me', color: 'var(--color-info)' },
	{ id: 'team', name: 'Team', color: 'var(--color-quiet)' }
]

/** Only a presentation cache. All task changes go through the shared task Actor. */
export class TaskActor extends Actor {
	state = $state({
		active: 'me' as 'me' | 'team',
		tasks: [] as Task[],
		loading: false,
		loaded: false,
		archived: false,
		next: null as string | null,
		error: '',
		pending: false
	})
	#generation = 0
	#workspaceGeneration = 0
	#session: TaskSession | null = null
	#refreshAgain = false
	#retry = $state.raw<{ command: TaskCommand; operationId: string; session: TaskSession } | null>(
		null
	)
	constructor(private readonly sessionProvider: () => Promise<TaskSession> = taskSession) {
		super(TASK_MANIFEST)
		this.bind(
			Object.fromEntries(
				TASK_MANIFEST.methods.map((method) => [
					method.name,
					(payload: Record<string, unknown>, context?: ActorCallContext) =>
						this.execute(method.name, payload, context)
				])
			)
		)
	}
	reset() {
		this.#generation++
		this.#workspaceGeneration++
		this.#session = null
		this.#retry = null
		this.#refreshAgain = false
		this.state = {
			active: 'me',
			tasks: [],
			loading: false,
			loaded: false,
			archived: false,
			next: null,
			error: '',
			pending: false
		}
	}
	async refresh(more = false) {
		if (this.state.loading) {
			this.#refreshAgain = true
			return
		}
		const generation = this.#generation,
			group = this.state.active,
			archived = this.state.archived
		const after = more ? this.state.next : null
		if (more && !after) return
		this.state.loading = true
		try {
			const session = await this.sessionProvider()
			const page = await session.repository.list(session.subjectId, {
				group,
				archived,
				...(after && { after }),
				limit: 50
			})
			if (
				generation !== this.#generation ||
				group !== this.state.active ||
				archived !== this.state.archived
			)
				return
			this.#session = session
			this.state.tasks = more ? [...this.state.tasks, ...page.tasks] : page.tasks
			this.state.next = page.next
			this.state.loaded = true
			if (!this.#retry) this.state.error = ''
		} catch (error) {
			if (generation === this.#generation)
				this.state.error = String(error instanceof Error ? error.message : error)
		} finally {
			if (generation === this.#generation) {
				this.state.loading = false
				if (this.#refreshAgain) {
					this.#refreshAgain = false
					void this.refresh()
				}
			}
		}
	}
	async show(group: 'me' | 'team', archived = false) {
		if (this.state.pending) return
		this.#generation++
		this.state.active = group
		this.state.archived = archived
		this.state.tasks = []
		this.state.next = null
		this.state.loaded = false
		this.state.loading = false
		await this.refresh()
	}
	private async execute(
		name: string,
		payload: Record<string, unknown>,
		context?: ActorCallContext
	): Promise<HandlerResult> {
		const generation = this.#generation
		const workspace = this.#workspaceGeneration
		const session = await this.sessionProvider()
		if (workspace !== this.#workspaceGeneration || context?.signal?.aborted)
			throw Error('This request was stopped before the task operation.')
		const actor = createTaskActor(session.repository, () => ({
			ownerSubjectId: session.subjectId,
			operationId: context?.operationId ?? crypto.randomUUID(),
			intentId: context?.intentId || null,
			contributionId: context?.contributionId ?? null
		}))
		customerWork.tasks++
		try {
			const result = await actor.deliver(name, payload, context)
			if (generation === this.#generation && name !== 'todo_list' && JSON.parse(result.record).ok)
				void this.refresh()
			return result
		} finally {
			actor.dispose()
			customerWork.tasks--
		}
	}
	/** A UI command captures exact visible revisions and keeps its operation ID on retry. */
	async change(command: TaskCommand) {
		if (this.state.pending || this.#retry) return
		this.state.pending = true
		const generation = this.#generation
		try {
			const session = this.#session ?? (await this.sessionProvider())
			if (generation !== this.#generation) return
			this.#retry = { command, operationId: crypto.randomUUID(), session }
			await this.retry()
		} catch (error) {
			if (generation === this.#generation)
				this.state.error = error instanceof Error ? error.message : String(error)
		} finally {
			if (generation === this.#generation) this.state.pending = false
		}
	}
	get canRetry() {
		return this.#retry !== null
	}
	async retry() {
		const attempt = this.#retry
		if (!attempt) return
		const generation = this.#generation
		this.state.pending = true
		this.state.error = ''
		customerWork.tasks++
		const { operation, ...payload } = attempt.command
		const actor = createTaskActor(attempt.session.repository, () => ({
			ownerSubjectId: attempt.session.subjectId,
			operationId: attempt.operationId,
			intentId: null,
			contributionId: null
		}))
		try {
			const result = JSON.parse((await actor.deliver(`todo_${operation}`, payload)).record)
			if (!result.ok) {
				if (result.effect === 'not-applied' && generation === this.#generation) this.#retry = null
				throw Error(result.error)
			}
			if (generation !== this.#generation) return
			this.#retry = null
			await this.refresh()
		} catch (error) {
			if (generation === this.#generation)
				this.state.error = error instanceof Error ? error.message : String(error)
		} finally {
			actor.dispose()
			customerWork.tasks--
			if (generation === this.#generation) this.state.pending = false
		}
	}
	async reload() {
		await this.refresh()
	}
}
export const todoActor = singleton('aven.saved-tasks', () => new TaskActor())
