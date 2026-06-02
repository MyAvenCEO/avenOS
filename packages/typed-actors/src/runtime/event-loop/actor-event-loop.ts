import type { ValueOf } from "../../core/constants.js";
import type { SerializedRuntimeError } from "../../core/errors.js";
import type { ActorIdString, EnvelopeId, IsoDateTimeString, RuntimeOwnerId } from "../../core/ids.js";
import type { ActivationClaim } from "../../persistence/actor-persistence.js";

export interface ActorEventLoop {
  runOne(): Promise<RunOneResult>;
  runUntilIdle(options?: RunUntilIdleOptions): Promise<RunUntilIdleResult>;
  start(): void;
  pause(): void;
  resume(): void;
  stop(): Promise<void>;
  getRuntimeSnapshot(): RuntimeSnapshot;
  wake(): void;
}

export type RunOneResult =
  | { readonly processed: true; readonly actorId: ActorIdString; readonly envelopeId: EnvelopeId }
  | { readonly processed: false };

export interface RunUntilIdleOptions {
  readonly maxIterations?: number;
}

export const RunUntilIdleStopReason = {
  Idle: "idle",
  MaxIterations: "maxIterations",
  Stopped: "stopped",
} as const;

export type RunUntilIdleStopReason = ValueOf<typeof RunUntilIdleStopReason>;

export interface RunUntilIdleResult {
  readonly processed: number;
  readonly stoppedBecause: RunUntilIdleStopReason;
}

export interface RuntimeSnapshot {
  readonly running: boolean;
  readonly paused: boolean;
  readonly ownerId: RuntimeOwnerId;
  readonly activeClaims: readonly ActivationClaim[];
  readonly takenAt: IsoDateTimeString;
  readonly lastError?: SerializedRuntimeError;
}