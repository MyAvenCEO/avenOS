import { randomUUID } from 'node:crypto'

import type { ActorEventInput, EnvelopeInput, EventInput } from '../../persistence-sqlite/src/index'

import { ActorRegistry } from './actor-registry'
import {
	RuntimeActivationAbortedError,
	RuntimeActivationTimeoutError,
	RuntimeCommitError,
	RuntimeNonRetryableError
} from './errors'
import { makeEnvelope } from './envelope-factory'
import { logDebug, logError, logInfo, logWarn } from './logger'
import type {
	ActorContext,
	ActorDecision,
	ActorDebugTrace,
	ActorHandler,
	ActorRuntimeDebug,
	ActorRuntime,
	CreateActorRuntimeInput
} from './types'

const DEFAULT_LEASE_MS = 60_000
const DEFAULT_ACTIVATION_TIMEOUT_MS = 120_000
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
	const debug: ActorRuntimeDebug = {
		recordTrace: (actorId, trace) => {
			void input.persistence
				.appendEvents(buildTraceEvents(actorId, trace))
				.catch((error) =>
					logWarn(input.logger, 'actor-runtime.trace.persist.failed', {
						workerId: input.workerId,
						actorId,
						error: toError(error).message
					})
				)
		}
	}

	return {
		debug,
		register(handler: ActorHandler): void {
			registry.register(handler)
		},

		async enqueue(envelope: EnvelopeInput): Promise<void> {
			await input.persistence.enqueue(envelope)
		},

		async tick(tickInput?: { workerId?: string }): Promise<'processed' | 'idle'> {
			const workerId = tickInput?.workerId ?? input.workerId
			const now = clock()
			await input.persistence.releaseExpiredLocks(now)

			const claimed = await input.persistence.claimNext({
				workerId,
				leaseMs: effectiveLeaseMs,
				now
			})

			if (!claimed) {
				return 'idle'
			}

			const { actor, envelope } = claimed
			logDebug(input.logger, 'actor-runtime.activation.started', {
				workerId,
				actorId: actor.id,
				actorKind: actor.kind,
				envelopeId: envelope.id,
				envelopeType: envelope.type,
				fromActor: envelope.fromActor,
				toActor: envelope.toActor,
				runId: envelope.runId,
				attempts: envelope.attempts
			})
			const handler = registry.get(actor.kind)

			if (!handler) {
				const error = new Error(`No actor handler registered for kind: ${actor.kind}`)
				await failClaimedEnvelope({
					persistence: input.persistence,
					workerId,
					actorId: actor.id,
					actorKind: actor.kind,
					envelopeId: envelope.id,
					envelopeType: envelope.type,
					fromActor: envelope.fromActor,
					toActor: envelope.toActor,
					runId: envelope.runId,
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
				contextSnapshotSeq: await input.persistence.getContextSnapshotSeq(),
				makeEnvelope: (envelopeInput) =>
					makeEnvelope({
						...envelopeInput,
						createdAt: now,
						causedBy: envelopeInput.causedBy ?? envelope.id,
						runId: envelopeInput.runId ?? envelope.runId
					}),
				queryContext: (selector) =>
					input.persistence.listContextItems({
						selector,
						snapshotSeq: context.contextSnapshotSeq
					})
			}

			let activationResult: ActorDecision
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
				await failClaimedEnvelope({
					persistence: input.persistence,
					workerId,
					actorId: actor.id,
					actorKind: actor.kind,
					envelopeId: envelope.id,
					envelopeType: envelope.type,
					fromActor: envelope.fromActor,
					toActor: envelope.toActor,
					runId: envelope.runId,
					error,
					now,
					logger: input.logger
				})
				return 'processed'
			}

			let normalizedResult: ActorDecision
			try {
				normalizedResult = normalizeDecision(activationResult)
			} catch (error) {
				await failClaimedEnvelope({
					persistence: input.persistence,
					workerId,
					actorId: actor.id,
					actorKind: actor.kind,
					envelopeId: envelope.id,
					envelopeType: envelope.type,
					fromActor: envelope.fromActor,
					toActor: envelope.toActor,
					runId: envelope.runId,
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
					workerId,
					envelopeId: envelope.id,
					actorId: actor.id,
					expectedActorVersion: actor.version,
					nextActorState: normalizedResult.nextState,
					contextAppends: normalizedResult.contextAppends,
					commands: [
						...normalizedResult.commands,
						{ type: 'emit_event', event: technicalEvent }
					],
					now
				})
			} catch (error) {
				await failClaimedEnvelope({
					persistence: input.persistence,
					workerId,
					actorId: actor.id,
					actorKind: actor.kind,
					envelopeId: envelope.id,
					envelopeType: envelope.type,
					fromActor: envelope.fromActor,
					toActor: envelope.toActor,
					runId: envelope.runId,
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
				workerId,
				actorId: actor.id,
				actorKind: actor.kind,
				envelopeId: envelope.id,
				envelopeType: envelope.type,
				fromActor: envelope.fromActor,
				toActor: envelope.toActor,
				runId: envelope.runId,
				eventCount: normalizedResult.commands.filter((command) => command.type === 'emit_event').length + 1,
				outgoingCount: normalizedResult.commands.filter((command) => command.type !== 'emit_event').length,
				contextAppendCount: normalizedResult.contextAppends.length
			})

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

function normalizeDecision(result: ActorDecision): ActorDecision {
	if (!result || typeof result !== 'object' || Array.isArray(result)) {
		throw new Error('Actor decision must be an object')
	}

	if (!Object.hasOwn(result, 'nextState')) {
		throw new Error('Actor decision must include nextState')
	}

	if (!Array.isArray(result.contextAppends)) {
		throw new Error('Actor decision contextAppends must be an array')
	}

	if (!Array.isArray(result.commands)) {
		throw new Error('Actor decision commands must be an array')
	}

	return result
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
	runId?: string
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
		runId: input.runId,
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

function buildTraceEvents(actorId: string, trace: ActorDebugTrace): EventInput[] {
	return [{
		type: `actor.io.${trace.kind}`,
		visibility: 'debug',
		actorId,
		payload: { actorId, trace },
		createdAt: trace.at
	}]
}