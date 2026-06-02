import {
  ActorErrorCode,
  ActorStatus,
  EnvelopeKind,
  EnvelopeStatus,
  FailedMessageAction,
  RestartReasonType,
  RuntimeEventType,
  SnapshotInvalidationReason,
  StopReasonType,
  SupervisionDirectiveType,
  SystemMessageType,
} from "../core/constants.js";
import { ActorId } from "../core/actor-id.js";
import { actorRef, type ActorRef } from "../core/actor-ref.js";
import type { Clock } from "../core/clock.js";
import { ActorSystemError, serializeRuntimeError } from "../core/errors.js";
import type { IdGenerator } from "../core/ids.js";
import { toIsoDateTimeString } from "../core/ids.js";
import { assertJsonValue, cloneJson } from "../core/json.js";
import type { EnvelopeView } from "../messaging/envelope.js";
import type { RequiredSendOptions } from "../messaging/send-options.js";
import type { ActorDefinitionMap } from "../registry/actor-definition.js";
import type { ActorRegistry, KindOf } from "../registry/actor-type.js";
import {
  ActorCreateMode,
  type ActivationClaim,
  type ActivationCommit,
  type ActivationFailureCommit,
  type ActorPersistence,
  type ClaimedActivation,
} from "../persistence/actor-persistence.js";
import type { StoredActor, StoredEnvelope, StoredRuntimeEvent } from "../persistence/stored-records.js";
import { createActorContext } from "./activation/actor-context.js";
import { EffectBuffer, EffectType } from "./activation/effect-buffer.js";
import type { ActivationRunResult } from "./activation/activation-runner.js";
import { runOnRestart, runOnStart, runOnStop } from "./lifecycle/lifecycle-runner.js";
import type { RestartReason, StopReason } from "./lifecycle/lifecycle-types.js";
import type { RuntimeOptions } from "./runtime-options.js";
import { RuntimeDefaults } from "./runtime-options.js";
import type { ActorFailure, SerializedActorError, SupervisionDirective } from "./supervision/supervision-types.js";
import { runSupervision } from "./supervision/supervision-runner.js";

export interface RuntimeInvalidationSink {
  invalidate(reason: typeof SnapshotInvalidationReason[keyof typeof SnapshotInvalidationReason]): void;
}

export class ActorRuntime<R extends ActorRegistry> {
  constructor(
    readonly registry: R,
    readonly definitions: ActorDefinitionMap<R>,
    readonly persistence: ActorPersistence,
    readonly clock: Clock,
    readonly ids: IdGenerator,
    readonly runtimeOptions: RuntimeOptions,
    private readonly invalidation: RuntimeInvalidationSink,
  ) {}

  get defaultMessageMaxAttempts(): number {
    return this.runtimeOptions.defaultMessageMaxAttempts ?? RuntimeDefaults.DefaultMessageMaxAttempts;
  }

  private get nowIso(): string {
    return toIsoDateTimeString(this.clock.now());
  }

  private statusChangedEvent(
    actorId: string,
    previousStatus: ActorStatus,
    currentStatus: ActorStatus,
  ): StoredRuntimeEvent<typeof RuntimeEventType.ActorStatusChanged> {
    return {
      id: this.ids.runtimeEventId(),
      type: RuntimeEventType.ActorStatusChanged,
      actorId: actorId as never,
      data: {
        actorId: actorId as never,
        previousStatus,
        currentStatus,
      },
      createdAt: this.nowIso as never,
    };
  }

  private envelopeCreatedEvent(envelope: StoredEnvelope): StoredRuntimeEvent<typeof RuntimeEventType.EnvelopeCreated> {
    return {
      id: this.ids.runtimeEventId(),
      type: RuntimeEventType.EnvelopeCreated,
      actorId: envelope.to,
      envelopeId: envelope.id,
      data: {
        envelopeId: envelope.id,
        to: envelope.to,
        kind: envelope.kind,
        messageType: envelope.message.type,
      },
      createdAt: this.nowIso as never,
    };
  }

  private envelopeStatusChangedEvent(
    actorId: string,
    envelopeId: StoredEnvelope["id"],
    previousStatus: EnvelopeStatus,
    currentStatus: EnvelopeStatus,
  ): StoredRuntimeEvent<typeof RuntimeEventType.EnvelopeStatusChanged> {
    return {
      id: this.ids.runtimeEventId(),
      type: RuntimeEventType.EnvelopeStatusChanged,
      actorId: actorId as never,
      envelopeId,
      data: {
        envelopeId,
        actorId: actorId as never,
        previousStatus,
        currentStatus,
      },
      createdAt: this.nowIso as never,
    };
  }

  private supervisionAppliedEvent(
    parentId: string,
    childId: string,
    directive: SupervisionDirective["type"],
  ): StoredRuntimeEvent<typeof RuntimeEventType.SupervisionApplied> {
    return {
      id: this.ids.runtimeEventId(),
      type: RuntimeEventType.SupervisionApplied,
      actorId: parentId as never,
      data: {
        parentId: parentId as never,
        childId: childId as never,
        directive,
      },
      createdAt: this.nowIso as never,
    };
  }

