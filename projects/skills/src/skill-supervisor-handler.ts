import type { ActorHandler } from '@jaensen/actor-runtime'
import {
	createIntentActorId,
	createWorkerActorId,
	parseActorId,
	type ContextAppendInput,
	type EnvelopeInput,
	type EnvelopeRecord
} from '@jaensen/persistence-sqlite'

import { inferCallId } from './call-id'
import { SkillValidationError } from './errors'
import { normalizeWorkerResult } from './normalize-worker-result'
import { parseSkillActorId } from './skill-id'
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
		runId?: string
		causedBy?: string
		availableAt?: Date
	}) => EnvelopeInput
	now: Date
}): { state: SkillSupervisorState; outgoing: EnvelopeInput; contextAppend: ContextAppendInput } {
	const payload = toRecord(input.envelope.payload)
	const callId = requireString(payload.callId, 'skill.request payload.callId is required')
	requireString(payload.request, 'skill.request payload.request is required')
	const intentId = optionalString(payload.intentId)
	const parentCallId = optionalString(payload.parentCallId)
	const replyTo = optionalString(payload.replyTo) ?? input.envelope.fromActor
	const existingCall = input.state.calls[callId]
	const workerActorId = existingCall?.workerActorId ?? createWorkerActorId(input.skillId, selectWorkerPurpose(payload, callId))
	const workerName = parseActorId(workerActorId).segments.at(-1)!
	const existingWorker = input.state.workers[workerActorId]
	const state: SkillSupervisorState = {
		...input.state,
		workers: {
			...input.state.workers,
			[workerActorId]: {
				workerActorId,
				workerName,
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
				workerActorId,
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
			kind: 'handoff',
			visibility: 'worklog',
			intentId,
			callId,
			key: 'skill.request',
			body: payload,
			summary: requireString(payload.request, 'skill.request payload.request is required')
		},
		outgoing: input.makeEnvelope({
			from: input.actorId,
			to: workerActorId,
			type: `${input.skillId}.run`,
			payload: existingWorker ? payload : { ...payload, initialState: {} },
			runId: input.envelope.runId,
			causedBy: input.envelope.id
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
		runId?: string
		causedBy?: string
		availableAt?: Date
	}) => EnvelopeInput
	now: Date
}): { state: SkillSupervisorState; outgoing?: EnvelopeInput; contextAppend?: ContextAppendInput } {
	const payload = toRecord(input.envelope.payload)
	const workerActorId = input.envelope.fromActor
	const payloadWorkerActorId = optionalString(payload.workerActorId)
	if (payloadWorkerActorId && payloadWorkerActorId !== workerActorId) {
		throw new SkillValidationError(`skill.worker.result payload.workerActorId mismatch: ${payloadWorkerActorId} !== ${workerActorId}`)
	}
	const callId = optionalString(payload.callId) ?? input.state.workers[workerActorId]?.callId
	if (!callId) throw new SkillValidationError(`Missing callId for worker result ${workerActorId}`)

	const call = input.state.calls[callId]
	if (!call) throw new SkillValidationError(`Unknown callId ${callId} for worker result ${workerActorId}`)
	if (call.workerActorId !== workerActorId) {
		throw new SkillValidationError(`Call ${callId} is assigned to ${call.workerActorId}, not ${workerActorId}`)
	}

	const normalized = normalizeWorkerResult(payload)
	const completed = normalized.completed
	const workerName = parseActorId(workerActorId).segments.at(-1)!
	const state: SkillSupervisorState = {
		...input.state,
		workers: {
			...input.state.workers,
			[workerActorId]: {
				workerActorId,
				workerName,
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
			kind: 'tool_result',
			visibility: 'worklog',
			intentId: call.intentId,
			callId,
			key: 'skill.worker.result',
			body: normalized.result,
			summary: typeof normalized.result === 'string' ? normalized.result.slice(0, 240) : 'Skill worker result'
		},
		outgoing: input.makeEnvelope({
			from: input.actorId,
			to: shouldReplyToIntent(call) && call.intentId ? createIntentActorId(call.intentId) : call.replyTo,
			type: 'skill.result',
			payload: {
				callId,
				parentCallId: call.parentCallId,
				intentId: call.intentId,
				fromSkillId: input.skillId,
				workerActorId,
				workerName,
				result: normalized.result
			},
			runId: input.envelope.runId,
			causedBy: input.envelope.id
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
			Object.entries(rawWorkers).map(([workerActorId, value]) => {
				const worker = toRecord(value)
				return [workerActorId, {
					workerActorId,
					workerName: typeof worker.workerName === 'string' ? worker.workerName : parseActorId(workerActorId).segments.at(-1) ?? workerActorId,
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
				if (typeof call.workerActorId !== 'string') {
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
					workerActorId: call.workerActorId,
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

function selectWorkerPurpose(payload: Record<string, unknown>, callId: string): string {
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