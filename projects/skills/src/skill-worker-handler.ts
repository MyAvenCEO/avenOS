import type { ActorHandler } from '@jaensen/actor-runtime'

import { inferCallId, inferIntentId, inferLocalCallId } from './call-id'
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
				outgoing: mapWorkerOutgoing({
					skill,
					actorId: actor.id,
					skillId: parsed.skillId,
					workerId: parsed.workerId,
					envelope,
					result,
					makeEnvelope: context.makeEnvelope
				})
			}
		}
	}
}

function mapWorkerOutgoing(input: {
	skill: { id: string; directActors: string[] }
	actorId: string
	skillId: string
	workerId: string
	envelope: { id: string; correlationId: string | null; payload: unknown }
	result: Awaited<ReturnType<CreateSkillWorkerHandlerInput['brain']['run']>>
	makeEnvelope: (input: {
		from: string
		to: string
		type: string
		payload: unknown
		correlationId?: string
		causationId?: string
		availableAt?: Date
	}) => unknown
}): unknown[] {
	const outgoing: unknown[] = []
	const actions = input.result.actions ?? []
	const hasChildActions = actions.some((action) => action.type === 'call_skill')
	const hasFinalResult = input.result.completed === true || input.result.result !== undefined
	const localCallId = inferLocalCallId(input.envelope.payload)
	const continuationCallId = input.envelope.type === 'skill.result'
		? inferCallId(input.envelope.payload)
		: localCallId

	if (hasChildActions && hasFinalResult) {
		throw new SkillValidationError(
			'Worker result may not include call_skill actions and also complete in the same response'
		)
	}

	if (hasChildActions && !continuationCallId) {
		throw new SkillValidationError('Worker call_skill actions require an active parent callId')
	}

	for (const action of actions) {
		validateWorkerDirectSkillCall(input.skill, action)
		outgoing.push(input.makeEnvelope({
			from: input.actorId,
			to: action.to,
			type: 'skill.request',
			correlationId: input.envelope.correlationId ?? undefined,
			causationId: input.envelope.id,
			payload: {
				callId: action.callId,
				request: action.request,
				input: action.payload,
				replyTo: input.actorId,
				intentId: inferIntentId(input.envelope.payload),
				parentCallId: continuationCallId
			}
		}))
	}

	if (hasChildActions) {
		return outgoing
	}

	if (hasFinalResult) {
		if (!continuationCallId) {
			throw new SkillValidationError('Worker final results require an active callId')
		}

		outgoing.push(input.makeEnvelope({
			from: input.actorId,
			to: `skill/${input.skillId}`,
			type: 'skill.worker.result',
			correlationId: input.envelope.correlationId ?? undefined,
			causationId: input.envelope.id,
			payload: {
				workerId: input.workerId,
				intentId: readStringField(input.envelope.payload, 'intentId'),
				callId: continuationCallId,
				result: input.result.result,
				completed: input.result.completed ?? false
			}
		}))
		return outgoing
	}

	if (
		outgoing.length === 0 &&
		continuationCallId
	) {
		outgoing.push(input.makeEnvelope({
			from: input.actorId,
			to: `skill/${input.skillId}`,
			type: 'skill.worker.result',
			correlationId: input.envelope.correlationId ?? undefined,
			causationId: input.envelope.id,
			payload: {
				workerId: input.workerId,
				intentId: readStringField(input.envelope.payload, 'intentId'),
				callId: continuationCallId,
				result: input.result.result,
				completed: input.result.completed ?? true
			}
		}))
	}

	return outgoing
}

function validateWorkerDirectSkillCall(
	skill: { id: string; directActors: string[] },
	action: { to: string; callId: string; request: string }
): void {
	if (!action.to.startsWith('skill/')) {
		throw new SkillValidationError('Worker direct skill calls must target skill/<skillId> actors')
	}
	if (!action.callId) {
		throw new SkillValidationError('Worker direct skill calls require a non-empty callId')
	}
	if (!action.request) {
		throw new SkillValidationError('Worker direct skill calls require a non-empty request')
	}
	if (!skill.directActors.includes(action.to)) {
		throw new SkillValidationError(`Skill ${skill.id} may not call unlisted actor ${action.to}`)
	}
}

function readStringField(payload: unknown, key: string): string | undefined {
	if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
		return undefined
	}
	const value = (payload as Record<string, unknown>)[key]
	return typeof value === 'string' ? value : undefined
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