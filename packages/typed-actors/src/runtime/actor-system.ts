import { systemClock, type Clock } from "../core/clock.js";
import type { ActorId } from "../core/actor-id.js";
import { ActorSystemError, serializeRuntimeError, type SerializedRuntimeError } from "../core/errors.js";
import { defaultIdGenerator, toIsoDateTimeString, type IdGenerator } from "../core/ids.js";
import type { ActorRef } from "../core/actor-ref.js";
import {
  ActorStatus,
  ActorErrorCode,
  EnvelopeKind,
  EnvelopeStatus,
  RuntimeEventType,
  StopReasonType,
  SystemMessageType,
} from "../core/constants.js";
import { LocalActorInspector, type ActorInspector } from "../introspection/actor-inspector.js";
import { ActorCreateMode, type ActorPersistence } from "../persistence/actor-persistence.js";
import type { ActorDefinition, ActorDefinitionMap } from "../registry/actor-definition.js";
import type { ActorRegistry, InboxOf, InitOf, KindOf } from "../registry/actor-type.js";
import { ActorRuntime } from "./actor-runtime.js";
import { startScheduler, type SchedulerHandle } from "./event-loop/scheduler.js";
import {
  RunUntilIdleStopReason,
  type ActorEventLoop,
  type RunOneResult,
  type RunUntilIdleOptions,
  type RunUntilIdleResult,
  type RuntimeSnapshot,
} from "./event-loop/actor-event-loop.js";
import type { RuntimeOptions } from "./runtime-options.js";
import { RuntimeDefaults } from "./runtime-options.js";
import type { StoredEnvelope } from "../persistence/stored-records.js";

export type { RuntimeOptions } from "./runtime-options.js";

export type ActorDefinitionsInput<R extends ActorRegistry> = Readonly<{ [K in KindOf<R>]: ActorDefinition<R, K> }>;

export interface ActorSystemOptions<R extends ActorRegistry> {
  readonly registry: R;
  readonly definitions: ActorDefinitionsInput<R>;
  readonly persistence: ActorPersistence;
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
  readonly runtime?: RuntimeOptions;
}

export interface CreateRootOptions<R extends ActorRegistry, K extends KindOf<R>> {
  readonly id: ActorId;
  readonly init: InitOf<R, K>;
  readonly ifExists?: ActorCreateMode;
}

export interface ExternalSendOptions {
  readonly notBefore?: Date;
  readonly priority?: number;
  readonly correlationId?: string;
  readonly dedupeKey?: string;
  readonly maxAttempts?: number;
}

export interface ActorSystem<R extends ActorRegistry> {
  readonly eventLoop: ActorEventLoop;
  readonly inspector: ActorInspector<R>;
  createRoot<K extends KindOf<R>>(kind: K, options: CreateRootOptions<R, K>): Promise<ActorRef<R, K>>;
  send<TTarget extends KindOf<R>>(to: ActorRef<R, TTarget>, message: InboxOf<R, TTarget>, options?: ExternalSendOptions): Promise<StoredEnvelope["id"]>;
  runOne(): Promise<RunOneResult>;
  runUntilIdle(options?: RunUntilIdleOptions): Promise<RunUntilIdleResult>;
  start(): void;
  pause(): void;
  resume(): void;
  stop(): Promise<void>;
  wake(): void;
}

class LocalEventLoop<R extends ActorRegistry> implements ActorEventLoop {
  private running = false;
  private paused = false;
  private stopped = false;
  private stopPromise: Promise<void> | undefined;
  private drainingForStop = false;
  private failed = false;
  private lastError: SerializedRuntimeError | undefined;
  private scheduler: SchedulerHandle | undefined;
  private readonly activeClaims: Array<Parameters<ActorRuntime<R>["runClaimedActivation"]>[0]["claim"]> = [];

  constructor(
    private readonly runtime: ActorRuntime<R>,
    private readonly ownerId: ReturnType<IdGenerator["runtimeOwnerId"]>,
    private readonly runtimeOptions: RuntimeOptions,
    private readonly clock: Clock,
  ) {}

