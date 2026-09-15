export interface DocumentImportQueueState {
	pending: number
	active: number
}

/** Keep mailbox uploads independent of document execution without unbounded Actor runs. */
export class DocumentImportQueue {
	private readonly tasks: { id: string; run: () => Promise<void> }[] = []
	private readonly admitted = new Set<string>()
	private maxParallelism = 1

	constructor(
		readonly state: DocumentImportQueueState,
		private readonly onError: (id: string, cause: unknown) => void
	) {}

	setMaxParallelism(value: number): void {
		if (!Number.isInteger(value) || value < 1 || value > 32)
			throw new RangeError('Document import parallelism must be between 1 and 32.')
		this.maxParallelism = value
		this.drain()
	}

	enqueue(id: string, run: () => Promise<void>): void {
		if (this.admitted.has(id)) return
		this.admitted.add(id)
		this.tasks.push({ id, run })
		this.state.pending = this.tasks.length
		this.drain()
	}

	private drain(): void {
		while (this.tasks.length && this.state.active < this.maxParallelism) {
			const task = this.tasks.shift()
			if (!task) break
			this.state.pending = this.tasks.length
			this.state.active += 1
			void (async () => {
				try {
					await task.run()
				} catch (cause) {
					this.onError(task.id, cause)
				} finally {
					this.admitted.delete(task.id)
					this.state.active -= 1
					this.drain()
				}
			})()
		}
	}
}
