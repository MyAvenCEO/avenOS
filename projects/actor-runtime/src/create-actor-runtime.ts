import { randomUUID } from 'node:crypto'

import type { ActorEventInput, EnvelopeInput } from '../../persistence-sqlite/src/index'

import { ActorRegistry } from './actor-registry'
import { RuntimeCommitError } from './errors'
import { makeEnvelope } from './envelope-factory'
import { logDebug, logError, logInfo, logWarn } from './logger'
import type {
	ActorActivationResult,
	ActorContext,
	ActorHandler,
	ActorRuntime,
	CreateActorRuntimeInput
} from './types'

const DEFAULT_LEASE_MS = 60_000

export function createActorRuntime(input: CreateActorRuntimeInput): ActorRuntime {
	if (input.leaseMs !== undefined && input.leaseMs <= 0) {
		throw new RangeError('leaseMs must be greater than zero')
	}

	const registry = new ActorRegistry()
	const leaseMs = input.leaseMs ?? DEFAULT_LEASE_MS
	const clock = input.clock ?? (() => new Date())

	return {
		register(handler: ActorHandler): void {
			registry.register(handler)
		},

		async enqueue(envelope: EnvelopeInput): Promise<void> {
			await input.persistence.enqueue(envelope)
		},

		async tick(): Promise<'processed' | 'idle'> {
			const now = clock()
			await input.persistence.releaseExpiredLocks(now)

			const claimed = await input.persistence.claimNext({
				workerId: input.workerId,
				leaseMs,
				now
			})

			if (!claimed) {
				return 'idle'
			}

			const { actor, envelope } = claimed
			logDebug(input.logger, 'actor-runtime.activation.started', {
				workerId: input.workerId,
				actorId: actor.id,
				actorKind: actor.kind,
				envelopeId: envelope.id,
				envelopeType: envelope.type,
				fromActor: envelope.fromActor,
				toActor: envelope.toActor,
				correlationId: envelope.correlationId,
				attempts: envelope.attempts
			})
			const handler = registry.get(actor.kind)

			if (!handler) {
				const error = new Error(`No actor handler registered for kind: ${actor.kind}`)
				await failClaimedEnvelope({
					persistence: input.persistence,
					workerId: input.workerId,
					actorId: actor.id,
					actorKind: actor.kind,
					envelopeId: envelope.id,
					envelopeType: envelope.type,
					fromActor: envelope.fromActor,
					toActor: envelope.toActor,
					correlationId: envelope.correlationId,
					error,
					now,
					logger: input.logger
				})
				return 'processed'
			}

			const context: ActorContext = {
				now,
				makeEnvelope: (envelopeInput) =>
					makeEnvelope({
						...envelopeInput,
						createdAt: now,
						causationId: envelopeInput.causationId ?? envelope.id,
						correlationId: envelopeInput.correlationId ?? envelope.correlationId
					})
			}

			let activationResult: ActorActivationResult
			try {
				activationResult = await handler.activate({ actor, envelope, context })
			} catch (error) {
				await failClaimedEnvelope({
					persistence: input.persistence,
					workerId: input.workerId,
					actorId: actor.id,
					actorKind: actor.kind,
					envelopeId: envelope.id,
					envelopeType: envelope.type,
					fromActor: envelope.fromActor,
					toActor: envelope.toActor,
					correlationId: envelope.correlationId,
					error,
					now,
					logger: input.logger
				})
				return 'processed'
			}

			let normalizedResult: Required<ActorActivationResult>
			try {
				normalizedResult = normalizeActivationResult(activationResult)
			} catch (error) {
				await failClaimedEnvelope({
					persistence: input.persistence,
					workerId: input.workerId,
					actorId: actor.id,
					actorKind: actor.kind,
					envelopeId: envelope.id,
					envelopeType: envelope.type,
					fromActor: envelope.fromActor,
					toActor: envelope.toActor,
					correlationId: envelope.correlationId,
					error,
					now,
					logger: input.logger
				})
				return 'processed'
			}

			const technicalEvent: ActorEventInput = {
				id: randomUUID(),
				actorId: actor.id,
				envelopeId: envelope.id,
				eventType: 'runtime.activation.completed',
				event: {
					envelopeId: envelope.id,
					actorId: actor.id,
					actorKind: actor.kind
				},
				createdAt: now
			}

			try {
				await input.persistence.commitActivation({
					workerId: input.workerId,
					envelopeId: envelope.id,
					actorId: actor.id,
					expectedActorVersion: actor.version,
					newActorState: normalizedResult.state,
					events: [...normalizedResult.events, technicalEvent],
					outgoing: normalizedResult.outgoing,
					now
				})
			} catch (error) {
				await failClaimedEnvelope({
					persistence: input.persistence,
					workerId: input.workerId,
					actorId: actor.id,
					actorKind: actor.kind,
					envelopeId: envelope.id,
					envelopeType: envelope.type,
					fromActor: envelope.fromActor,
					toActor: envelope.toActor,
					correlationId: envelope.correlationId,
					error,
					now,
					logger: input.logger,
					allowFailureError: true
				})

				throw new RuntimeCommitError(`Failed to commit activation for envelope ${envelope.id}`, {
					cause: toError(error)
				})
			}

			logInfo(input.logger, 'actor-runtime.processed', {
				workerId: input.workerId,
				actorId: actor.id,
				actorKind: actor.kind,
				envelopeId: envelope.id,
				envelopeType: envelope.type,
				fromActor: envelope.fromActor,
				toActor: envelope.toActor,
				correlationId: envelope.correlationId,
				eventCount: normalizedResult.events.length + 1,
				outgoingCount: normalizedResult.outgoing.length
			})

			return 'processed'
		},

		async runUntilIdle(maxTicks = Number.POSITIVE_INFINITY): Promise<number> {
			if (maxTicks <= 0) {
				return 0
			}

			let processed = 0
			while (processed < maxTicks) {
				const status = await this.tick()
				if (status === 'idle') {
					break
				}

				processed += 1
			}

			return processed
		}
	}
}

