import type { ActorHandler } from '@jaensen/actor-runtime'
import {
	createIntentActorId,
	type ContextAppendInput,
	type EnvelopeInput,
	type EnvelopeRecord
} from '@jaensen/persistence-sqlite'

import { inferCallId } from './call-id'
import { SkillValidationError } from './errors'
import { createSkillWorkerActorId, parseSkillActorId } from './skill-id'
import type { CreateSkillSupervisorHandlerInput, SkillSupervisorState } from './types'

export function createSkillSupervisorHandler(input: CreateSkillSupervisorHandlerInput): ActorHandler {
	return {
		kind: 'skill-supervisor',
		async activate({ actor, envelope, context }) {
			const actorState = toSupervisorState(actor.state, actor.id)
			const skillId = actorState.skillId || parseSkillActorId(actor.id)?.skillId

			if (!skillId) {
				throw new SkillValidationError(`Unable to resolve skillId for actor ${actor.id}`)
			}

			input.registry.require(skillId)

			switch (envelope.type) {
				case 'skill.bootstrap':
					return { nextState: actorState, contextAppends: [], commands: [] }
				case 'skill.request': {
					const { state, outgoing, contextAppend } = handleSkillRequest({
						actorId: actor.id,
						skillId,
						state: actorState,
						envelope,
						makeEnvelope: context.makeEnvelope,
						now: context.now
					})
					return {
						nextState: state,
						contextAppends: [contextAppend],
						commands: [{ type: 'send_envelope', envelope: outgoing }]
					}
				}
				case 'skill.worker.result': {
					const { state, outgoing, contextAppend } = handleWorkerResult({
						actorId: actor.id,
						skillId,
						state: actorState,
						envelope,
						makeEnvelope: context.makeEnvelope,
						now: context.now
					})
					return {
						nextState: state,
						contextAppends: contextAppend ? [contextAppend] : [],
						commands: outgoing ? [{ type: 'send_envelope', envelope: outgoing }] : []
					}
				}
				default:
					throw new SkillValidationError(`Unsupported envelope type for skill supervisor: ${envelope.type}`)
			}
		}
	}
}

function handleSkillRequest(input: {
	actorId: string
	skillId: string
	state: SkillSupervisorState
	envelope: EnvelopeRecord
	makeEnvelope: (input: {
		from: string
		to: string
		type: string
		payload: unknown
		correlationId?: string
		causationId?: string
		availableAt?: Date
	}) => EnvelopeInput
	now: Date
}): { state: SkillSupervisorState; outgoing: EnvelopeInput; contextAppend: ContextAppendInput } {
	const payload = toRecord(input.envelope.payload)
	const callId = requireString(payload.callId, 'skill.request payload.callId is required')
	requireString(payload.request, 'skill.request payload.request is required')
	const intentId = optionalString(payload.intentId)
	const parentCallId = optionalString(payload.parentCallId)
	const rootCallId = optionalString(payload.rootCallId) ?? callId
	const replyTo = optionalString(payload.replyTo) ?? input.envelope.fromActor
	const workerId = selectWorkerId(payload, callId)
	const existingWorker = input.state.workers[workerId]
	const state: SkillSupervisorState = {
		...input.state,
		workers: {
			...input.state.workers,
			[workerId]: {
				workerId,
				status: 'active',
				intentId,
				callId,
				updatedAt: input.now.toISOString()
			}
		},
		calls: {
			...input.state.calls,
			[callId]: {
				callId,
				rootCallId,
				workerId,
				status: 'active',
				replyTo,
				intentId,
				parentCallId
			}
		}
	}

	return {
		state,
		contextAppend: {
			scope: { type: 'call', callId, parentCallId, rootCallId },
			kind: 'handoff',
			key: 'skill.request',
			tags: ['skill', 'handoff'],
			body: payload,
			summary: requireString(payload.request, 'skill.request payload.request is required'),
			sourceContextItemIds: []
		},
		outgoing: input.makeEnvelope({
			from: input.actorId,
			to: createSkillWorkerActorId(input.skillId, workerId),
			type: `${input.skillId}.run`,
			payload: existingWorker ? { ...payload, rootCallId } : { ...payload, rootCallId, initialState: {} },
			correlationId: input.envelope.correlationId,
			causationId: input.envelope.id
		})
	}
}