  private mergeActorUpdates(
    updates: readonly ActivationCommit["actorUpdates"][number][],
  ): Array<ActivationCommit["actorUpdates"][number]> {
    const merged = new Map<string, ActivationCommit["actorUpdates"][number]>();
    for (const update of updates) {
      const existing = merged.get(update.id);
      if (!existing) {
        merged.set(update.id, update);
        continue;
      }
      merged.set(update.id, {
        ...existing,
        patch: {
          ...existing.patch,
          ...update.patch,
        },
        updatedAt: update.updatedAt,
      });
    }
    return [...merged.values()];
  }

  private ensureBehaviorExists(kind: KindOf<R>, behavior: string): void {
    const definition = this.definitions[kind];
    if (!(behavior in definition.receive)) {
      throw new ActorSystemError(
        ActorErrorCode.InvalidBehavior,
        `Behavior ${behavior} is not defined for actor kind ${kind}`,
      );
    }
  }

  private ensureRootId(id: ActorId): void {
    if (!id.isRoot()) {
      throw new ActorSystemError(
        ActorErrorCode.InvalidChildIdentity,
        `Root actor id must be a root path: ${id.toString()}`,
      );
    }
  }

  private validateSpawnTarget(parentId: ActorId, childId: ActorId): void {
    if (!childId.isDescendantOf(parentId)) {
      throw new ActorSystemError(
        ActorErrorCode.InvalidChildIdentity,
        `Child id ${childId.toString()} must be a strict descendant of ${parentId.toString()}`,
      );
    }
  }

  private async validateEffects(
    claimed: ClaimedActivation,
    effects: EffectBuffer<R, KindOf<R>>,
  ): Promise<void> {
    const definition = this.definitions[claimed.actor.kind as KindOf<R>];
    for (const effect of effects.all()) {
      switch (effect.type) {
        case EffectType.Send:
          if (typeof effect.message.type !== "string") {
            throw new ActorSystemError(ActorErrorCode.UnhandledMessage, "Outgoing message must contain a type string");
          }
          assertJsonValue(effect.message);
          break;
        case EffectType.Spawn:
          assertJsonValue(effect.init);
          this.validateSpawnTarget(effect.parent.id, effect.childId);
          break;
        case EffectType.SetState:
          assertJsonValue(effect.state);
          break;
        case EffectType.Become:
          this.ensureBehaviorExists(claimed.actor.kind as KindOf<R>, effect.behavior);
          if (effect.state !== undefined) {
            assertJsonValue(effect.state);
          }
          break;
        case EffectType.StopChild: {
          const child = await this.persistence.loadActor(effect.childId);
          if (!child || child.parentId !== claimed.actor.id) {
            throw new ActorSystemError(
              ActorErrorCode.InvalidChildIdentity,
              `stopChild target ${effect.childId.toString()} must be a direct child of ${claimed.actor.id}`,
            );
          }
          break;
        }
        case EffectType.StopSelf:
          break;
      }
    }
    this.ensureBehaviorExists(claimed.actor.kind as KindOf<R>, claimed.actor.behavior);
    void definition;
  }

  private makeUserEnvelope(
    claimed: ClaimedActivation,
    to: ActorRef<R, KindOf<R>>,
    message: StoredEnvelope["message"],
    options: RequiredSendOptions,
    now: Date,
  ): StoredEnvelope {
    return {
      id: this.ids.envelopeId(),
      kind: EnvelopeKind.User,
      to: to.id.toString(),
      toKind: to.kind,
      from: claimed.actor.id,
      fromKind: claimed.actor.kind,
      message,
      status: EnvelopeStatus.Queued,
      attempt: 0,
      maxAttempts: options.maxAttempts,
      notBefore: toIsoDateTimeString(options.notBefore),
      priority: options.priority,
      createdAt: toIsoDateTimeString(now),
      updatedAt: toIsoDateTimeString(now),
      ...(options.correlationId !== undefined ? { correlationId: options.correlationId } : {}),
      ...(options.causationId !== undefined ? { causationId: options.causationId } : {}),
      ...(options.dedupeKey !== undefined ? { dedupeKey: options.dedupeKey } : {}),
    };
  }

  private makeLifecycleStopEnvelope(
    actor: Pick<StoredActor, "id" | "kind">,
    reason: StopReason,
    now: Date,
  ): StoredEnvelope {
    return {
      id: this.ids.envelopeId(),
      kind: EnvelopeKind.LifecycleStop,
      to: actor.id,
      toKind: actor.kind,
      message: { type: SystemMessageType.LifecycleStop, reason } as StoredEnvelope["message"],
      status: EnvelopeStatus.Queued,
      attempt: 0,
      maxAttempts: 1,
      notBefore: toIsoDateTimeString(now),
      priority: Number.MAX_SAFE_INTEGER,
      createdAt: toIsoDateTimeString(now),
      updatedAt: toIsoDateTimeString(now),
    };
  }

  private makeLifecycleRestartEnvelope(
    actor: Pick<StoredActor, "id" | "kind">,
    reason: RestartReason,
    now: Date,
  ): StoredEnvelope {
    return {
      id: this.ids.envelopeId(),
      kind: EnvelopeKind.LifecycleRestart,
      to: actor.id,
      toKind: actor.kind,
      message: { type: SystemMessageType.LifecycleRestart, reason } as StoredEnvelope["message"],
      status: EnvelopeStatus.Queued,
      attempt: 0,
      maxAttempts: 1,
      notBefore: toIsoDateTimeString(now),
      priority: 0,
      createdAt: toIsoDateTimeString(now),
      updatedAt: toIsoDateTimeString(now),
    };
  }