function normalizeActivationResult(result: ActorActivationResult): Required<ActorActivationResult> {
	if (!result || typeof result !== 'object' || Array.isArray(result)) {
		throw new Error('Actor activation result must be an object')
	}

	if (!Object.hasOwn(result, 'state')) {
		throw new Error('Actor activation result must include state')
	}

	const events = result.events ?? []
	const outgoing = result.outgoing ?? []

	if (!Array.isArray(events)) {
		throw new Error('Actor activation result events must be an array')
	}

	if (!Array.isArray(outgoing)) {
		throw new Error('Actor activation result outgoing must be an array')
	}

	return {
		state: result.state,
		events,
		outgoing
	}
}

async function failClaimedEnvelope(input: {
	persistence: CreateActorRuntimeInput['persistence']
	workerId: string
	actorId?: string
	actorKind?: string
	envelopeId: string
	envelopeType?: string
	fromActor?: string
	toActor?: string
	correlationId?: string
	error: unknown
	now: Date
	logger: CreateActorRuntimeInput['logger']
	allowFailureError?: boolean
}): Promise<void> {
	const error = toError(input.error)
	logWarn(input.logger, 'actor-runtime.activation.failed', {
		workerId: input.workerId,
		actorId: input.actorId,
		actorKind: input.actorKind,
		envelopeId: input.envelopeId,
		envelopeType: input.envelopeType,
		fromActor: input.fromActor,
		toActor: input.toActor,
		correlationId: input.correlationId,
		error: error.message
	})

	try {
		await input.persistence.failActivation({
			workerId: input.workerId,
			envelopeId: input.envelopeId,
			error: error.message,
			now: input.now
		})
	} catch (failureError) {
		logError(input.logger, 'actor-runtime.fail-activation.error', {
			workerId: input.workerId,
			envelopeId: input.envelopeId,
			error: toError(failureError).message
		})

		if (!input.allowFailureError) {
			throw failureError
		}
	}
}

function toError(error: unknown): Error {
	if (error instanceof Error) {
		return error
	}

	return new Error(typeof error === 'string' ? error : 'Unknown runtime error')
}