function handleWorkerResult(input: {
	actorId: string
	skillId: string
	state: SkillSupervisorState
	envelope: EnvelopeRecord
	makeEnvelope: (input: {
		from: string
		to: string
		type: string
		payload: unknown
		correlationId?: string
		causationId?: string
		availableAt?: Date
	}) => EnvelopeInput
	now: Date
}): { state: SkillSupervisorState; outgoing?: EnvelopeInput; contextAppend?: ContextAppendInput } {
	const payload = toRecord(input.envelope.payload)
	const workerId = requireString(payload.workerId, 'skill.worker.result payload.workerId is required')
	const callId = optionalString(payload.callId) ?? input.state.workers[workerId]?.callId
	const parentCallId = optionalString(payload.parentCallId)
	if (!callId) throw new SkillValidationError(`Missing callId for worker result ${workerId}`)

	const call = input.state.calls[callId]
	if (!call) throw new SkillValidationError(`Unknown callId ${callId} for worker result ${workerId}`)

	const completed = payload.completed !== false
	const rootCallId = call.rootCallId
	const state: SkillSupervisorState = {
		...input.state,
		workers: {
			...input.state.workers,
			[workerId]: {
				workerId,
				status: completed ? 'completed' : 'active',
				intentId: call.intentId,
				callId,
				updatedAt: input.now.toISOString()
			}
		},
		calls: {
			...input.state.calls,
			[callId]: {
				...call,
				status: completed ? 'completed' : 'active'
			}
		}
	}

	return {
		state,
		contextAppend: {
			scope: { type: 'call', callId, parentCallId: call.parentCallId, rootCallId },
			kind: 'tool_result',
			key: 'skill.worker.result',
			tags: ['skill', 'result'],
			body: payload.result,
			summary: typeof payload.result === 'string' ? payload.result.slice(0, 240) : 'Skill worker result',
			sourceContextItemIds: []
		},
		outgoing: input.makeEnvelope({
			from: input.actorId,
			to: shouldReplyToIntent(call) && call.intentId ? createIntentActorId(call.intentId) : call.replyTo,
			type: 'skill.result',
			payload: {
				callId,
				parentCallId: call.parentCallId,
				rootCallId,
				intentId: call.intentId,
				fromSkillId: input.skillId,
				workerId,
				result: payload.result
			},
			correlationId: input.envelope.correlationId,
			causationId: input.envelope.id
		})
	}
}

function toSupervisorState(state: unknown, actorId: string): SkillSupervisorState {
	const record = toRecord(state)
	const skillId = typeof record.skillId === 'string' ? record.skillId : parseSkillActorId(actorId)?.skillId ?? ''
	const rawWorkers = toRecord(record.workers)
	const rawCalls = toRecord(record.calls)
	return {
		skillId,
		workers: Object.fromEntries(
			Object.entries(rawWorkers).map(([workerId, value]) => {
				const worker = toRecord(value)
				return [workerId, {
					workerId,
					status: worker.status === 'completed' || worker.status === 'failed' ? worker.status : 'active',
					intentId: typeof worker.intentId === 'string' ? worker.intentId : undefined,
					callId: typeof worker.callId === 'string' ? worker.callId : undefined,
					updatedAt: typeof worker.updatedAt === 'string' ? worker.updatedAt : new Date(0).toISOString()
				}]
			})
		),
		calls: Object.fromEntries(
			Object.entries(rawCalls).flatMap(([callId, value]) => {
				const call = toRecord(value)
				if (typeof call.workerId !== 'string') {
					return []
				}
				const intentId = typeof call.intentId === 'string' ? call.intentId : undefined
				const replyTo = typeof call.replyTo === 'string'
					? call.replyTo
					: intentId
						? createIntentActorId(intentId)
						: undefined
				if (!replyTo) {
					return []
				}
				return [[callId, {
					callId,
					rootCallId: typeof call.rootCallId === 'string' ? call.rootCallId : callId,
					workerId: call.workerId,
					status: call.status === 'completed' || call.status === 'failed' ? call.status : 'active',
					replyTo,
					intentId,
					parentCallId: typeof call.parentCallId === 'string' ? call.parentCallId : undefined
				}]]
			})
		)
	}
}

function toRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function requireString(value: unknown, message: string): string {
	if (typeof value !== 'string' || value.length === 0) {
		throw new SkillValidationError(message)
	}
	return value
}

function optionalString(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined
}

function selectWorkerId(payload: Record<string, unknown>, callId: string): string {
	if (payload.workerPolicy === 'ephemeral') {
		return callId
	}
	if (typeof payload.topic === 'string' && payload.topic.length > 0) {
		return payload.topic
	}
	return callId
}


function shouldReplyToIntent(call: SkillSupervisorState['calls'][string]): boolean {
	return typeof call.intentId === 'string' && call.replyTo === createIntentActorId(call.intentId)
}