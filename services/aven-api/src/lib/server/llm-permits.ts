import type { ModelLane } from './model-observation.js'

/** Routing has first claim on waiting capacity. Reserve one slot when parallel;
 * a one-slot provider admits work after at most three routing requests. Running
 * requests are never preempted. Only the gateway may choose the interactive lane. */
export class LlmPermits {
	private active: Record<ModelLane, number> = { interactive: 0, work: 0 }
	private interactiveBurst = 0
	private readonly waiting: {
		lane: ModelLane
		owner: string
		resolve: (release: () => void) => void
		reject: (error: Error) => void
		signal?: AbortSignal
		onAbort?: () => void
	}[] = []

	constructor(readonly maxParallelism: number) {
		if (!Number.isInteger(maxParallelism) || maxParallelism < 1 || maxParallelism > 32)
			throw new Error('LLM parallelism must be between 1 and 32')
	}

	acquire(signal?: AbortSignal, lane: ModelLane = 'work', owner = 'internal'): Promise<() => void> {
		if (signal?.aborted) return Promise.reject(new Error('LLM request was cancelled'))
		// A saturated work queue must not reject the user's next routing request.
		const laneLimit = lane === 'interactive' ? 32 : 96
		if (
			this.waiting.filter((w) => w.lane === lane).length >= laneLimit ||
			this.waiting.filter((w) => w.lane === lane && w.owner === owner).length >= 16
		)
			return Promise.reject(new Error('LLM queue is full'))
		return new Promise((resolve, reject) => {
			const waiter: (typeof this.waiting)[number] = { resolve, reject, signal, lane, owner }
			this.waiting.push(waiter)
			if (signal) {
				waiter.onAbort = () => {
					if (waiter.onAbort) signal.removeEventListener('abort', waiter.onAbort)
					const index = this.waiting.indexOf(waiter)
					if (index >= 0) this.waiting.splice(index, 1)
					reject(new Error('LLM request was cancelled'))
					this.drain()
				}
				signal.addEventListener('abort', waiter.onAbort, { once: true })
				if (signal.aborted) waiter.onAbort()
			}
			this.drain()
		})
	}

	private drain(): void {
		while (this.active.interactive + this.active.work < this.maxParallelism) {
			const preferred: ModelLane =
				this.maxParallelism === 1 && this.interactiveBurst >= 3 ? 'work' : 'interactive'
			const eligible = (lane: ModelLane) =>
				this.maxParallelism === 1 ||
				this.active[lane] < (lane === 'interactive' ? 1 : this.maxParallelism - 1)
			let index = this.waiting.findIndex((w) => w.lane === preferred && eligible(w.lane))
			if (index < 0) index = this.waiting.findIndex((w) => eligible(w.lane))
			if (index < 0) return
			const waiter = this.waiting.splice(index, 1)[0]!
			if (waiter.onAbort) waiter.signal?.removeEventListener('abort', waiter.onAbort)
			if (waiter.signal?.aborted) {
				waiter.reject(new Error('LLM request was cancelled'))
				continue
			}
			this.active[waiter.lane]++
			this.interactiveBurst =
				waiter.lane === 'interactive' ? Math.min(3, this.interactiveBurst + 1) : 0
			let released = false
			waiter.resolve(() => {
				if (released) return
				released = true
				this.active[waiter.lane]--
				this.drain()
			})
		}
	}
}