  async runOne(): Promise<RunOneResult> {
    if (this.paused || this.stopped || (this.stopPromise && !this.drainingForStop)) {
      return { processed: false };
    }
    await this.runtime.persistence.releaseExpiredLeases(this.clock.now());
    const claimed = await this.runtime.persistence.claimNext({
      now: this.clock.now(),
      ownerId: this.ownerId,
      leaseMs: this.runtimeOptions.leaseMs ?? RuntimeDefaults.LeaseMs,
    });
    if (!claimed) {
      return { processed: false };
    }
    this.activeClaims.push(claimed.claim);
    try {
      const result = await this.runtime.runClaimedActivation(claimed);
      return { processed: true, actorId: result.actorId, envelopeId: result.envelopeId };
    } finally {
      const index = this.activeClaims.findIndex((item) => item.envelopeId === claimed.claim.envelopeId);
      if (index >= 0) {
        this.activeClaims.splice(index, 1);
      }
    }
  }

  wake(): void {
    this.scheduler?.wake();
  }

  async runUntilIdle(options?: RunUntilIdleOptions): Promise<RunUntilIdleResult> {
    let processed = 0;
    const maxIterations = options?.maxIterations ?? Number.POSITIVE_INFINITY;
    while (!this.stopped && processed < maxIterations) {
      const result = await this.runOne();
      if (!result.processed) {
        return { processed, stoppedBecause: RunUntilIdleStopReason.Idle };
      }
      processed += 1;
    }
    return {
      processed,
      stoppedBecause: this.stopped ? RunUntilIdleStopReason.Stopped : RunUntilIdleStopReason.MaxIterations,
    };
  }

  start(): void {
    if (this.running || this.stopped || this.failed || this.scheduler) {
      return;
    }
    this.running = true;
    this.paused = false;
    this.scheduler = startScheduler(
      () => this.runOne().then((result) => result.processed),
      {
        idleBackoffMs: this.runtimeOptions.idleBackoffMs ?? RuntimeDefaults.IdleBackoffMs,
        concurrency: this.runtimeOptions.concurrency ?? RuntimeDefaults.Concurrency,
        onError: (error) => {
          void this.runtime.emitInfrastructureEvent({
            type: "schedulerFailed",
            occurredAt: toIsoDateTimeString(this.clock.now()),
            error: serializeRuntimeError(error),
          });
          this.lastError = serializeRuntimeError(error);
          this.paused = true;
          this.running = false;
          this.failed = true;
          this.scheduler?.stop();
          this.scheduler = undefined;
        },
      },
    );
  }

  pause(): void {
    this.paused = true;
    this.running = false;
  }

  resume(): void {
    if (this.failed || this.stopped) {
      return;
    }
    this.paused = false;
    this.running = this.scheduler !== undefined;
    this.wake();
  }

  async stop(): Promise<void> {
    if (this.stopPromise) {
      return this.stopPromise;
    }
    this.stopPromise = this.stopInternal();
    return this.stopPromise;
  }

  isStopping(): boolean {
    return this.stopPromise !== undefined;
  }

  getRuntimeSnapshot(): RuntimeSnapshot {
    return {
      running: this.running,
      paused: this.paused,
      ownerId: this.ownerId,
      activeClaims: this.activeClaims.slice(),
      takenAt: toIsoDateTimeString(this.clock.now()),
      lastError: this.lastError,
    };
  }

  private async waitForActiveClaims(): Promise<void> {
    while (this.activeClaims.length > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    }
  }

