import { randomUUID } from 'node:crypto'

import type { ActorEventInput, EnvelopeInput } from '../../persistence-sqlite/src/index'

import { ActorRegistry } from './actor-registry'
import { ActorIntrospectionRegistry } from './actor-introspection'
import {
	RuntimeActivationAbortedError,
	RuntimeActivationTimeoutError,
	RuntimeCommitError,
	RuntimeNonRetryableError
} from './errors'
import { makeEnvelope } from './envelope-factory'
import { logDebug, logError, logInfo, logWarn } from './logger'
import type {
	ActorActivationResult,
	ActorContext,
	ActorHandler,
	ActorRuntimeDebug,
	ActorRuntime,
	CreateActorRuntimeInput
} from './types'

const DEFAULT_LEASE_MS = 60_000
const DEFAULT_ACTIVATION_TIMEOUT_MS = 60_000
const DEFAULT_ACTIVATION_CLEANUP_MS = 5_000

export function createActorRuntime(input: CreateActorRuntimeInput): ActorRuntime {
	if (input.leaseMs !== undefined && input.leaseMs <= 0) {
		throw new RangeError('leaseMs must be greater than zero')
	}

	if (input.activationTimeoutMs !== undefined && input.activationTimeoutMs <= 0) {
		throw new RangeError('activationTimeoutMs must be greater than zero')
	}

	if (input.activationCleanupMs !== undefined && input.activationCleanupMs <= 0) {
		throw new RangeError('activationCleanupMs must be greater than zero')
	}

	const registry = new ActorRegistry()
	const leaseMs = input.leaseMs ?? DEFAULT_LEASE_MS
	const activationTimeoutMs = input.activationTimeoutMs ?? DEFAULT_ACTIVATION_TIMEOUT_MS
	const activationCleanupMs = input.activationCleanupMs ?? DEFAULT_ACTIVATION_CLEANUP_MS
	const effectiveLeaseMs = Math.max(leaseMs, activationTimeoutMs + activationCleanupMs)
	const clock = input.clock ?? (() => new Date())
	const introspection = new ActorIntrospectionRegistry()
	const debug: ActorRuntimeDebug = {
		getSnapshot: () => introspection.getSnapshot(),
		listEvents: (after = 0) => introspection.listEvents(after),
		subscribe: (listener) => introspection.subscribe(listener),
		seedActor: (actor) => introspection.seedActor(actor),
		recordTrace: (actorId, trace) => introspection.recordTrace(actorId, trace)
	}

	return {
		debug,
		register(handler: ActorHandler): void {
			registry.register(handler)
		},

		async enqueue(envelope: EnvelopeInput): Promise<void> {
			await input.persistence.enqueue(envelope)
			introspection.messageSent({
				id: envelope.id,
				from: envelope.fromActor,
				to: envelope.toActor,
				messageType: envelope.type,
				at: toIsoString(envelope.createdAt ?? clock())
			})
		},

		async tick(): Promise<'processed' | 'idle'> {
			const now = clock()
			await input.persistence.releaseExpiredLocks(now)

			const claimed = await input.persistence.claimNext({
				workerId: input.workerId,
				leaseMs: effectiveLeaseMs,
				now
			})

			if (!claimed) {
				return 'idle'
			}

			const { actor, envelope } = claimed
			introspection.actorSpawned({ id: actor.id, type: actor.kind, name: actor.id })
			introspection.activationStarted(envelope, actor, now)
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
				introspection.activationFailed({ actorId: actor.id, now, task: envelope.type })
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
				signal: new AbortController().signal,
				generateId: () => randomUUID(),
				makeEnvelope: (envelopeInput) =>
					makeEnvelope({
						...envelopeInput,
						createdAt: now,
						causationId: envelopeInput.causationId ?? envelope.id,
						correlationId: envelopeInput.correlationId ?? envelope.correlationId
					})
			}

			let activationResult: ActorActivationResult
			const activationController = new AbortController()
			context.signal = activationController.signal
			try {
				activationResult = await runActivationWithCancellation({
					activate: () => handler.activate({ actor, envelope, context }),
					controller: activationController,
					timeoutMs: activationTimeoutMs,
					actorId: actor.id
				})
			} catch (error) {
				introspection.activationFailed({ actorId: actor.id, now, task: envelope.type })
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
				introspection.activationFailed({ actorId: actor.id, now, task: envelope.type })
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
				introspection.activationFailed({ actorId: actor.id, now, task: envelope.type })
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
			introspection.activationCompleted({ actorId: actor.id, now })
			for (const outgoing of normalizedResult.outgoing) {
				introspection.messageSent({
					id: outgoing.id,
					from: outgoing.fromActor,
					to: outgoing.toActor,
					messageType: outgoing.type,
					at: toIsoString(outgoing.createdAt ?? now)
				})
			}

			return 'processed'
		},

		async runUntilIdle(maxTicks = Number.POSITIVE_INFINITY): Promise<number> {
			if (maxTicks <= 0) {
				return 0
			}

			let processed = 0
			while (processed < maxTicks) {
				let status: 'processed' | 'idle'
				try {
					status = await this.tick()
				} catch (error) {
					logError(input.logger, 'actor-runtime.tick.error', {
						workerId: input.workerId,
						error: toError(error).message,
						kind: classifyError(toError(error))
					})
					processed += 1
					continue
				}
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
	const nonRetryable = error instanceof RuntimeNonRetryableError
	logWarn(input.logger, 'actor-runtime.activation.failed', {
		workerId: input.workerId,
		actorId: input.actorId,
		actorKind: input.actorKind,
		envelopeId: input.envelopeId,
		envelopeType: input.envelopeType,
		fromActor: input.fromActor,
		toActor: input.toActor,
		correlationId: input.correlationId,
		error: error.message,
		kind: classifyError(error),
		nonRetryable
	})

	try {
		await input.persistence.failActivation({
			workerId: input.workerId,
			envelopeId: input.envelopeId,
			error: error.message,
			nonRetryable,
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

async function runActivationWithCancellation<T>(input: {
	activate: () => Promise<T>
	controller: AbortController
	timeoutMs: number
	actorId: string
}): Promise<T> {
	let timeoutHandle: ReturnType<typeof setTimeout> | undefined
	let abortListener: (() => void) | undefined
	const promise = input.activate()
	promise.catch(() => undefined)
	try {
		return await new Promise<T>((resolve, reject) => {
			abortListener = () => {
				const reason = input.controller.signal.reason
				reject(
					reason instanceof Error
						? reason
						: new RuntimeActivationAbortedError(`Actor ${input.actorId} activation aborted`)
				)
			}
			input.controller.signal.addEventListener('abort', abortListener, { once: true })
			timeoutHandle = setTimeout(() => {
				input.controller.abort(
					new RuntimeActivationTimeoutError(
						`[timeout] Actor ${input.actorId} did not produce a valid response within ${input.timeoutMs}ms`
					)
				)
			}, input.timeoutMs)
			promise.then(resolve, reject)
		})
	} finally {
		if (timeoutHandle !== undefined) clearTimeout(timeoutHandle)
		if (abortListener) input.controller.signal.removeEventListener('abort', abortListener)
	}
}

function classifyError(error: Error): string {
	if (error instanceof RuntimeActivationTimeoutError) return 'timeout'
	if (error instanceof RuntimeActivationAbortedError) return 'abort'
	if (error instanceof RuntimeCommitError) return 'commit_conflict'
	if (error instanceof RuntimeNonRetryableError) return error.code
	return 'error'
}

function toIsoString(value: Date | string): string {
	return value instanceof Date ? value.toISOString() : value
}