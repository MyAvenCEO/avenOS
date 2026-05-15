import { ConcurrencyError } from '../../persistence-sqlite/src/errors'
import type {
	ActorCommand,
	ActorEventInput,
	ActorHierarchyRecord,
	ActorLogRecord,
	ActorRecord,
	ClaimedEnvelope,
	ContextAppendInput,
	ContextItemRecord,
	ContextQuery,
	CommunicationTreeRecord,
	CommunicationTreeSummary,
	EnvelopeInput,
	EnvelopeRecord,
	EventInput,
	EventRecord,
	Persistence,
	SkillRecord,
	SkillRecordInput,
} from '../../persistence-sqlite/src/types'

type EnvelopeRow = EnvelopeRecord

export class FakePersistence implements Persistence {
	readonly actors = new Map<string, ActorRecord>()
	readonly envelopes = new Map<string, EnvelopeRow>()
	readonly events: ActorEventInput[] = []
	readonly appendedEvents: EventRecord[] = []
	readonly contextItems: ContextItemRecord[] = []
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
			runId: envelope.runId,
			causedBy: envelope.causedBy ?? null,
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
		nextActorState: unknown
		contextAppends: ContextAppendInput[]
		commands: ActorCommand[]
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
			state: input.nextActorState,
			version: actor.version + 1,
			updatedAt: input.now.toISOString()
		})

		for (const append of input.contextAppends) {
			this.contextItems.push({
				seq: this.contextItems.length + 1,
				kind: append.kind,
				visibility: append.visibility ?? 'worklog',
				runId: append.runId ?? envelope.runId,
				intentId: append.intentId ?? null,
				actorId: append.actorId ?? input.actorId,
				envelopeId: append.envelopeId ?? input.envelopeId,
				callId: append.callId ?? null,
				key: append.key ?? null,
				summary: append.summary ?? null,
				body: append.body,
				artifactUri: append.artifactUri ?? null,
				createdAt: append.createdAt ? toIso(append.createdAt) : input.now.toISOString()
			})
		}

		for (const command of input.commands) {
			if (command.type === 'emit_event') {
				this.events.push(command.event)
				continue
			}

			await this.enqueue(
				command.type === 'send_envelope'
					? command.envelope
					: { ...command.envelope, availableAt: command.availableAt }
			)
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

	async appendEvents(events: EventInput[]): Promise<number[]> {
		const seqs: number[] = []
		for (const event of events) {
			const seq = this.appendedEvents.length + 1
			this.appendedEvents.push({
				seq,
				type: event.type,
				visibility: event.visibility,
				runId: event.runId ?? null,
				intentId: event.intentId ?? null,
				actorId: event.actorId ?? null,
				envelopeId: event.envelopeId ?? null,
				callId: event.callId ?? null,
				parentSeq: event.parentSeq ?? null,
				payload: event.payload,
				createdAt: toIso(event.createdAt ?? new Date())
			})
			seqs.push(seq)
		}
		return seqs
	}

	async listEvents(input: { after?: number; limit?: number; visibility?: EventRecord['visibility'] | EventRecord['visibility'][]; runId?: string; intentId?: string; actorId?: string; callId?: string }): Promise<EventRecord[]> {
		const visibilityValues = input.visibility ? (Array.isArray(input.visibility) ? input.visibility : [input.visibility]) : null
		return this.appendedEvents
			.filter((event) => event.seq > (input.after ?? 0))
			.filter((event) => !visibilityValues || visibilityValues.includes(event.visibility))
			.filter((event) => !input.runId || event.runId === input.runId)
			.filter((event) => !input.intentId || event.intentId === input.intentId)
			.filter((event) => !input.actorId || event.actorId === input.actorId)
			.filter((event) => !input.callId || event.callId === input.callId)
			.slice(0, input.limit ?? 200)
	}

	async appendContext(input: ContextAppendInput): Promise<number> {
		const seq = this.contextItems.length + 1
		this.contextItems.push({
			seq,
			kind: input.kind,
			visibility: input.visibility ?? 'worklog',
			runId: input.runId ?? null,
			intentId: input.intentId ?? null,
			actorId: input.actorId ?? null,
			envelopeId: input.envelopeId ?? null,
			callId: input.callId ?? null,
			key: input.key ?? null,
			summary: input.summary ?? null,
			body: input.body,
			artifactUri: input.artifactUri ?? null,
			createdAt: input.createdAt ? toIso(input.createdAt) : new Date().toISOString()
		})
		return seq
	}

	async listContextItems(input: { selector: ContextQuery; snapshotSeq?: number }): Promise<ContextItemRecord[]> {
		return this.contextItems.filter((item) => {
			if (input.snapshotSeq !== undefined && item.seq > input.snapshotSeq) return false
			if (input.selector.afterSeq !== undefined && item.seq <= input.selector.afterSeq) return false
			if (input.selector.runId && item.runId !== input.selector.runId) return false
			if (input.selector.intentId && item.intentId !== input.selector.intentId) return false
			if (input.selector.actorId && item.actorId !== input.selector.actorId) return false
			if (input.selector.callId && item.callId !== input.selector.callId) return false
			if (input.selector.visibility) {
				const visibilities = Array.isArray(input.selector.visibility) ? input.selector.visibility : [input.selector.visibility]
				if (!visibilities.includes(item.visibility)) return false
			}
			if (input.selector.kind) {
				const kinds = Array.isArray(input.selector.kind) ? input.selector.kind : [input.selector.kind]
				if (!kinds.includes(item.kind)) return false
			}
			return true
		})
	}

	async getContextSnapshotSeq(): Promise<number> {
		return this.contextItems.at(-1)?.seq ?? 0
	}

	async listActorHierarchy(_input: { rootActorId: string; observed?: boolean; includeRoot?: boolean }): Promise<ActorHierarchyRecord[]> {
		return []
	}

	async listActorBranchLogs(_input: {
		rootActorId: string
		view?: 'chat' | 'deep-dive'
		after?: number
		limit?: number
	}): Promise<ActorLogRecord[]> {
		return []
	}

	async listCommunicationTree(_input: {
		runId?: string
		intentId?: string
		rootEnvelopeId?: string
		view?: 'chat' | 'deep-dive'
	}): Promise<CommunicationTreeRecord[]> {
		return []
	}

	async summarizeCommunicationTree(_input: {
		runId?: string
		intentId?: string
		rootEnvelopeId?: string
		view?: 'chat' | 'deep-dive'
	}): Promise<CommunicationTreeSummary> {
		return {
			rootCount: 0,
			envelopeCount: 0,
			logCount: 0,
			actorCount: 0,
			actorIoCount: 0,
			errorCount: 0,
			startedAt: null,
			endedAt: null
		}
	}
}

function toIso(value: Date | string): string {
	return value instanceof Date ? value.toISOString() : value
}