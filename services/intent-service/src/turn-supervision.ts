import type { WorkerPlacement } from '@avenos/aven-customer-contracts'
import type { TurnBlockReason } from '@avenos/intents/work'
import type { IntentTurnOutbox } from './turn-outbox.js'
import type { TurnStatusClient } from './turn-status-client.js'

/** A bounded state projection, not a retry engine. One broken status lookup must
 * not stop checking other Intents or dispatching newly accepted work.
 */
export async function superviseTurns(
	outbox: IntentTurnOutbox,
	placement: WorkerPlacement,
	status: Pick<TurnStatusClient, 'inspect'>,
	signal?: AbortSignal
) {
	const checks = await outbox.statusChecksForWorker(placement)
	const result = { checked: 0, blocked: 0, unavailable: 0 }
	for (let offset = 0; offset < checks.length && !signal?.aborted; offset += 4) {
		await Promise.all(
			checks.slice(offset, offset + 4).map(async (check) => {
				try {
					signal?.throwIfAborted()
					let reason: TurnBlockReason | undefined
					if (check.stopping) {
						const current = await status.inspect(check.run, signal)
						if (current.settlement !== 'pending')
							await outbox.settleStopForWorker(placement, check.run, current.settlement)
					} else if (check.expired) reason = 'WORK_AUTHORITY_EXPIRED'
					else {
						const current = await status.inspect(check.run, signal)
						if (current.state === 'failed')
							reason = current.uncertain ? 'EXECUTION_UNCERTAIN' : 'RUN_FAILED'
						if (current.state === 'cancelled') reason = 'RUN_CANCELLED'
						if (current.state === 'succeeded') reason = 'ANSWER_NOT_SAVED'
					}
					result.checked++
					if (reason && (await outbox.blockForWorker(placement, check.run, reason)))
						result.blocked++
				} catch {
					if (!signal?.aborted) result.unavailable++
				}
			})
		)
	}
	return result
}
