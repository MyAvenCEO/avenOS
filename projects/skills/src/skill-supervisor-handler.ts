import type { ActorHandler } from '@jaensen/actor-runtime'
import {
	createIntentActorId,
	type EnvelopeInput,
	type EnvelopeRecord
} from '@jaensen/persistence-sqlite'

import { inferCallId, inferIntentId } from './call-id'
import { SkillValidationError } from './errors'
import {
	createSkillWorkerActorId,
	parseSkillActorId
} from './skill-id'
import type {
	CreateSkillSupervisorHandlerInput,
	SkillDefinition,
	SkillSupervisorAction,
	SkillSupervisorState
} from './types'

export function createSkillSupervisorHandler(
	input: CreateSkillSupervisorHandlerInput
): ActorHandler {
	return {
		kind: 'skill-supervisor',
		async activate({ actor, envelope, context }) {
			const actorState = toSupervisorState(actor.state, actor.id)
			const actorIdSkill = parseSkillActorId(actor.id)?.skillId
			const skillId = actorState.skillId ?? actorIdSkill

			if (!skillId) {
				throw new SkillValidationError(`Unable to resolve skillId for actor ${actor.id}`)
			}

			const skill = input.registry.require(skillId)

			if (envelope.type === 'skill.request') {
				const { state, outgoing } = handleSkillRequest({
					actorId: actor.id,
					skillId,
					state: actorState,
					envelope,
					makeEnvelope: context.makeEnvelope,
					now: context.now
				})
				return { state, events: [], outgoing: [outgoing] }
			}

			if (envelope.type === 'skill.bootstrap') {
				return {
					state: actorState,
					events: [],
					outgoing: []
				}
			}

			if (envelope.type === 'skill.worker.result') {
				const { state, outgoing } = handleWorkerResult({
					actorId: actor.id,
					skillId,
					state: actorState,
					envelope,
					makeEnvelope: context.makeEnvelope,
					now: context.now
				})
				return { state, events: [], outgoing: outgoing ? [outgoing] : [] }
			}

			const decision = await input.brain.decide({
				skill,
				actorState,
				envelope,
				signal: context.signal
			})

			const outgoing = (decision.actions ?? []).map((action) =>
				mapSupervisorAction({
					action,
					skill,
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
}): { state: SkillSupervisorState; outgoing: EnvelopeInput } {
	const payload = toRecord(input.envelope.payload)
	const callId = requireString(payload.callId, 'skill.request payload.callId is required')
	requireString(payload.request, 'skill.request payload.request is required')
	const intentId = optionalString(payload.intentId)
	const parentCallId = optionalString(payload.parentCallId)
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
		outgoing: input.makeEnvelope({
			from: input.actorId,
			to: createSkillWorkerActorId(input.skillId, workerId),
			type: `${input.skillId}.run`,
			payload: existingWorker ? payload : { ...payload, initialState: {} },
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
}): { state: SkillSupervisorState; outgoing?: EnvelopeInput } {
	const payload = toRecord(input.envelope.payload)
	const workerId = requireString(payload.workerId, 'skill.worker.result payload.workerId is required')
	const callId = inferCallId(payload) ?? input.state.workers[workerId]?.callId
	if (!callId) {
		throw new SkillValidationError(`Missing callId for worker result ${workerId}`)
	}
	const call = input.state.calls[callId]
	if (!call) {
		throw new SkillValidationError(`Unknown callId ${callId} for worker result ${workerId}`)
	}
	const completed = payload.completed !== false
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
		outgoing: input.makeEnvelope({
			from: input.actorId,
			to: shouldReplyToIntent(call) ? createIntentActorId(call.intentId) : call.replyTo,
			type: 'skill.result',
			payload: {
				callId,
				parentCallId: call.parentCallId,
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

function mapSupervisorAction(input: {
	action: SkillSupervisorAction
	skill: SkillDefinition
	fromActor: string
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
			assertAllowedSkillTarget(input.skill, input.action.to)
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
				to: createSkillWorkerActorId(input.skill.id, input.action.workerId),
				type: input.action.messageType,
				payload: input.action.payload
			})
		}
		case 'spawn_worker': {
			return input.makeEnvelope({
				from: input.fromActor,
				to: createSkillWorkerActorId(input.skill.id, input.action.workerId),
				type: input.action.messageType,
				payload: withInitialState(input.action.payload, input.action.initialState)
			})
		}
		case 'call_skill': {
			return mapDirectSkillCall({
				skill: input.skill,
				fromActor: input.fromActor,
				envelope: input.envelope,
				action: input.action,
				makeEnvelope: input.makeEnvelope
			})
		}
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

function assertAllowedSkillTarget(skill: SkillDefinition, target: string): void {
	if (!target.startsWith('skills/')) {
		return
	}

	if (!skill.directActors.includes(target)) {
		throw new SkillValidationError(
			`Skill ${skill.id} may not send directly to unlisted actor ${target}`
		)
	}
}

function mapDirectSkillCall(input: {
	skill: SkillDefinition
	fromActor: string
	envelope: EnvelopeRecord
	action: Extract<SkillSupervisorAction, { type: 'call_skill' }>
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
	validateDirectSkillCall(input.skill, input.action)
	return input.makeEnvelope({
		from: input.fromActor,
		to: input.action.to,
		type: 'skill.request',
		correlationId: input.envelope.correlationId,
		causationId: input.envelope.id,
		payload: {
			callId: input.action.callId,
			request: input.action.request,
			input: input.action.payload,
			replyTo: input.fromActor,
			intentId: inferIntentId(input.envelope.payload),
			attachmentScopeId: readStringField(input.envelope.payload, 'attachmentScopeId'),
			attachments: readArrayField(input.envelope.payload, 'attachments'),
			parentCallId: inferCallId(input.envelope.payload)
		}
	})
}

function readStringField(payload: unknown, key: string): string | undefined {
	if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
		return undefined
	}
	const value = (payload as Record<string, unknown>)[key]
	return typeof value === 'string' ? value : undefined
}

function readArrayField(payload: unknown, key: string): unknown[] | undefined {
	if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
		return undefined
	}
	const value = (payload as Record<string, unknown>)[key]
	return Array.isArray(value) ? value : undefined
}

function validateDirectSkillCall(
	skill: SkillDefinition,
	action: Extract<SkillSupervisorAction, { type: 'call_skill' }>
): void {
	if (!action.to.startsWith('skills/')) {
		throw new SkillValidationError('Direct skill calls must target skills/<skillId> actors')
	}
	if (action.callId.length === 0) {
		throw new SkillValidationError('Direct skill calls require a non-empty callId')
	}
	if (action.request.length === 0) {
		throw new SkillValidationError('Direct skill calls require a non-empty request')
	}
	if (!skill.directActors.includes(action.to)) {
		throw new SkillValidationError(`Skill ${skill.id} may not call unlisted actor ${action.to}`)
	}
}

function shouldReplyToIntent(call: SkillSupervisorState['calls'][string]): boolean {
	return typeof call.intentId === 'string' && call.replyTo === createIntentActorId(call.intentId)
}