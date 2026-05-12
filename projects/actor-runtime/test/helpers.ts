import { ConcurrencyError } from '../../persistence-sqlite/src/errors'
import type {
	ActorEventInput,
	ActorRecord,
	ClaimedEnvelope,
	EnvelopeInput,
	EnvelopeRecord,
	Persistence,
	SkillRecord,
	SkillRecordInput
} from '../../persistence-sqlite/src/types'

type EnvelopeRow = EnvelopeRecord

export class FakePersistence implements Persistence {
	readonly actors = new Map<string, ActorRecord>()
	readonly envelopes = new Map<string, EnvelopeRow>()
	readonly events: ActorEventInput[] = []
	readonly claims: string[] = []
	claimedLeaseMs: number | null = null
	commitError: Error | null = null

	async migrate(): Promise<void> {}

	async upsertActor(input: { id: string; kind: string; status?: ActorRecord['status']; state?: unknown }): Promise<void> {
		const now = new Date().toISOString()
		const existing = this.actors.get(input.id)
		this.actors.set(input.id, {
			id: input.id,
			kind: input.kind,
			status: input.status ?? existing?.status ?? 'active',
			state: input.state ?? existing?.state ?? {},
			version: existing?.version ?? 0,
			createdAt: existing?.createdAt ?? now,
			updatedAt: now
		})
	}

	async ensureActorExists(input: { id: string; kind: string; status?: ActorRecord['status']; state?: unknown }): Promise<void> {
		if (this.actors.has(input.id)) {
			return
		}

		await this.upsertActor(input)
	}

	async getActor(id: string): Promise<ActorRecord | null> {
		return this.actors.get(id) ?? null
	}

	async enqueue(envelope: EnvelopeInput): Promise<void> {
		const now = toIso(envelope.createdAt ?? new Date('1970-01-01T00:00:00.000Z'))
		this.envelopes.set(envelope.id, {
			id: envelope.id,
			fromActor: envelope.fromActor,
			toActor: envelope.toActor,
			type: envelope.type,
			correlationId: envelope.correlationId,
			causationId: envelope.causationId ?? null,
			payload: envelope.payload,
			status: 'queued',
			availableAt: toIso(envelope.availableAt ?? envelope.createdAt ?? new Date('1970-01-01T00:00:00.000Z')),
			attempts: 0,
			maxAttempts: envelope.maxAttempts ?? 25,
			lockedBy: null,
			lockedUntil: null,
			lastError: null,
			createdAt: now,
			updatedAt: now
		})
	}

	async claimNext(input: { workerId: string; leaseMs: number; now: Date }): Promise<ClaimedEnvelope | null> {
		this.claimedLeaseMs = input.leaseMs
		const claimable = [...this.envelopes.values()]
			.filter((envelope) => envelope.status === 'queued' && envelope.availableAt <= input.now.toISOString())
			.sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]

		if (!claimable) {
			return null
		}

		const actor = this.actors.get(claimable.toActor)
		if (!actor) {
			const kind = claimable.toActor.split('/')[0] ?? 'actor'
			await this.upsertActor({ id: claimable.toActor, kind, state: {} })
		}

		const currentActor = this.actors.get(claimable.toActor)
		if (!currentActor) {
			throw new Error('Failed to create actor')
		}

		const lockedUntil = new Date(input.now.getTime() + input.leaseMs).toISOString()
		const nextEnvelope = {
			...claimable,
			status: 'processing' as const,
			attempts: claimable.attempts + 1,
			lockedBy: input.workerId,
			lockedUntil,
			updatedAt: input.now.toISOString()
		}
		this.envelopes.set(claimable.id, nextEnvelope)
		this.claims.push(claimable.id)

		return {
			envelope: nextEnvelope,
			actor: currentActor
		}
	}

	async commitActivation(input: {
		workerId: string
		envelopeId: string
		actorId: string
		expectedActorVersion: number
		newActorState: unknown
		events: ActorEventInput[]
		outgoing: EnvelopeInput[]
		now: Date
	}): Promise<void> {
		if (this.commitError) {
			throw this.commitError
		}

		const actor = this.actors.get(input.actorId)
		const envelope = this.envelopes.get(input.envelopeId)
		if (!actor || !envelope) {
			throw new Error('Missing actor or envelope')
		}

		if (actor.version !== input.expectedActorVersion) {
			throw new ConcurrencyError(
				`Actor ${input.actorId} version mismatch: expected ${input.expectedActorVersion}, got ${actor.version}`
			)
		}

		this.actors.set(input.actorId, {
			...actor,
			state: input.newActorState,
			version: actor.version + 1,
			updatedAt: input.now.toISOString()
		})

		this.events.push(...input.events)
		for (const outgoing of input.outgoing) {
			await this.enqueue(outgoing)
		}

		this.envelopes.set(input.envelopeId, {
			...envelope,
			status: 'done',
			lockedBy: null,
			lockedUntil: null,
			updatedAt: input.now.toISOString()
		})
	}

	async failActivation(input: {
		workerId: string
		envelopeId: string
		error: string
		nonRetryable?: boolean
		retryAt?: Date
		now: Date
	}): Promise<void> {
		const envelope = this.envelopes.get(input.envelopeId)
		if (!envelope) {
			throw new Error(`Envelope ${input.envelopeId} not found`)
		}

		this.envelopes.set(input.envelopeId, {
			...envelope,
			status: input.nonRetryable ? 'dead' : 'queued',
			availableAt: (input.retryAt ?? input.now).toISOString(),
			lockedBy: null,
			lockedUntil: null,
			lastError: input.error,
			updatedAt: input.now.toISOString()
		})
	}

	async releaseExpiredLocks(_now: Date): Promise<number> {
		return 0
	}

	async replaceSkills(_skills: SkillRecordInput[], _now: Date): Promise<void> {}

	async listSkills(): Promise<SkillRecord[]> {
		return []
	}
}

function toIso(value: Date | string): string {
	return value instanceof Date ? value.toISOString() : value
}