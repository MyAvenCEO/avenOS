import type { ActorDecision, ActorHandler } from '@jaensen/actor-runtime'
import {
	createSkillActorId,
	parseSkillActorId,
	type ContextAppendInput,
	type EnvelopeInput
} from '@jaensen/persistence-sqlite'

import { inferCallId, inferIntentId, inferLocalCallId } from './call-id'
import { parseSkillWorkerActorId } from './skill-id'
import { SkillValidationError } from './errors'
import { normalizeWorkerResult } from './normalize-worker-result'
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
			const activeCall = resolveActiveWorkerCall(actorState, envelope.payload)

			const rawResult = await input.brain.run({
				skill,
				workerActorId: actor.id,
				workerName: parsed.workerName,
				actorState,
				envelope,
				signal: context.signal
			})
			const result = normalizeWorkerResult(rawResult)

			return {
				nextState: withActiveWorkerCall(result.state, activeCall),
				contextAppends: result.contextAppends ?? buildDefaultWorkerContextAppends({ activeCall, result }),
				commands: [
					...(result.events ?? []).map((event) => ({ type: 'emit_event', event }) as const),
					...mapWorkerOutgoing({
					skill,
					actorId: actor.id,
					skillId: parsed.skillId,
					envelope,
						activeCall,
					result,
					makeEnvelope: context.makeEnvelope
					}).map((envelope) => ({ type: 'send_envelope', envelope }) as const)
				]
			} satisfies ActorDecision
		}
	}
}

function mapWorkerOutgoing(input: {
	skill: { id: string; directActors: string[] }
	actorId: string
	skillId: string
	envelope: { id: string; type: string; runId: string | null; payload: unknown }
	activeCall?: ActiveWorkerCall
	result: Awaited<ReturnType<CreateSkillWorkerHandlerInput['brain']['run']>>
	makeEnvelope: (input: {
		from: string
		to: string
		type: string
		payload: unknown
		runId?: string
		causedBy?: string
		availableAt?: Date
	}) => EnvelopeInput
}): EnvelopeInput[] {
	const outgoing: EnvelopeInput[] = []
	const actions = input.result.actions ?? []
	const hasChildActions = actions.some((action) => action.type === 'call_skill')
	const hasFinalResult = input.result.completed
	const continuationCallId = input.activeCall?.callId

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
			runId: input.envelope.runId ?? undefined,
			causedBy: input.envelope.id,
			payload: {
				callId: action.callId,
				request: action.request,
				input: action.payload,
				replyTo: input.actorId,
				intentId: input.activeCall?.intentId,
				attachmentScopeId: readStringField(input.envelope.payload, 'attachmentScopeId'),
				attachments: readArrayField(input.envelope.payload, 'attachments'),
				parentCallId: continuationCallId,
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
			to: createSkillActorId(input.skillId),
			type: 'skill.worker.result',
			runId: input.envelope.runId ?? undefined,
			causedBy: input.envelope.id,
			payload: {
				workerActorId: input.actorId,
				workerName: parseSkillWorkerActorId(input.actorId)?.workerName,
				intentId: input.activeCall?.intentId,
				callId: continuationCallId,
				...optionalParentCallId(input.activeCall?.parentCallId),
				result: input.result.result,
				completed: input.result.completed
			}
		}))
		return outgoing
	}

	if (outgoing.length === 0 && continuationCallId) {
		throw new SkillValidationError(
			'Worker produced no result and no actions for an active skill call'
		)
	}

	return outgoing
}

function buildDefaultWorkerContextAppends(input: {
	activeCall?: ActiveWorkerCall
	result: Awaited<ReturnType<CreateSkillWorkerHandlerInput['brain']['run']>>
}): ContextAppendInput[] {
	const callId = input.activeCall?.callId
	if (!callId || input.result.result === undefined || input.result.result === null) {
		return []
	}
	if (typeof input.result.result === 'string' && input.result.result.length > 1000) {
		return []
	}
	return [{
		kind: 'fact',
		visibility: 'worklog',
		intentId: input.activeCall?.intentId,
		callId,
		key: 'skill.result',
		body: input.result.result,
		summary: typeof input.result.result === 'string' ? input.result.result.slice(0, 240) : 'Skill result'
	}]
}

function validateWorkerDirectSkillCall(
	skill: { id: string; directActors: string[] },
	action: { to: string; callId: string; request: string }
): void {
	if (!parseSkillActorId(action.to)) {
		throw new SkillValidationError('Worker direct skill calls must target canonical skill actors')
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

function readArrayField(payload: unknown, key: string): unknown[] | undefined {
	if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
		return undefined
	}
	const value = (payload as Record<string, unknown>)[key]
	return Array.isArray(value) ? value : undefined
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

type ActiveWorkerCall = {
	callId: string
	parentCallId?: string
	intentId?: string
}

function activeWorkerCall(state: Record<string, unknown>): ActiveWorkerCall | undefined {
	const callId = typeof state.callId === 'string' && state.callId.length > 0 ? state.callId : undefined
	if (!callId) {
		return undefined
	}
	return {
		callId,
		parentCallId: typeof state.parentCallId === 'string' && state.parentCallId.length > 0 ? state.parentCallId : undefined,
		intentId: typeof state.intentId === 'string' && state.intentId.length > 0 ? state.intentId : undefined
	}
}

function resolveActiveWorkerCall(state: unknown, payload: unknown): ActiveWorkerCall | undefined {
	const persisted = activeWorkerCall(toRecord(state))
	if (persisted) {
		return persisted
	}
	const callId = inferLocalCallId(payload)
	if (!callId) {
		return undefined
	}
	return {
		callId,
		parentCallId: readStringField(payload, 'parentCallId'),
		intentId: inferIntentId(payload)
	}
}

function withActiveWorkerCall(state: unknown, call: ActiveWorkerCall | undefined): unknown {
	if (!call) {
		return state
	}
	const record = toRecord(state)
	return {
		...record,
		callId: call.callId,
		parentCallId: call.parentCallId,
		intentId: call.intentId
	}
}

function toRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function optionalParentCallId(parentCallId: string | undefined): { parentCallId?: string } {
	return parentCallId ? { parentCallId } : {}
}