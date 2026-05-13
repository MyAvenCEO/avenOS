import {
	actorKindFromId,
	actorNameFromId,
	actorParentIdFromId,
	type EnvelopeRecord
} from '../../persistence-sqlite/src/index'

import type {
	ActorDebugTrace,
	ActorEvent,
	ActorInfo,
	ActorSnapshot,
	ActorStatus,
	DebugEventCursor,
	DebugEventListener
} from './types'

const MAX_BUFFERED_EVENTS = 500

type MutableActorInfo = ActorInfo

export class ActorIntrospectionRegistry {
	private readonly actors = new Map<string, MutableActorInfo>()
	private readonly events: DebugEventCursor[] = []
	private readonly listeners = new Set<DebugEventListener>()
	private seq = 0

	observeActor(input: Partial<ActorInfo> & Pick<ActorInfo, 'id'>): ActorInfo {
		const actor = this.ensureActor(input.id)
		if (input.parentId !== undefined) actor.parentId = input.parentId
		if (input.type) actor.type = input.type
		if (input.name) actor.name = input.name
		if (input.status) actor.status = input.status
		if (input.currentTask !== undefined) actor.currentTask = input.currentTask
		if (input.mailboxDepth !== undefined) actor.mailboxDepth = Math.max(0, input.mailboxDepth)
		if (input.restartCount !== undefined) actor.restartCount = Math.max(0, input.restartCount)
		if (input.lastEventAt) actor.lastEventAt = input.lastEventAt
		return { ...actor }
	}

	seedActor(input: Partial<ActorInfo> & Pick<ActorInfo, 'id' | 'type' | 'name'>): ActorInfo {
		return this.observeActor({
			status: 'idle',
			mailboxDepth: 0,
			restartCount: 0,
			lastEventAt: new Date().toISOString(),
			...input
		})
	}

	actorSpawned(input: Partial<ActorInfo> & Pick<ActorInfo, 'id'>): ActorInfo {
		const actor = this.observeActor({
			status: 'idle',
			mailboxDepth: 0,
			restartCount: 0,
			lastEventAt: new Date().toISOString(),
			...input
		})
		this.publish({ type: 'ActorSpawned', actor })
		return actor
	}

	messageSent(input: {
		id: string
		from: string
		to: string
		messageType: string
		at: string
	}): void {
		const fromActor = this.ensureActor(input.from)
		fromActor.lastEventAt = input.at
		const toActor = this.ensureActor(input.to)
		toActor.mailboxDepth += 1
		toActor.lastEventAt = input.at
		this.publish({
			type: 'MessageSent',
			id: input.id,
			from: input.from,
			to: input.to,
			messageType: input.messageType,
			at: input.at
		})
	}

	activationStarted(envelope: EnvelopeRecord, actor: { id: string; kind: string }, now: Date): ActorInfo {
		const target = this.ensureActor(actor.id)
		if (target.type === 'actor') target.type = actor.kind
		target.mailboxDepth = Math.max(0, target.mailboxDepth - 1)
		target.currentTask = envelope.type
		return this.updateStatus(actor.id, 'running', now.toISOString(), envelope.type)
	}

	activationCompleted(input: { actorId: string; now: Date; nextStatus?: ActorStatus }): ActorInfo {
		return this.updateStatus(input.actorId, input.nextStatus ?? 'idle', input.now.toISOString(), undefined)
	}

	activationFailed(input: { actorId: string; now: Date; task?: string }): ActorInfo {
		return this.updateStatus(input.actorId, 'failed', input.now.toISOString(), input.task)
	}

	recordTrace(actorId: string, trace: ActorDebugTrace): void {
		const actor = this.ensureActor(actorId)
		actor.lastEventAt = trace.at
		this.publish({ type: 'ActorTraceRecorded', actorId, trace })
	}

	getSnapshot(): ActorSnapshot {
		return {
			actors: [...this.actors.values()].map((actor) => ({ ...actor })).sort((a, b) => a.id.localeCompare(b.id))
		}
	}

	listEvents(after = 0): DebugEventCursor[] {
		return this.events.filter((event) => event.seq > after)
	}

	subscribe(listener: DebugEventListener): () => void {
		this.listeners.add(listener)
		return () => {
			this.listeners.delete(listener)
		}
	}

	private updateStatus(actorId: string, status: ActorStatus, at: string, currentTask?: string): ActorInfo {
		const actor = this.ensureActor(actorId)
		actor.status = status
		actor.currentTask = currentTask
		actor.lastEventAt = at
		const snapshot = { ...actor }
		this.publish({ type: 'ActorStateChanged', actorId, status, at, currentTask })
		return snapshot
	}

	private ensureActor(id: string): MutableActorInfo {
		const existing = this.actors.get(id)
		if (existing) return existing
		const created: MutableActorInfo = {
			id,
			parentId: actorParentIdFromId(id),
			type: actorKindFromId(id),
			name: actorNameFromId(id),
			status: 'idle',
			mailboxDepth: 0,
			restartCount: 0,
			lastEventAt: new Date(0).toISOString()
		}
		this.actors.set(id, created)
		return created
	}

	private publish(event: ActorEvent): void {
		const wrapped = { seq: ++this.seq, event }
		this.events.push(wrapped)
		if (this.events.length > MAX_BUFFERED_EVENTS) {
			this.events.splice(0, this.events.length - MAX_BUFFERED_EVENTS)
		}
		for (const listener of this.listeners) {
			listener(wrapped)
		}
	}
}