  private makeEnvelopeView(envelope: StoredEnvelope): EnvelopeView {
    const view: EnvelopeView = {
      id: envelope.id,
      kind: envelope.kind,
      attempt: envelope.attempt,
      maxAttempts: envelope.maxAttempts,
      createdAt: envelope.createdAt,
    };
    if (envelope.correlationId !== undefined) {
      (view as { correlationId: string }).correlationId = envelope.correlationId;
    }
    if (envelope.causationId !== undefined) {
      (view as { causationId: string }).causationId = envelope.causationId;
    }
    return view;
  }

  private invalidate(reason: typeof SnapshotInvalidationReason[keyof typeof SnapshotInvalidationReason]): void {
    this.invalidation.invalidate(reason);
  }

  async emitInfrastructureEvent(event: import("./runtime-options.js").RuntimeInfrastructureEvent): Promise<void> {
    const sink = this.runtimeOptions.infrastructureLogSink;
    if (!sink) {
      return;
    }
    try {
      await sink.emit(event);
    } catch {
      // Logging must never cascade into primary runtime failures.
    }
  }

  private validateMessage(claimed: ClaimedActivation): void {
    const definition = this.definitions[claimed.actor.kind as KindOf<R>];
    if (claimed.envelope.kind !== EnvelopeKind.User) {
      return;
    }
    if (!definition.isMessage) {
      return;
    }
    if (!definition.isMessage(claimed.envelope.message)) {
      throw new ActorSystemError(ActorErrorCode.UnhandledMessage, "Message validation failed");
    }
  }

  private async runWithActivationTimeout<T>(
    execute: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    const activationTimeoutMs = this.runtimeOptions.activationTimeoutMs ?? RuntimeDefaults.ActivationTimeoutMs;
    const abortPromise = new Promise<never>((_, reject) => {
      controller.signal.addEventListener(
        "abort",
        () => {
          reject(new ActorSystemError(ActorErrorCode.UnhandledMessage, "Activation timed out"));
        },
        { once: true },
      );
    });
    const timeout = setTimeout(() => {
      controller.abort();
    }, activationTimeoutMs);
    const execution = execute(controller.signal);
    try {
      return await Promise.race([execution, abortPromise]);
    } finally {
      clearTimeout(timeout);
      execution.catch(() => {
        // The activation outcome was already decided by the race winner.
      });
    }
  }

  async createRoot<K extends KindOf<R>>(
    kind: K,
    id: ActorId,
    init: unknown,
    ifExists: ActorCreateMode,
  ): Promise<ActorRef<R, K>> {
    this.ensureRootId(id);
    const definition = this.definitions[kind];
    const now = this.clock.now();
    assertJsonValue(init);
    const initialized = definition.init(init as never);
    this.ensureBehaviorExists(kind, initialized.behavior);
    assertJsonValue(initialized.state);
    const actor: StoredActor = {
      id: id.toString(),
      kind,
      status: ActorStatus.Starting,
      behavior: initialized.behavior,
      state: cloneJson(initialized.state as never),
      init: cloneJson(init as never),
      generation: 0,
      version: 0,
      createdAt: toIsoDateTimeString(now),
      updatedAt: toIsoDateTimeString(now),
    };
    const startEnvelope: StoredEnvelope = {
      id: this.ids.envelopeId(),
      kind: EnvelopeKind.LifecycleStart,
      to: actor.id,
      toKind: actor.kind,
      message: { type: SystemMessageType.LifecycleStart },
      status: EnvelopeStatus.Queued,
      attempt: 0,
      maxAttempts: 1,
      notBefore: toIsoDateTimeString(now),
      priority: 0,
      createdAt: toIsoDateTimeString(now),
      updatedAt: toIsoDateTimeString(now),
    };
    const event: StoredRuntimeEvent = {
      id: this.ids.runtimeEventId(),
      type: RuntimeEventType.ActorCreated,
      actorId: actor.id,
      data: { actorId: actor.id, kind },
      createdAt: toIsoDateTimeString(now),
    };
    await this.persistence.createActor({ actor, startEnvelope, events: [event, this.envelopeCreatedEvent(startEnvelope)], ifExists });
    this.invalidate(SnapshotInvalidationReason.RuntimeChanged);
    return actorRef(id, kind);
  }

