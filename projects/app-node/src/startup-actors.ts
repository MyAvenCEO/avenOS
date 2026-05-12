import type { Persistence } from '@jaensen/persistence-sqlite'

import { initialDispatcherState } from '@jaensen/conversation-actors'

import { initialHumanOutboxState } from './human-outbox-handler'

export async function ensureStartupActors(input: { persistence: Persistence }): Promise<void> {
	await input.persistence.ensureActorExists({
		id: 'dispatcher',
		kind: 'dispatcher',
		state: initialDispatcherState
	})

	await input.persistence.ensureActorExists({
		id: 'human',
		kind: 'human-outbox',
		state: initialHumanOutboxState
	})
}