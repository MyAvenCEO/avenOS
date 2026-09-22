import type { WorkerPlacement } from '@avenos/aven-customer-contracts'
import type { WorkerPlacementClient } from '@avenos/aven-customer-runtime'
import type { IntentTurnDispatcher } from './turn-dispatcher.js'
import type { IntentTurnOutbox } from './turn-outbox.js'

export interface TurnSweep {
	placements: number
	candidates: number
	dispatched: number
	failed: number
	checked: number
	blocked: number
	directoryFailed: boolean
	durationMs: number
}

/** Bounded, fair discovery. Separate instances deliver work and supervise state;
 * neither executes the model or its tools. Slow status reads cannot hold delivery.
 * Queue/claim state stays in customer databases; restarting only resets the scan.
 */
export class IntentTurnWorker {
	private cursor: string | undefined
	private readonly stopping = new AbortController()
	private running: Promise<void> | undefined
	private sweep: Promise<TurnSweep> | undefined
	private failures = 0

	constructor(
		private readonly host: {
			placements: Pick<WorkerPlacementClient, 'page'>
			outboxFor(placement: WorkerPlacement): Promise<IntentTurnOutbox>
			dispatcherFor(outbox: IntentTurnOutbox, placement: WorkerPlacement): IntentTurnDispatcher
			supervise(
				outbox: IntentTurnOutbox,
				placement: WorkerPlacement,
				signal: AbortSignal
			): Promise<{ checked: number; blocked: number; unavailable: number }>
			/** Aggregate counters only; no input, credential, customer ID or raw exception. */
			report?(sweep: TurnSweep): void
		},
		private readonly intervalMs = 1000,
		private readonly mode: 'dispatch' | 'supervise' = 'dispatch'
	) {
		if (!Number.isInteger(intervalMs) || intervalMs < 100 || intervalMs > 60_000)
			throw Error('Invalid turn worker interval.')
	}

	start(): void {
		if (this.stopping.signal.aborted) throw Error('Turn worker is closed.')
		this.running ??= this.loop()
	}

	/** Safe for a wakeup and a timer to overlap: a host has only one current sweep. */
	tick(): Promise<TurnSweep> {
		if (this.stopping.signal.aborted) return Promise.reject(Error('Turn worker is closed.'))
		if (!this.sweep)
			this.sweep = this.scan().finally(() => {
				this.sweep = undefined
			})
		return this.sweep
	}

	async close(): Promise<void> {
		this.stopping.abort()
		await this.running
		await this.sweep
	}

	private async loop(): Promise<void> {
		while (!this.stopping.signal.aborted) {
			const result = await this.tick()
			// A broken customer must not increase the latency for healthy customers.
			// Only failure of the shared directory backs off the whole worker.
			this.failures = result.directoryFailed ? Math.min(5, this.failures + 1) : 0
			await this.pause(Math.min(30_000, this.intervalMs * 2 ** this.failures))
		}
	}

	private pause(ms: number): Promise<void> {
		return new Promise((resolve) => {
			const done = () => {
				clearTimeout(timer)
				this.stopping.signal.removeEventListener('abort', done)
				resolve()
			}
			const timer = setTimeout(done, ms)
			this.stopping.signal.addEventListener('abort', done, { once: true })
			if (this.stopping.signal.aborted) done()
		})
	}

	private async scan(): Promise<TurnSweep> {
		const began = performance.now()
		const result: TurnSweep = {
			placements: 0,
			candidates: 0,
			dispatched: 0,
			failed: 0,
			checked: 0,
			blocked: 0,
			directoryFailed: false,
			durationMs: 0
		}
		try {
			let page: Awaited<ReturnType<WorkerPlacementClient['page']>>
			try {
				page = await this.host.placements.page(this.cursor, this.stopping.signal)
			} catch {
				result.directoryFailed = !this.stopping.signal.aborted
				return result
			}
			result.placements = page.placements.length
			// Advance even when one customer's database is unavailable. Retry it on
			// the next complete pass, not at the expense of every following customer.
			this.cursor = page.next ?? undefined
			const groups: Array<{
				dispatcher: IntentTurnDispatcher
				candidates: Awaited<ReturnType<IntentTurnOutbox['pendingForWorker']>>
			}> = []
			// At most four database admissions are in flight; the directory page is <=16.
			for (
				let offset = 0;
				offset < page.placements.length && !this.stopping.signal.aborted;
				offset += 4
			) {
				const batch = await Promise.all(
					page.placements.slice(offset, offset + 4).map(async (placement) => {
						try {
							const outbox = await this.host.outboxFor(placement)
							// Use a separate owned loop for supervision. A slow status service
							// must not delay the interactive delivery loop's next directory page.
							if (this.mode === 'supervise') {
								const supervised = await this.host.supervise(
									outbox,
									placement,
									this.stopping.signal
								)
								result.checked += supervised.checked
								result.blocked += supervised.blocked
								result.failed += supervised.unavailable
								return null
							}
							const candidates = await outbox.pendingForWorker(placement)
							result.candidates += candidates.length
							return { dispatcher: this.host.dispatcherFor(outbox, placement), candidates }
						} catch {
							result.failed++
							return null
						}
					})
				)
				for (const group of batch) if (group) groups.push(group)
			}
			// Interleave customers rather than delivering all sixteen of the first
			// customer's Intents before admitting the next customer's first Intent.
			for (let row = 0; row < 16 && !this.stopping.signal.aborted; row++) {
				const eligible = groups.flatMap((group) =>
					group.candidates[row] ? [{ dispatcher: group.dispatcher, ...group.candidates[row]! }] : []
				)
				for (
					let offset = 0;
					offset < eligible.length && !this.stopping.signal.aborted;
					offset += 4
				) {
					await Promise.all(
						eligible.slice(offset, offset + 4).map(async (item) => {
							try {
								if (await item.dispatcher.dispatch(item.scope, item.turnId, this.stopping.signal))
									result.dispatched++
							} catch {
								if (!this.stopping.signal.aborted) result.failed++
							}
						})
					)
				}
			}
			return result
		} finally {
			result.durationMs = performance.now() - began
			// Diagnostics must never break scheduling or leave an unhandled loop.
			try {
				this.host.report?.(result)
			} catch {
				/* Observer failure cannot own work. */
			}
		}
	}
}
