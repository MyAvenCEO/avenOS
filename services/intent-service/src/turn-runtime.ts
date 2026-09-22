import type { TenantGrantKey } from '@avenos/aven-customer-contracts'
import { type TenantPoolProvider, WorkerPlacementClient } from '@avenos/aven-customer-runtime'
import { TurnDispatchClient } from './turn-dispatch-client.js'
import { IntentTurnDispatcher } from './turn-dispatcher.js'
import { IntentTurnOutbox } from './turn-outbox.js'
import { TurnStatusClient } from './turn-status-client.js'
import { superviseTurns } from './turn-supervision.js'
import { IntentTurnWorker, type TurnSweep } from './turn-worker.js'

/** Production composition of the tested delivery and supervision loops. Both
 * discover only this runtime's installed components; neither owns a model loop,
 * customer login, or authority to retry an uncertain effect. */
export function createIntentTurnRuntime(
	config: {
		controlUrl: string
		exchangeToken: string
		intentToken: string
		runnerUrl: string
		runnerToken: string
		runtimeId: string
		issuer: string
		publicKey: TenantGrantKey
	},
	pools: Pick<TenantPoolProvider, 'forPlacement'>,
	report?: (mode: 'dispatch' | 'supervise', sweep: TurnSweep) => void
) {
	const placements = new WorkerPlacementClient({
		baseUrl: config.controlUrl,
		serviceToken: config.intentToken,
		runtimeId: config.runtimeId,
		issuer: config.issuer,
		publicKey: config.publicKey,
		componentRef: 'ceo.aven:component:data:intents@1'
	})
	const actors = new WorkerPlacementClient({
		baseUrl: config.controlUrl,
		serviceToken: config.runnerToken,
		runtimeId: config.runtimeId,
		issuer: config.issuer,
		publicKey: config.publicKey,
		componentRef: 'os.aven:component:actors:run-repository@1'
	})
	const dispatch = new TurnDispatchClient(config)
	const worker = (mode: 'dispatch' | 'supervise') =>
		new IntentTurnWorker(
			{
				placements,
				outboxFor: async (placement) => new IntentTurnOutbox(await pools.forPlacement(placement)),
				dispatcherFor: (outbox) =>
					new IntentTurnDispatcher(outbox, {
						admit: (_scope, command, signal) => dispatch.admit(command, signal),
						// Delivery correctness never depends on an in-memory wakeup. The runner's
						// own recovery sweep sees the durable outbox acknowledgement.
						wake: async () => {}
					}),
				supervise: (outbox, placement, signal) =>
					superviseTurns(
						outbox,
						placement,
						new TurnStatusClient({
							baseUrl: config.runnerUrl,
							serviceToken: config.runnerToken,
							placement: (signal) =>
								actors.proof(placement.environmentId, placement.routingGeneration, signal)
						}),
						signal
					),
				report: (sweep) => report?.(mode, sweep)
			},
			1000,
			mode
		)
	const delivery = worker('dispatch'),
		supervision = worker('supervise')
	return {
		start() {
			delivery.start()
			supervision.start()
		},
		async close() {
			await Promise.all([delivery.close(), supervision.close()])
		},
		tick: (mode: 'dispatch' | 'supervise') => (mode === 'dispatch' ? delivery : supervision).tick()
	}
}
