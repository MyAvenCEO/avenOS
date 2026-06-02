import { EnvelopeStatus, InspectionEventType } from "../core/constants.js";
import type {
  ActorStatus,
  EnvelopeKind,
  SnapshotInvalidationReason,
} from "../core/constants.js";
import type { Clock } from "../core/clock.js";
import type { ActorId } from "../core/actor-id.js";
import type { ActorRef } from "../core/actor-ref.js";
import type { ActorIdString, EnvelopeId, IsoDateTimeString, RuntimeOwnerId } from "../core/ids.js";
import type { JsonValue } from "../core/json.js";
import type { ActorDefinitionMap, ActorPresentation } from "../registry/actor-definition.js";
import type { ActorRegistry, KindOf } from "../registry/actor-type.js";
import type { ActorPersistence } from "../persistence/actor-persistence.js";
import type { StoredRuntimeEvent } from "../persistence/stored-records.js";
import type { RuntimeSnapshot } from "../runtime/event-loop/actor-event-loop.js";
import { buildActorHierarchy } from "./hierarchy-view.js";
import { getActorPresentation } from "./presentation.js";

export interface InspectionSnapshotOptions {
  readonly includeCompletedEnvelopes?: boolean;
  readonly includeDroppedEnvelopes?: boolean;
  readonly completedEnvelopeLimit?: number;
  readonly includeEvents?: boolean;
  readonly includeRuntime?: boolean;
  readonly eventLimit?: number;
}

const DEFAULT_COMPLETED_ENVELOPE_LIMIT = 20;
const DEFAULT_EVENT_LIMIT = 50;

export interface ActorInspectionRecord {
  readonly id: ActorIdString;
  readonly kind: string;
  readonly parentId?: ActorIdString;
  readonly status: ActorStatus;
  readonly behavior: string;
  readonly state: JsonValue;
  readonly init: JsonValue;
  readonly generation: number;
  readonly version: number;
  readonly createdAt: IsoDateTimeString;
  readonly updatedAt: IsoDateTimeString;
  readonly presentation?: ActorPresentation;
}

export interface EnvelopeInspectionRecord {
  readonly id: EnvelopeId;
  readonly kind: EnvelopeKind;
  readonly status: EnvelopeStatus;
  readonly to: ActorIdString;
  readonly toKind: string;
  readonly from?: ActorIdString;
  readonly fromKind?: string;
  readonly message: JsonValue;
  readonly messageType: string;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly notBefore: IsoDateTimeString;
  readonly priority: number;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly dedupeKey?: string;
  readonly leaseOwner?: RuntimeOwnerId;
  readonly leaseUntil?: IsoDateTimeString;
  readonly createdAt: IsoDateTimeString;
  readonly updatedAt: IsoDateTimeString;
}

export interface ActorSystemInspectionSnapshot {
  readonly takenAt: IsoDateTimeString;
  readonly actors: readonly ActorInspectionRecord[];
  readonly envelopes: readonly EnvelopeInspectionRecord[];
  readonly events: readonly StoredRuntimeEvent[];
  readonly runtime?: RuntimeSnapshot;
}

export interface HierarchyOptions {
  readonly rootId?: ActorId;
  readonly includeStopped?: boolean;
  readonly includePresentation?: boolean;
}

export interface ActorHierarchy {
  readonly takenAt: IsoDateTimeString;
  readonly roots: readonly ActorHierarchyNode[];
}

export interface ActorHierarchyNode {
  readonly id: ActorIdString;
  readonly kind: string;
  readonly status: ActorStatus;
  readonly behavior: string;
  readonly generation: number;
  readonly version: number;
  readonly presentation?: ActorPresentation;
  readonly children: readonly ActorHierarchyNode[];
}

export interface ActorInspectionSummary {
  readonly id: ActorIdString;
  readonly kind: string;
  readonly status: ActorStatus;
  readonly behavior: string;
  readonly presentation?: ActorPresentation;
}

export interface ActorMailboxInspection {
  readonly queued: readonly EnvelopeInspectionRecord[];
  readonly processing: readonly EnvelopeInspectionRecord[];
  readonly faulted: readonly EnvelopeInspectionRecord[];
  readonly deadLettered: readonly EnvelopeInspectionRecord[];
  readonly completed?: readonly EnvelopeInspectionRecord[];
  readonly dropped?: readonly EnvelopeInspectionRecord[];
}

export interface ActorInspectionDetail<R extends ActorRegistry> {
  readonly actor: ActorInspectionRecord;
  readonly parent?: ActorInspectionSummary;
  readonly children: readonly ActorInspectionSummary[];
  readonly mailbox: ActorMailboxInspection;
  readonly recentEvents: readonly StoredRuntimeEvent[];
  readonly typedRef?: ActorRef<R, KindOf<R>>;
}