  private async stopInternal(): Promise<void> {
    this.running = false;
    this.failed = false;

    if (this.scheduler) {
      this.scheduler.stop();
      this.scheduler = undefined;
    }

    await this.waitForActiveClaims();
    await this.runtime.persistence.releaseOwnerClaims(this.ownerId, this.clock.now());

    while (true) {
      const snapshot = await this.runtime.persistence.readSnapshot({ includeCompletedEnvelopes: true, includeDroppedEnvelopes: true });
      const liveActors = snapshot.actors.filter((actor) => actor.status !== ActorStatus.Stopped);
      if (liveActors.length === 0) {
        break;
      }

      const now = this.clock.now();
      for (const actor of liveActors) {
        const stopEnvelope: StoredEnvelope = {
          id: this.runtime.ids.envelopeId(),
          kind: EnvelopeKind.LifecycleStop,
          to: actor.id,
          toKind: actor.kind,
          message: { type: SystemMessageType.LifecycleStop, reason: { type: StopReasonType.RuntimeShutdown } },
          status: EnvelopeStatus.Queued,
          attempt: 0,
          maxAttempts: 1,
          notBefore: toIsoDateTimeString(now),
          priority: Number.MAX_SAFE_INTEGER,
          createdAt: toIsoDateTimeString(now),
          updatedAt: toIsoDateTimeString(now),
        };
        await this.runtime.persistence.requestStop({
          actorId: actor.id,
          expectedStatuses: [ActorStatus.Starting, ActorStatus.Running, ActorStatus.Suspended, ActorStatus.Stopping],
          reason: { type: StopReasonType.RuntimeShutdown },
          stopEnvelope,
          events: [
            {
              id: this.runtime.ids.runtimeEventId(),
              type: RuntimeEventType.EnvelopeCreated,
              actorId: actor.id,
              envelopeId: stopEnvelope.id,
              data: {
                envelopeId: stopEnvelope.id,
                to: actor.id,
                kind: EnvelopeKind.LifecycleStop,
                messageType: SystemMessageType.LifecycleStop,
              },
              createdAt: toIsoDateTimeString(now),
            },
            {
              id: this.runtime.ids.runtimeEventId(),
              type: RuntimeEventType.ActorStatusChanged,
              actorId: actor.id,
              data: {
                actorId: actor.id,
                previousStatus: actor.status,
                currentStatus: ActorStatus.Stopping,
              },
              createdAt: toIsoDateTimeString(now),
            },
          ],
          now: toIsoDateTimeString(now),
        });
      }

      this.paused = false;
      this.drainingForStop = true;
      try {
        await this.runUntilIdle();
      } finally {
        this.drainingForStop = false;
      }
      await this.waitForActiveClaims();
    }

    this.stopped = true;
    this.paused = false;
    await this.waitForActiveClaims();
  }
}

export function createActorSystem<R extends ActorRegistry>(options: ActorSystemOptions<R>): ActorSystem<R> {
  const clock = options.clock ?? systemClock;
  const ids = options.ids ?? defaultIdGenerator;
  const runtimeOptions = options.runtime ?? {};
  const leaseMs = runtimeOptions.leaseMs ?? RuntimeDefaults.LeaseMs;
  const activationTimeoutMs = runtimeOptions.activationTimeoutMs ?? RuntimeDefaults.ActivationTimeoutMs;
  if (activationTimeoutMs >= leaseMs) {
    throw new Error("activationTimeoutMs must be lower than leaseMs");
  }
  const ownerId = runtimeOptions.ownerId ?? ids.runtimeOwnerId();
  let inspector!: LocalActorInspector<R>;
  const runtime = new ActorRuntime(
    options.registry,
    options.definitions,
    options.persistence,
    clock,
    ids,
    runtimeOptions,
    {
      invalidate(reason) {
        inspector.emit(reason as never);
      },
    },
  );
  const eventLoop = new LocalEventLoop(runtime, ownerId, runtimeOptions, clock);
  inspector = new LocalActorInspector(options.persistence, options.definitions, () => eventLoop.getRuntimeSnapshot(), clock);
  const assertAcceptingExternalWork = (): void => {
    if (eventLoop.isStopping()) {
      throw new ActorSystemError(ActorErrorCode.RuntimeStopped, "Actor system is stopping");
    }
  };
  return {
    eventLoop,
    inspector,
    createRoot(kind, createOptions) {
      assertAcceptingExternalWork();
      return runtime.createRoot(kind, createOptions.id, createOptions.init, createOptions.ifExists ?? ActorCreateMode.Fail)
        .then((ref) => {
          eventLoop.wake();
          return ref;
        });
    },
    send(to, message, sendOptions) {
      assertAcceptingExternalWork();
      return runtime.externalSend(to, message, sendOptions)
        .then((envelopeId) => {
          eventLoop.wake();
          return envelopeId;
        });
    },
    runOne() {
      return eventLoop.runOne();
    },
    runUntilIdle(loopOptions) {
      return eventLoop.runUntilIdle(loopOptions);
    },
    start() {
      eventLoop.start();
    },
    pause() {
      eventLoop.pause();
    },
    resume() {
      eventLoop.resume();
    },
    stop() {
      return eventLoop.stop();
    },
    wake() {
      eventLoop.wake();
    },
  };
}