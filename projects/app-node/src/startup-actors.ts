import { INTENTS_ACTOR_ID, SKILLS_ACTOR_ID, type Persistence } from '@jaensen/persistence-sqlite'

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

	await input.persistence.ensureActorExists({
		id: INTENTS_ACTOR_ID,
		kind: 'intents',
		state: {}
	})

	await input.persistence.ensureActorExists({
		id: SKILLS_ACTOR_ID,
		kind: 'skills',
		state: {}
	})
}