export interface DocumentImportQueueState {
	pending: number
	active: number
}

/** Keep mailbox uploads independent of document execution without unbounded Actor runs. */
export class DocumentImportQueue {
	private readonly tasks: { id: string; run: () => Promise<void> }[] = []
	private readonly admitted = new Set<string>()
	private draining = false

	constructor(
		readonly state: DocumentImportQueueState,
		private readonly onError: (id: string, cause: unknown) => void
	) {}

	enqueue(id: string, run: () => Promise<void>): void {
		if (this.admitted.has(id)) return
		this.admitted.add(id)
		this.tasks.push({ id, run })
		this.state.pending = this.tasks.length
		void this.drain()
	}

	private async drain(): Promise<void> {
		if (this.draining) return
		this.draining = true
		try {
			while (this.tasks.length) {
				const task = this.tasks.shift()
				if (!task) break
				this.state.pending = this.tasks.length
				this.state.active = 1
				try {
					await task.run()
				} catch (cause) {
					this.onError(task.id, cause)
				} finally {
					this.admitted.delete(task.id)
					this.state.active = 0
				}
			}
		} finally {
			this.draining = false
		}
	}
}
