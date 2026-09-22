import type { WorkerPlacement } from '@avenos/aven-customer-contracts'
import type { WorkerPlacementClient } from '@avenos/aven-customer-runtime'

/** Discover installed customer queues after a cold service restart. A placement
 * only opens the restricted repository; SqlPlanRunner still fences each run and
 * verifies its installed executor, exact engine, lease and work authority. */
export class ActorRecoveryWorker {
	private readonly stopping = new AbortController()
	private cursor: string | undefined
	private loop: Promise<void> | undefined
	private sweep: Promise<void> | undefined
	private failures = 0

	constructor(
		private readonly host: {
			placements: Pick<WorkerPlacementClient, 'page'>
			recover(placement: WorkerPlacement, signal: AbortSignal): Promise<void>
			report?(result: {
				placements: number
				failed: number
				directoryFailed: boolean
				durationMs: number
			}): void
		}
	) {}

	start() {
		if (this.stopping.signal.aborted) throw Error('Actor recovery worker is closed.')
		this.loop ??= this.run()
	}

	tick(): Promise<void> {
		if (this.stopping.signal.aborted)
			return Promise.reject(Error('Actor recovery worker is closed.'))
		this.sweep ??= this.scan().finally(() => {
			this.sweep = undefined
		})
		return this.sweep
	}

	async close() {
		this.stopping.abort()
		await this.loop
		await this.sweep
	}

	private async run() {
		while (!this.stopping.signal.aborted) {
			await this.tick()
			await new Promise<void>((resolve) => {
				const done = () => {
					clearTimeout(timer)
					this.stopping.signal.removeEventListener('abort', done)
					resolve()
				}
				const timer = setTimeout(done, Math.min(30_000, 1000 * 2 ** this.failures))
				this.stopping.signal.addEventListener('abort', done, { once: true })
				if (this.stopping.signal.aborted) done()
			})
		}
	}

	private async scan() {
		const began = performance.now()
		const result = { placements: 0, failed: 0, directoryFailed: false, durationMs: 0 }
		try {
			let page: Awaited<ReturnType<WorkerPlacementClient['page']>>
			try {
				page = await this.host.placements.page(this.cursor, this.stopping.signal)
			} catch {
				result.directoryFailed = !this.stopping.signal.aborted
				this.failures = Math.min(5, this.failures + 1)
				return
			}
			this.failures = 0
			this.cursor = page.next ?? undefined
			result.placements = page.placements.length
			for (
				let offset = 0;
				offset < page.placements.length && !this.stopping.signal.aborted;
				offset += 4
			) {
				await Promise.all(
					page.placements.slice(offset, offset + 4).map(async (placement) => {
						try {
							this.stopping.signal.throwIfAborted()
							await this.host.recover(placement, this.stopping.signal)
						} catch {
							if (!this.stopping.signal.aborted) result.failed++
						}
					})
				)
			}
		} finally {
			result.durationMs = performance.now() - began
			try {
				this.host.report?.(result)
			} catch {
				/* Diagnostics do not own work. */
			}
		}
	}
}
