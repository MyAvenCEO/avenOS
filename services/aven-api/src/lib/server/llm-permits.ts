/** FIFO permits shared by every model route in this API process. */
export class LlmPermits {
	private active = 0
	private readonly waiting: {
		resolve: (release: () => void) => void
		reject: (error: Error) => void
		signal?: AbortSignal
		onAbort?: () => void
	}[] = []

	constructor(readonly maxParallelism: number) {
		if (!Number.isInteger(maxParallelism) || maxParallelism < 1 || maxParallelism > 32)
			throw new Error('LLM parallelism must be between 1 and 32')
	}

	acquire(signal?: AbortSignal): Promise<() => void> {
		if (signal?.aborted) return Promise.reject(new Error('LLM request was cancelled'))
		if (this.active < this.maxParallelism) {
			this.active++
			return Promise.resolve(this.releaseOnce())
		}
		return new Promise((resolve, reject) => {
			const waiter: (typeof this.waiting)[number] = { resolve, reject, signal }
			this.waiting.push(waiter)
			if (signal) {
				waiter.onAbort = () => {
					if (waiter.onAbort) signal.removeEventListener('abort', waiter.onAbort)
					const index = this.waiting.indexOf(waiter)
					if (index >= 0) this.waiting.splice(index, 1)
					reject(new Error('LLM request was cancelled'))
				}
				signal.addEventListener('abort', waiter.onAbort, { once: true })
				if (signal.aborted) waiter.onAbort()
			}
		})
	}

	private releaseOnce(): () => void {
		let released = false
		return () => {
			if (released) return
			released = true
			for (;;) {
				const waiter = this.waiting.shift()
				if (!waiter) {
					this.active--
					return
				}
				if (waiter.onAbort) waiter.signal?.removeEventListener('abort', waiter.onAbort)
				if (waiter.signal?.aborted) {
					waiter.reject(new Error('LLM request was cancelled'))
					continue
				}
				waiter.resolve(this.releaseOnce())
				return
			}
		}
	}
}
