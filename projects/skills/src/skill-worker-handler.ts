import type { ActorHandler } from '@jaensen/actor-runtime'

import { parseSkillWorkerActorId } from './skill-id'
import { SkillValidationError } from './errors'
import type { CreateSkillWorkerHandlerInput } from './types'

export function createSkillWorkerHandler(input: CreateSkillWorkerHandlerInput): ActorHandler {
	return {
		kind: 'skill-worker',
		async activate({ actor, envelope, context }) {
			const parsed = parseSkillWorkerActorId(actor.id)
			if (!parsed) {
				throw new SkillValidationError(`Invalid skill worker actor id: ${actor.id}`)
			}

			const skill = input.registry.require(parsed.skillId)
			const initialState = getInitialState(envelope.payload)
			const actorState = shouldInitializeState(actor.state, initialState) ? initialState : actor.state

			const result = await input.brain.run({
				skill,
				workerId: parsed.workerId,
				actorState,
				envelope
			})

			return {
				state: result.state,
				events: result.events ?? [],
				outgoing: [
					context.makeEnvelope({
						from: actor.id,
						to: `skill/${parsed.skillId}`,
						type: 'skill.worker.result',
						correlationId: envelope.correlationId,
						causationId: envelope.id,
						payload: {
							workerId: parsed.workerId,
							result: result.result,
							completed: result.completed ?? false
						}
					})
				]
			}
		}
	}
}

function getInitialState(payload: unknown): unknown {
	if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
		return undefined
	}

	return (payload as Record<string, unknown>).initialState
}

function shouldInitializeState(currentState: unknown, initialState: unknown): boolean {
	if (initialState === undefined) {
		return false
	}

	if (currentState == null) {
		return true
	}

	if (typeof currentState !== 'object' || Array.isArray(currentState)) {
		return false
	}

	return Object.keys(currentState as Record<string, unknown>).length === 0
}