  async externalSend<TTarget extends KindOf<R>>(
    to: ActorRef<R, TTarget>,
    message: unknown,
    options?: {
      readonly notBefore?: Date;
      readonly priority?: number;
      readonly correlationId?: string;
      readonly dedupeKey?: string;
      readonly maxAttempts?: number;
    },
  ): Promise<StoredEnvelope["id"]> {
    try {
      assertJsonValue(message);
      const definition = this.definitions[to.kind];
      if (definition.isMessage && !definition.isMessage(message)) {
        throw new ActorSystemError(ActorErrorCode.UnhandledMessage, "External message validation failed");
      }
    } catch (error) {
      await this.emitInfrastructureEvent({
        type: "externalMessageRejected",
        occurredAt: this.nowIso,
        actorId: to.id.toString(),
        actorKind: String(to.kind),
        messageType: typeof (message as { type?: unknown } | null | undefined)?.type === "string"
          ? (message as { type: string }).type
          : undefined,
        reason: error instanceof Error ? error.message : String(error),
        error: serializeRuntimeError(error),
      });
      throw error;
    }
    const now = this.clock.now();
    const envelopeBase: StoredEnvelope = {
      id: this.ids.envelopeId(),
      kind: EnvelopeKind.User,
      to: to.id.toString(),
      toKind: to.kind,
      message: cloneJson(message as never) as StoredEnvelope["message"],
      status: EnvelopeStatus.Queued,
      attempt: 0,
      maxAttempts: options?.maxAttempts ?? this.defaultMessageMaxAttempts,
      notBefore: toIsoDateTimeString(options?.notBefore ?? now),
      priority: options?.priority ?? 0,
      createdAt: toIsoDateTimeString(now),
      updatedAt: toIsoDateTimeString(now),
    };
    const envelope: StoredEnvelope = {
      ...envelopeBase,
      ...(options?.correlationId !== undefined ? { correlationId: options.correlationId } : {}),
      ...(options?.dedupeKey !== undefined ? { dedupeKey: options.dedupeKey } : {}),
    };
    await this.persistence.enqueue([envelope]);
    this.invalidate(SnapshotInvalidationReason.RuntimeChanged);
    return envelope.id;
  }

