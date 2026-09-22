import type { IntentTurnOutbox, TurnDispatch, TurnScope } from './turn-outbox.js'

/** At-least-once delivery of one customer-local queue. The host supplies a fixed,
 * authorized runner transport; no identity token or model-selected destination.
 * admit must key solely on the stable turn/material, never on the dispatch lease.
 */
export class IntentTurnDispatcher {
	constructor(
		private readonly outbox: IntentTurnOutbox,
		private readonly host: {
			admit: (
				scope: TurnScope,
				dispatch: TurnDispatch,
				signal?: AbortSignal
			) => Promise<{ runId: string }>
			/** Only wakes an already admitted run; repeated or lost wakeups are harmless. */
			wake: (
				scope: TurnScope,
				dispatch: TurnDispatch,
				runId: string,
				signal?: AbortSignal
			) => Promise<void>
		}
	) {}

	async dispatch(scope: TurnScope, turnId: string, signal?: AbortSignal): Promise<boolean> {
		signal?.throwIfAborted()
		const claim = await this.outbox.claim(scope, turnId)
		if (claim.state !== 'claimed') return false
		const { dispatch } = claim
		signal?.throwIfAborted()
		const { runId } = await this.host.admit(scope, dispatch, signal)
		// Once admission succeeds, finish its durable binding even during shutdown.
		// A lost wakeup is recovered by the runner; a binding is not a tool effect.
		await this.outbox.dispatched(scope, turnId, dispatch.token, runId)
		if (!signal?.aborted) await this.host.wake(scope, dispatch, runId, signal)
		return true
	}

	/** Failures remain durably pending for their next claim. Other Intents continue. */
	async pump(scope: TurnScope) {
		const pending = await this.outbox.pending(scope)
		return Promise.allSettled(pending.map((turnId) => this.dispatch(scope, turnId)))
	}
}