export type InspectionListener = (event: InspectionEvent) => void;

export interface InspectionSubscription {
  unsubscribe(): void;
}

export interface InspectionEvent {
  readonly type: typeof InspectionEventType.SnapshotInvalidated;
  readonly reason: SnapshotInvalidationReason;
  readonly at: IsoDateTimeString;
}

export interface ActorInspector<R extends ActorRegistry> {
  getSnapshot(options?: InspectionSnapshotOptions): Promise<ActorSystemInspectionSnapshot>;
  getHierarchy(options?: HierarchyOptions): Promise<ActorHierarchy>;
  getActor(id: ActorId): Promise<ActorInspectionDetail<R> | undefined>;
  subscribe(listener: InspectionListener): InspectionSubscription;
}

export class LocalActorInspector<R extends ActorRegistry> implements ActorInspector<R> {
  private readonly listeners = new Set<InspectionListener>();

  constructor(
    private readonly persistence: ActorPersistence,
    private readonly definitions: ActorDefinitionMap<R>,
    private readonly runtimeSnapshot: () => RuntimeSnapshot,
    private readonly clock: Clock,
  ) {}

  emit(reason: SnapshotInvalidationReason): void {
    const event: InspectionEvent = {
      type: InspectionEventType.SnapshotInvalidated,
      reason,
      at: this.clock.now().toISOString() as IsoDateTimeString,
    };
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  async getSnapshot(options?: InspectionSnapshotOptions): Promise<ActorSystemInspectionSnapshot> {
    const snapshot = await this.persistence.readSnapshot(options);
    return {
      takenAt: snapshot.takenAt,
      actors: snapshot.actors.map((actor) => ({ ...actor, presentation: getActorPresentation(this.definitions, actor) })),
      envelopes: snapshot.envelopes.map((envelope) => ({ ...envelope, messageType: envelope.message.type })),
      events: snapshot.events,
      runtime: options?.includeRuntime ? this.runtimeSnapshot() : undefined,
    };
  }

  async getHierarchy(options?: HierarchyOptions): Promise<ActorHierarchy> {
    const snapshot = await this.persistence.readSnapshot();
    return buildActorHierarchy(snapshot.actors, this.definitions, snapshot.takenAt, options);
  }

  async getActor(id: ActorId): Promise<ActorInspectionDetail<R> | undefined> {
    const snapshot = await this.persistence.readSnapshot({
      includeCompletedEnvelopes: true,
      includeDroppedEnvelopes: true,
      includeEvents: true,
      completedEnvelopeLimit: DEFAULT_COMPLETED_ENVELOPE_LIMIT,
      eventLimit: DEFAULT_EVENT_LIMIT,
    });
    const actor = snapshot.actors.find((candidate) => candidate.id === id.toString());
    if (!actor) {
      return undefined;
    }
    const parent = actor.parentId
      ? snapshot.actors.find((candidate) => candidate.id === actor.parentId)
      : undefined;
    const children = snapshot.actors.filter((candidate) => candidate.parentId === actor.id);
    const all = snapshot.envelopes.filter((candidate) => candidate.to === actor.id).map((candidate) => ({ ...candidate, messageType: candidate.message.type }));
    return {
      actor: { ...actor, presentation: getActorPresentation(this.definitions, actor) },
      parent: parent
        ? { id: parent.id, kind: parent.kind, status: parent.status, behavior: parent.behavior, presentation: getActorPresentation(this.definitions, parent) }
        : undefined,
      children: children.map((child) => ({ id: child.id, kind: child.kind, status: child.status, behavior: child.behavior, presentation: getActorPresentation(this.definitions, child) })),
      mailbox: {
        queued: all.filter((candidate) => candidate.status === EnvelopeStatus.Queued),
        processing: all.filter((candidate) => candidate.status === EnvelopeStatus.Processing),
        faulted: all.filter((candidate) => candidate.status === EnvelopeStatus.Faulted),
        deadLettered: all.filter((candidate) => candidate.status === EnvelopeStatus.DeadLettered),
        completed: all.filter((candidate) => candidate.status === EnvelopeStatus.Completed),
        dropped: all.filter((candidate) => candidate.status === EnvelopeStatus.Dropped),
      },
      recentEvents: snapshot.events.filter((event) => event.actorId === actor.id).slice(-20),
      typedRef: { id, kind: actor.kind as KindOf<R> },
    };
  }

  subscribe(listener: InspectionListener): InspectionSubscription {
    this.listeners.add(listener);
    return { unsubscribe: () => this.listeners.delete(listener) };
  }
}