  private serializeError(error: unknown): SerializedActorError {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        ...(error.stack !== undefined ? { stack: error.stack } : {}),
      };
    }
    return { name: "UnknownError", message: String(error) };
  }

  private async buildFailureCommit(claimed: ClaimedActivation, error: SerializedActorError): Promise<ActivationFailureCommit> {
    const now = this.clock.now();
    const parent = claimed.actor.parentId ? await this.persistence.loadActor(ActorId.parse(claimed.actor.parentId)) : undefined;
    const events: StoredRuntimeEvent[] = [{
      id: this.ids.runtimeEventId(),
      type: RuntimeEventType.ActivationFailed,
      actorId: claimed.actor.id,
      envelopeId: claimed.envelope.id,
      data: { actorId: claimed.actor.id, envelopeId: claimed.envelope.id, error },
      createdAt: toIsoDateTimeString(now),
    }];
    const envelopeCreates: StoredEnvelope[] = [];
    const shouldEscalateToParent = parent !== undefined
      && parent.status === ActorStatus.Running
      && claimed.envelope.kind !== EnvelopeKind.LifecycleStop;
    if (shouldEscalateToParent && parent) {
      const failure: ActorFailure = {
        child: { id: claimed.actor.id, kind: claimed.actor.kind, generation: claimed.actor.generation },
        envelope: {
          id: claimed.envelope.id,
          kind: claimed.envelope.kind,
          messageType: claimed.envelope.message.type,
          attempt: claimed.envelope.attempt + 1,
          maxAttempts: claimed.envelope.maxAttempts,
        },
        error,
        occurredAt: toIsoDateTimeString(now),
      };
      envelopeCreates.push({
        id: this.ids.envelopeId(),
        kind: EnvelopeKind.Supervision,
        to: parent.id,
        toKind: parent.kind,
        from: claimed.actor.id,
        fromKind: claimed.actor.kind,
        message: ({ type: SystemMessageType.Supervision, failure } as unknown) as StoredEnvelope["message"],
        status: EnvelopeStatus.Queued,
        attempt: 0,
        maxAttempts: 1,
        notBefore: toIsoDateTimeString(now),
        priority: 0,
        createdAt: toIsoDateTimeString(now),
        updatedAt: toIsoDateTimeString(now),
      });
      events.push(
        this.envelopeCreatedEvent(envelopeCreates[0]!),
        this.envelopeStatusChangedEvent(claimed.actor.id, claimed.envelope.id, EnvelopeStatus.Processing, EnvelopeStatus.Faulted),
        this.statusChangedEvent(claimed.actor.id, claimed.actor.status, ActorStatus.Suspended),
      );
      return {
        now,
        error,
        actorPatch: { status: ActorStatus.Suspended },
        actorUpdates: [],
        failedEnvelopeStatus: EnvelopeStatus.Faulted,
        envelopeCreates,
        events,
      };
    }
    const cascade = claimed.envelope.kind === EnvelopeKind.LifecycleStop
      ? await this.cascadeSubtreeStop(claimed.actor.id, now)
      : { actorUpdates: [], envelopeCreates: [], events: [] };
    return {
      now,
      error,
      actorPatch: { status: ActorStatus.Stopped },
      actorUpdates: cascade.actorUpdates,
      failedEnvelopeStatus: EnvelopeStatus.DeadLettered,
      envelopeCreates: [...envelopeCreates, ...cascade.envelopeCreates],
      events: [
        ...events,
        ...cascade.events,
        this.envelopeStatusChangedEvent(claimed.actor.id, claimed.envelope.id, EnvelopeStatus.Processing, EnvelopeStatus.DeadLettered),
        this.statusChangedEvent(claimed.actor.id, claimed.actor.status, ActorStatus.Stopped),
      ],
    };
  }

  private async buildCommit(
    claimed: ClaimedActivation,
    effects: EffectBuffer<R, KindOf<R>>,
  ): Promise<ActivationCommit> {
    const now = this.clock.now();
    const actorUpdatesById = new Map<string, ActivationCommit["actorUpdates"][number]>();
    const actorCreates: Array<ActivationCommit["actorCreates"][number]> = [];
    const envelopeCreates: StoredEnvelope[] = [];
    const events: StoredRuntimeEvent[] = [];
    const scheduledStops = new Set<string>();
    const upsertActorUpdate = (update: ActivationCommit["actorUpdates"][number]): void => {
      const existing = actorUpdatesById.get(update.id);
      if (!existing) {
        actorUpdatesById.set(update.id, update);
        return;
      }
      actorUpdatesById.set(update.id, {
        ...existing,
        patch: {
          ...existing.patch,
          ...update.patch,
        },
        updatedAt: update.updatedAt,
      });
    };
    const scheduleActorStop = (
      actor: Pick<StoredActor, "id" | "kind" | "status" | "version">,
      reason: StopReason,
    ): void => {
      if (
        actor.status === ActorStatus.Stopped
        || actor.status === ActorStatus.Stopping
        || scheduledStops.has(actor.id)
      ) {
        return;
      }
      scheduledStops.add(actor.id);
      upsertActorUpdate({
        id: actor.id,
        expectedVersion: actor.version,
        patch: { status: ActorStatus.Stopping },
        updatedAt: toIsoDateTimeString(now),
      });
      const envelope = this.makeLifecycleStopEnvelope(actor, reason, now);
      envelopeCreates.push(envelope);
      events.push(this.envelopeCreatedEvent(envelope));
      events.push(this.statusChangedEvent(actor.id, actor.status, ActorStatus.Stopping));
    };
    const scheduleSubtreeStop = async (actorId: string): Promise<void> => {
      const children = await this.persistence.listChildren(ActorId.parse(actorId));
      for (const child of children) {
        scheduleActorStop(child, { type: StopReasonType.ParentStopped });
        await scheduleSubtreeStop(child.id);
      }
    };
    for (const effect of effects.all()) {
      switch (effect.type) {
        case EffectType.Send:
          {
            const envelope = this.makeUserEnvelope(
              claimed,
              effect.to as ActorRef<R, KindOf<R>>,
              cloneJson(effect.message as never) as StoredEnvelope["message"],
              effect.options,
              now,
            );
            envelopeCreates.push(envelope);
            events.push(this.envelopeCreatedEvent(envelope));
          }
          break;
        case EffectType.Spawn: {
          if (claimed.actor.status === ActorStatus.Stopping || claimed.actor.status === ActorStatus.Stopped) {
            throw new ActorSystemError(
              ActorErrorCode.RuntimeStopped,
              `Actor ${claimed.actor.id} cannot spawn while ${claimed.actor.status}`,
            );
          }
          const childDef = this.definitions[effect.childKind as KindOf<R>];
          assertJsonValue(effect.init);
          const initialized = childDef.init(effect.init as never);
          this.ensureBehaviorExists(effect.childKind as KindOf<R>, initialized.behavior);
          assertJsonValue(initialized.state);
          const child: StoredActor = {
            id: effect.childId.toString(),
            kind: effect.childKind,
            parentId: claimed.actor.id,
            status: ActorStatus.Starting,
            behavior: initialized.behavior,
            state: cloneJson(initialized.state as never),
            init: cloneJson(effect.init as never),
            generation: 0,
            version: 0,
            createdAt: toIsoDateTimeString(now),
            updatedAt: toIsoDateTimeString(now),
          };
          actorCreates.push({
            actor: child,
            startEnvelope: {
              id: this.ids.envelopeId(),
              kind: EnvelopeKind.LifecycleStart,
              to: child.id,
              toKind: child.kind,
              message: { type: SystemMessageType.LifecycleStart },
              status: EnvelopeStatus.Queued,
              attempt: 0,
              maxAttempts: 1,
              notBefore: toIsoDateTimeString(now),
              priority: 0,
              createdAt: toIsoDateTimeString(now),
              updatedAt: toIsoDateTimeString(now),
            },
            ifExists: ActorCreateMode.OkIfSameKind,
          });
          events.push({
            id: this.ids.runtimeEventId(),
            type: RuntimeEventType.ActorCreated,
            actorId: child.id,
            data: { actorId: child.id, kind: child.kind, parentId: child.parentId },
            createdAt: toIsoDateTimeString(now),
          });
          events.push(this.envelopeCreatedEvent(actorCreates[actorCreates.length - 1]!.startEnvelope));
          break;
        }
        case EffectType.SetState:
          upsertActorUpdate({
            id: claimed.actor.id,
            expectedVersion: claimed.claim.actorVersion,
            patch: { state: cloneJson(effect.state as never) },
            updatedAt: toIsoDateTimeString(now),
          });
          break;
        case EffectType.Become:
          upsertActorUpdate({
            id: claimed.actor.id,
            expectedVersion: claimed.claim.actorVersion,
            patch: {
              behavior: effect.behavior,
              ...(effect.state === undefined ? {} : { state: cloneJson(effect.state as never) }),
            },
            updatedAt: toIsoDateTimeString(now),
          });
          break;
        case EffectType.StopSelf:
          scheduleActorStop({
            id: claimed.actor.id,
            kind: claimed.actor.kind,
            status: claimed.actor.status,
            version: claimed.claim.actorVersion,
          }, effect.reason);
          await scheduleSubtreeStop(claimed.actor.id);
          break;
        case EffectType.StopChild: {
          const child = await this.persistence.loadActor(effect.childId);
          if (child) {
            scheduleActorStop(child, effect.reason);
            await scheduleSubtreeStop(child.id);
          }
          break;
        }
      }
    }
    return {
      actorCreates,
      actorUpdates: [...actorUpdatesById.values()],
      envelopeCreates,
      envelopeUpdates: [],
      events,
      completeClaimedEnvelopeAs: EnvelopeStatus.Completed,
    };
  }

  private async cascadeSubtreeStop(actorId: string, now: Date): Promise<{
    actorUpdates: Array<ActivationCommit["actorUpdates"][number]>;
    envelopeCreates: StoredEnvelope[];
    events: StoredRuntimeEvent[];
  }> {
    const children = await this.persistence.listChildren(ActorId.parse(actorId));
    const actorUpdates: Array<ActivationCommit["actorUpdates"][number]> = [];
    const envelopeCreates: StoredEnvelope[] = [];
    const events: StoredRuntimeEvent[] = [];
    for (const child of children) {
      if (child.status !== ActorStatus.Stopped && child.status !== ActorStatus.Stopping) {
        actorUpdates.push({
          id: child.id,
          expectedVersion: child.version,
          patch: { status: ActorStatus.Stopping },
          updatedAt: toIsoDateTimeString(now),
        });
        const envelope = this.makeLifecycleStopEnvelope(child, { type: StopReasonType.ParentStopped }, now);
        envelopeCreates.push(envelope);
        events.push(this.envelopeCreatedEvent(envelope));
        events.push(this.statusChangedEvent(child.id, child.status, ActorStatus.Stopping));
      }
      const cascade = await this.cascadeSubtreeStop(child.id, now);
      actorUpdates.push(...cascade.actorUpdates);
      envelopeCreates.push(...cascade.envelopeCreates);
      events.push(...cascade.events);
    }
    return { actorUpdates, envelopeCreates, events };
  }

  async runClaimedActivation(claimed: ClaimedActivation): Promise<ActivationRunResult> {
    const definition = this.definitions[claimed.actor.kind as KindOf<R>];
    const effects = new EffectBuffer<R, KindOf<R>>();
    const sender = claimed.envelope.from && claimed.envelope.fromKind
      ? actorRef(ActorId.parse(claimed.envelope.from), claimed.envelope.fromKind as KindOf<R>)
      : undefined;
    const parent = claimed.actor.parentId
      ? (async () => {
          const parentActor = await this.persistence.loadActor(ActorId.parse(claimed.actor.parentId!));
          return parentActor ? actorRef(ActorId.parse(parentActor.id), parentActor.kind as KindOf<R>) : undefined;
        })()
      : Promise.resolve(undefined);
    let commitPayload:
      | {
          readonly commit: ActivationCommit;
          readonly actorUpdates?: ActivationCommit["actorUpdates"];
          readonly envelopeCreates?: readonly StoredEnvelope[];
          readonly events?: readonly StoredRuntimeEvent[];
        }
      | undefined;
    try {
      commitPayload = await this.runWithActivationTimeout(async (signal) => {
        const ctx = createActorContext({
          self: actorRef(ActorId.parse(claimed.actor.id), claimed.actor.kind as KindOf<R>),
          parent: await parent,
          sender,
          actorStatus: claimed.actor.status,
          state: cloneJson(claimed.actor.state as never),
          behavior: claimed.actor.behavior as never,
          envelope: this.makeEnvelopeView(claimed.envelope),
          now: this.clock.now(),
          signal,
          effects,
          defaultMessageMaxAttempts: this.defaultMessageMaxAttempts,
        });
        this.ensureBehaviorExists(claimed.actor.kind as KindOf<R>, claimed.actor.behavior);
        this.validateMessage(claimed);
        switch (claimed.envelope.kind) {
          case EnvelopeKind.User: {
            const receiver = (definition.receive as Record<string, (ctx: unknown, message: unknown) => void | Promise<void>>)[claimed.actor.behavior];
            if (!receiver) {
              throw new Error(`Missing receiver for behavior ${claimed.actor.behavior}`);
            }
            await receiver(ctx, claimed.envelope.message);
            break;
          }
          case EnvelopeKind.LifecycleStart: {
            const status = await runOnStart(definition as never, ctx as never);
            await this.validateEffects(claimed, effects as never);
            const commit = await this.buildCommit(claimed, effects as never);
            return {
              commit,
              actorUpdates: this.mergeActorUpdates([
                ...commit.actorUpdates,
                {
                  id: claimed.actor.id,
                  expectedVersion: claimed.claim.actorVersion,
                  patch: { status },
                  updatedAt: toIsoDateTimeString(this.clock.now()),
                },
              ]),
              events: [
                ...commit.events,
                this.envelopeStatusChangedEvent(claimed.actor.id, claimed.envelope.id, EnvelopeStatus.Processing, EnvelopeStatus.Completed),
                this.statusChangedEvent(claimed.actor.id, claimed.actor.status, status),
              ],
            };
          }
          case EnvelopeKind.LifecycleStop: {
            const status = await runOnStop(definition as never, ctx as never, ((claimed.envelope.message as unknown) as { reason: StopReason }).reason);
            await this.validateEffects(claimed, effects as never);
            const commit = await this.buildCommit(claimed, effects as never);
            const cascade = await this.cascadeSubtreeStop(claimed.actor.id, this.clock.now());
            return {
              commit,
              actorUpdates: this.mergeActorUpdates([
                ...commit.actorUpdates,
                ...cascade.actorUpdates,
                {
                  id: claimed.actor.id,
                  expectedVersion: claimed.claim.actorVersion,
                  patch: { status },
                  updatedAt: toIsoDateTimeString(this.clock.now()),
                },
              ]),
              envelopeCreates: [...commit.envelopeCreates, ...cascade.envelopeCreates],
              events: [
                ...commit.events,
                ...cascade.events,
                this.envelopeStatusChangedEvent(claimed.actor.id, claimed.envelope.id, EnvelopeStatus.Processing, EnvelopeStatus.Completed),
                this.statusChangedEvent(claimed.actor.id, claimed.actor.status, status),
              ],
            };
          }
          case EnvelopeKind.LifecycleRestart: {
            const status = await runOnRestart(definition as never, ctx as never, ((claimed.envelope.message as unknown) as { reason: RestartReason }).reason);
            await this.validateEffects(claimed, effects as never);
            const commit = await this.buildCommit(claimed, effects as never);
            return {
              commit,
              actorUpdates: this.mergeActorUpdates([
                ...commit.actorUpdates,
                {
                  id: claimed.actor.id,
                  expectedVersion: claimed.claim.actorVersion,
                  patch: { status },
                  updatedAt: toIsoDateTimeString(this.clock.now()),
                },
              ]),
              events: [
                ...commit.events,
                this.envelopeStatusChangedEvent(claimed.actor.id, claimed.envelope.id, EnvelopeStatus.Processing, EnvelopeStatus.Completed),
                this.statusChangedEvent(claimed.actor.id, claimed.actor.status, status),
              ],
            };
          }
          case EnvelopeKind.Supervision: {
            const directive = await runSupervision(
              definition as never,
              ctx as never,
              ((claimed.envelope.message as unknown) as { failure: ActorFailure }).failure,
              this.runtimeOptions,
              this.persistence,
              this.clock,
            );
            if (directive.type === SupervisionDirectiveType.Escalate) {
              throw new ActorSystemError(ActorErrorCode.UnhandledMessage, "Escalated supervision failure");
            }
            const commit = await this.buildSupervisionCommit(
              claimed,
              directive,
              ((claimed.envelope.message as unknown) as { failure: ActorFailure }).failure,
            );
            await this.emitInfrastructureEvent({
              type: "supervisionApplied",
              occurredAt: toIsoDateTimeString(this.clock.now()),
              parentId: claimed.actor.id,
              childId: ((claimed.envelope.message as unknown) as { failure: ActorFailure }).failure.child.id,
              directive: directive.type,
              failure: ((claimed.envelope.message as unknown) as { failure: ActorFailure }).failure,
            });
            return { commit };
          }
        }
        await this.validateEffects(claimed, effects as never);
        const commit = await this.buildCommit(claimed, effects as never);
        return {
          commit,
          events: [
            ...commit.events,
            this.envelopeStatusChangedEvent(claimed.actor.id, claimed.envelope.id, EnvelopeStatus.Processing, EnvelopeStatus.Completed),
          ],
        };
      });
    } catch (error) {
      effects.close();
      const failure = await this.buildFailureCommit(claimed, this.serializeError(error));
      await this.emitInfrastructureEvent({
        type: "activationFailed",
        occurredAt: toIsoDateTimeString(this.clock.now()),
        actorId: claimed.actor.id,
        actorKind: claimed.actor.kind,
        envelopeId: claimed.envelope.id,
        messageType: claimed.envelope.message.type,
        error: failure.error,
      });
      await this.persistence.failActivation(claimed.claim, failure);
      this.invalidate(SnapshotInvalidationReason.ActivationFailed);
      return {
        committed: false,
        actorId: claimed.actor.id,
        envelopeId: claimed.envelope.id,
        error: failure.error,
      };
    }

    effects.close();

    await this.persistence.commitActivation(claimed.claim, {
      ...commitPayload.commit,
      actorUpdates: commitPayload.actorUpdates ?? commitPayload.commit.actorUpdates,
      envelopeCreates: commitPayload.envelopeCreates ?? commitPayload.commit.envelopeCreates,
      events: commitPayload.events ?? commitPayload.commit.events,
    });
    this.invalidate(SnapshotInvalidationReason.ActivationCommitted);
    return { committed: true, actorId: claimed.actor.id, envelopeId: claimed.envelope.id };
  }

  private async buildSupervisionCommit(
    claimed: ClaimedActivation,
    directive: SupervisionDirective,
    failure: ActorFailure,
  ): Promise<ActivationCommit> {
    const child = await this.persistence.loadActor(ActorId.parse(failure.child.id));
    if (!child) {
      return {
        actorCreates: [],
        actorUpdates: [],
        envelopeCreates: [],
        envelopeUpdates: [],
        events: [
          this.supervisionAppliedEvent(claimed.actor.id, failure.child.id, directive.type),
          this.envelopeStatusChangedEvent(claimed.actor.id, claimed.envelope.id, EnvelopeStatus.Processing, EnvelopeStatus.Completed),
        ],
        completeClaimedEnvelopeAs: EnvelopeStatus.Completed,
      };
    }
    const now = this.clock.now();
    const actorUpdates: Array<ActivationCommit["actorUpdates"][number]> = [];
    const envelopeUpdates: Array<ActivationCommit["envelopeUpdates"][number]> = [];
    const envelopeCreates: StoredEnvelope[] = [];
    const events: StoredRuntimeEvent[] = [];
    if (directive.type === SupervisionDirectiveType.Resume) {
      actorUpdates.push({ id: child.id, expectedVersion: child.version, patch: { status: ActorStatus.Running }, updatedAt: toIsoDateTimeString(now) });
      const faulted = (await this.persistence.readSnapshot({ includeEvents: false, includeCompletedEnvelopes: true, includeDroppedEnvelopes: true })).envelopes.find((e) => e.id === failure.envelope.id);
      if (faulted) {
        const patch = {
          status: directive.failedMessage === FailedMessageAction.Drop ? EnvelopeStatus.Dropped : EnvelopeStatus.Queued,
          ...(directive.backoffMs !== undefined ? { notBefore: toIsoDateTimeString(new Date(now.getTime() + directive.backoffMs)) } : {}),
        };
        envelopeUpdates.push({
          id: faulted.id,
          expectedStatus: EnvelopeStatus.Faulted,
          patch,
          updatedAt: toIsoDateTimeString(now),
        });
        events.push(this.envelopeStatusChangedEvent(child.id, faulted.id, EnvelopeStatus.Faulted, directive.failedMessage === FailedMessageAction.Drop ? EnvelopeStatus.Dropped : EnvelopeStatus.Queued));
      }
      events.push(this.statusChangedEvent(child.id, child.status, ActorStatus.Running));
    }
    if (directive.type === SupervisionDirectiveType.Stop) {
      actorUpdates.push({ id: child.id, expectedVersion: child.version, patch: { status: ActorStatus.Stopping }, updatedAt: toIsoDateTimeString(now) });
      const lifecycleStop = this.makeLifecycleStopEnvelope(child, { type: StopReasonType.Supervision, failure }, now);
      envelopeCreates.push(lifecycleStop);
      events.push(this.envelopeCreatedEvent(lifecycleStop));
      events.push(this.statusChangedEvent(child.id, child.status, ActorStatus.Stopping));
      const faulted = (await this.persistence.readSnapshot({ includeEvents: false, includeCompletedEnvelopes: true, includeDroppedEnvelopes: true })).envelopes.find((e) => e.id === failure.envelope.id);
      if (faulted) {
        const currentStatus = directive.failedMessage === FailedMessageAction.DeadLetter ? EnvelopeStatus.DeadLettered : EnvelopeStatus.Dropped;
        envelopeUpdates.push({ id: faulted.id, expectedStatus: EnvelopeStatus.Faulted, patch: { status: currentStatus }, updatedAt: toIsoDateTimeString(now) });
        events.push(this.envelopeStatusChangedEvent(child.id, faulted.id, EnvelopeStatus.Faulted, currentStatus));
      }
    }
    if (directive.type === SupervisionDirectiveType.Restart) {
      const def = this.definitions[child.kind as KindOf<R>];
      const initialized = def.init(child.init as never);
      this.ensureBehaviorExists(child.kind as KindOf<R>, initialized.behavior);
      assertJsonValue(initialized.state);
      actorUpdates.push({
        id: child.id,
        expectedVersion: child.version,
        patch: {
          status: ActorStatus.Starting,
          behavior: initialized.behavior,
          state: cloneJson(initialized.state as never),
          generation: child.generation + 1,
        },
        updatedAt: toIsoDateTimeString(now),
      });
      const restartEnvelope = this.makeLifecycleRestartEnvelope(child, { type: RestartReasonType.Supervision, failure }, now);
      envelopeCreates.push(restartEnvelope);
      events.push(this.envelopeCreatedEvent(restartEnvelope));
      events.push(this.statusChangedEvent(child.id, child.status, ActorStatus.Starting));
      const faulted = (await this.persistence.readSnapshot({ includeEvents: false, includeCompletedEnvelopes: true, includeDroppedEnvelopes: true })).envelopes.find((e) => e.id === failure.envelope.id);
      if (faulted) {
        const currentStatus = directive.failedMessage === FailedMessageAction.Drop ? EnvelopeStatus.Dropped : EnvelopeStatus.Queued;
        const patch = {
          status: currentStatus,
          ...(directive.backoffMs !== undefined ? { notBefore: toIsoDateTimeString(new Date(now.getTime() + directive.backoffMs)) } : {}),
        };
        envelopeUpdates.push({
          id: faulted.id,
          expectedStatus: EnvelopeStatus.Faulted,
          patch,
          updatedAt: toIsoDateTimeString(now),
        });
        events.push(this.envelopeStatusChangedEvent(child.id, faulted.id, EnvelopeStatus.Faulted, currentStatus));
      }
    }
    return {
      actorCreates: [],
      actorUpdates,
      envelopeCreates,
      envelopeUpdates,
      events: [
        ...events,
        this.supervisionAppliedEvent(claimed.actor.id, child.id, directive.type),
        this.envelopeStatusChangedEvent(claimed.actor.id, claimed.envelope.id, EnvelopeStatus.Processing, EnvelopeStatus.Completed),
      ],
      completeClaimedEnvelopeAs: EnvelopeStatus.Completed,
    };
  }
}