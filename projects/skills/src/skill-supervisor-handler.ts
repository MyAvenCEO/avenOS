import type { ActorHandler } from '@jaensen/actor-runtime'
import type { EnvelopeInput } from '@jaensen/persistence-sqlite'

import { SkillValidationError } from './errors'
import {
	createSkillWorkerActorId,
	parseSkillActorId
} from './skill-id'
import type { CreateSkillSupervisorHandlerInput, SkillSupervisorAction } from './types'

export function createSkillSupervisorHandler(
	input: CreateSkillSupervisorHandlerInput
): ActorHandler {
	return {
		kind: 'skill-supervisor',
		async activate({ actor, envelope, context }) {
			const actorState = toSupervisorState(actor.state)
			const actorIdSkill = parseSkillActorId(actor.id)?.skillId
			const skillId = actorState.skillId ?? actorIdSkill

			if (!skillId) {
				throw new SkillValidationError(`Unable to resolve skillId for actor ${actor.id}`)
			}

			const skill = input.registry.require(skillId)
			const decision = await input.brain.decide({
				skill,
				actorState: actor.state,
				envelope
			})

			const outgoing = (decision.actions ?? []).map((action) =>
				mapSupervisorAction({
					action,
					skillId,
					fromActor: actor.id,
					envelope,
					makeEnvelope: context.makeEnvelope
				})
			)

			return {
				state: decision.state,
				events: decision.events ?? [],
				outgoing
			}
		}
	}
}

function mapSupervisorAction(input: {
	action: SkillSupervisorAction
	skillId: string
	fromActor: string
	envelope: { fromActor: string }
	makeEnvelope: (input: {
		from: string
		to: string
		type: string
		payload: unknown
		correlationId?: string
		causationId?: string
		availableAt?: Date
	}) => EnvelopeInput
}): EnvelopeInput {
	switch (input.action.type) {
		case 'reply': {
			assertNotHumanTarget(input.envelope.fromActor)
			return input.makeEnvelope({
				from: input.fromActor,
				to: input.envelope.fromActor,
				type: input.action.messageType,
				payload: input.action.payload
			})
		}
		case 'send': {
			assertNotHumanTarget(input.action.to)
			return input.makeEnvelope({
				from: input.fromActor,
				to: input.action.to,
				type: input.action.messageType,
				payload: input.action.payload
			})
		}
		case 'route_worker': {
			return input.makeEnvelope({
				from: input.fromActor,
				to: createSkillWorkerActorId(input.skillId, input.action.workerId),
				type: input.action.messageType,
				payload: input.action.payload
			})
		}
		case 'spawn_worker': {
			return input.makeEnvelope({
				from: input.fromActor,
				to: createSkillWorkerActorId(input.skillId, input.action.workerId),
				type: input.action.messageType,
				payload: withInitialState(input.action.payload, input.action.initialState)
			})
		}
	}
}

function toSupervisorState(state: unknown): { skillId?: string; workers?: Record<string, unknown> } {
	if (!state || typeof state !== 'object' || Array.isArray(state)) {
		return {}
	}

	return state as { skillId?: string; workers?: Record<string, unknown> }
}

function withInitialState(payload: unknown, initialState: unknown): unknown {
	if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
		return {
			...(payload as Record<string, unknown>),
			initialState
		}
	}

	return {
		payload,
		initialState
	}
}

function assertNotHumanTarget(target: string): void {
	if (target === 'human') {
		throw new SkillValidationError('Skill supervisors must not send directly to human')
	}
}