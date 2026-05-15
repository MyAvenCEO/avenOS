import {
	DISPATCHER_ACTOR_ID,
	HUMAN_ACTOR_ID,
	INTENTS_ACTOR_ID,
	SKILLS_ACTOR_ID,
	type Persistence
} from '@jaensen/persistence-sqlite'

import { initialDispatcherState } from '@jaensen/conversation-actors'

import { initialHumanOutboxState } from './human-outbox-handler'

export async function ensureStartupActors(input: { persistence: Persistence }): Promise<void> {
	await input.persistence.ensureActorExists({
		id: DISPATCHER_ACTOR_ID,
		kind: 'dispatcher',
		state: initialDispatcherState
	})

	await input.persistence.ensureActorExists({
		id: HUMAN_ACTOR_ID,
		kind: 'human-outbox',
		state: initialHumanOutboxState
	})

	await input.persistence.ensureActorExists({
		id: INTENTS_ACTOR_ID,
		kind: 'group',
		state: {}
	})

	await input.persistence.ensureActorExists({
		id: SKILLS_ACTOR_ID,
		kind: 'group',
		state: {}
	})
}