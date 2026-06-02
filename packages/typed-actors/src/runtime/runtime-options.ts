import type { RuntimeOwnerId } from "../core/ids.js";
import type { SerializedRuntimeError } from "../core/errors.js";
import { SupervisionDirectiveType } from "../core/constants.js";
import type { DefaultSupervisionPolicyOptions } from "./supervision/default-supervision-policy.js";
import type { ActorFailure } from "./supervision/supervision-types.js";

/**
 * Centralized infrastructure event emitted by the actor runtime.
 */
export type RuntimeInfrastructureEvent =
  | {
    readonly type: "activationFailed";
    readonly occurredAt: string;
    readonly actorId: string;
    readonly actorKind: string;
    readonly envelopeId: string;
    readonly messageType: string;
    readonly error: SerializedRuntimeError;
  }
  | {
    readonly type: "supervisionApplied";
    readonly occurredAt: string;
    readonly parentId: string;
    readonly childId: string;
    readonly directive: typeof SupervisionDirectiveType[keyof typeof SupervisionDirectiveType];
    readonly failure: ActorFailure;
  }
  | {
    readonly type: "schedulerFailed";
    readonly occurredAt: string;
    readonly error: SerializedRuntimeError;
  }
  | {
    readonly type: "externalMessageRejected";
    readonly occurredAt: string;
    readonly actorId: string;
    readonly actorKind: string;
    readonly messageType?: string;
    readonly reason: string;
    readonly error: SerializedRuntimeError;
  };

/**
 * Optional sink for runtime-generated infrastructure events.
 */
export interface RuntimeInfrastructureLogSink {
  emit(event: RuntimeInfrastructureEvent): void | Promise<void>;
}

export interface RuntimeOptions {
  readonly ownerId?: RuntimeOwnerId;
  readonly leaseMs?: number;
  readonly activationTimeoutMs?: number;
  readonly defaultMessageMaxAttempts?: number;
  readonly idleBackoffMs?: number;
  readonly concurrency?: number;
  readonly supervision?: DefaultSupervisionPolicyOptions;
  readonly infrastructureLogSink?: RuntimeInfrastructureLogSink;
}

export const RuntimeDefaults = {
  LeaseMs: 30_000,
  ActivationTimeoutMs: 25_000,
  DefaultMessageMaxAttempts: 3,
  IdleBackoffMs: 50,
  Concurrency: 1,
} as const;