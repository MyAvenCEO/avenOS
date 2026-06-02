import {
  ActorErrorCode,
  ActorStatus,
  EnvelopeKind,
  EnvelopeStatus,
  type ValueOf,
} from "../core/constants.js";
import type { ActorId } from "../core/actor-id.js";
import { PersistenceConflictError } from "../core/errors.js";
import type {
  ActorIdString,
  EnvelopeId,
  IsoDateTimeString,
  RuntimeOwnerId,
} from "../core/ids.js";
import type { JsonValue } from "../core/json.js";
import type {
  PersistenceSnapshot,
  PersistenceSnapshotOptions,
} from "./persistence-snapshot.js";
import type {
  StoredActor,
  StoredEnvelope,
  StoredRuntimeEvent,
} from "./stored-records.js";
import type { SerializedActorError } from "../runtime/supervision/supervision-types.js";
import type { StopReason } from "../runtime/lifecycle/lifecycle-types.js";

export const ActorCreateMode = {
  Fail: "fail",
  OkIfSameKind: "okIfSameKind",
} as const;

export type ActorCreateMode = ValueOf<typeof ActorCreateMode>;

export interface CreateActorCommand {
  readonly actor: StoredActor;
  readonly startEnvelope: StoredEnvelope;
  readonly events: readonly StoredRuntimeEvent[];
  readonly ifExists: ActorCreateMode;
}

export interface ClaimNextOptions {
  readonly now: Date;
  readonly ownerId: RuntimeOwnerId;
  readonly leaseMs: number;
}

export interface ActivationClaim {
  readonly envelopeId: EnvelopeId;
  readonly actorId: ActorIdString;
  readonly ownerId: RuntimeOwnerId;
  readonly actorVersion: number;
}

export interface ClaimedActivation {
  readonly claim: ActivationClaim;
  readonly actor: StoredActor;
  readonly envelope: StoredEnvelope;
}

export interface ActorCreate {
  readonly actor: StoredActor;
  readonly startEnvelope: StoredEnvelope;
  readonly ifExists: ActorCreateMode;
}

export type ActorPatch = Partial<{
  readonly status: ActorStatus;
  readonly behavior: string;
  readonly state: JsonValue;
  readonly init: JsonValue;
  readonly generation: number;
}>;

export interface ActorUpdate {
  readonly id: ActorIdString;
  readonly expectedVersion: number;
  readonly patch: ActorPatch;
  readonly updatedAt: IsoDateTimeString;
}

export type EnvelopePatch = Partial<{
  readonly status: EnvelopeStatus;
  readonly attempt: number;
  readonly notBefore: IsoDateTimeString;
  readonly priority: number;
  readonly leaseOwner: RuntimeOwnerId | undefined;
  readonly leaseUntil: IsoDateTimeString | undefined;
}>;

export interface EnvelopeUpdate {
  readonly id: EnvelopeId;
  readonly expectedStatus: EnvelopeStatus;
  readonly patch: EnvelopePatch;
  readonly updatedAt: IsoDateTimeString;
}

export interface ActivationCommit {
  readonly actorCreates: readonly ActorCreate[];
  readonly actorUpdates: readonly ActorUpdate[];
  readonly envelopeCreates: readonly StoredEnvelope[];
  readonly envelopeUpdates: readonly EnvelopeUpdate[];
  readonly events: readonly StoredRuntimeEvent[];
  readonly completeClaimedEnvelopeAs:
    | typeof EnvelopeStatus.Completed
    | typeof EnvelopeStatus.Dropped;
}

export interface ActivationFailureCommit {
  readonly now: Date;
  readonly error: SerializedActorError;
  readonly actorPatch: ActorPatch;
  readonly actorUpdates?: readonly ActorUpdate[];
  readonly failedEnvelopeStatus:
    | typeof EnvelopeStatus.Faulted
    | typeof EnvelopeStatus.DeadLettered;
  readonly envelopeCreates: readonly StoredEnvelope[];
  readonly events: readonly StoredRuntimeEvent[];
}

export interface RequestStopCommand {
  readonly actorId: ActorIdString;
  readonly expectedStatuses: readonly ActorStatus[];
  readonly reason: StopReason;
  readonly stopEnvelope: StoredEnvelope;
  readonly events: readonly StoredRuntimeEvent[];
  readonly now: IsoDateTimeString;
}

export interface ActorPersistence {
  createActor(command: CreateActorCommand): Promise<void>;
  loadActor(id: ActorId): Promise<StoredActor | undefined>;
  listChildren(parentId: ActorId): Promise<readonly StoredActor[]>;
  enqueue(envelopes: readonly StoredEnvelope[]): Promise<void>;
  claimNext(options: ClaimNextOptions): Promise<ClaimedActivation | undefined>;
  releaseOwnerClaims(ownerId: RuntimeOwnerId, now: Date): Promise<number>;
  commitActivation(claim: ActivationClaim, commit: ActivationCommit): Promise<void>;
  failActivation(
    claim: ActivationClaim,
    failure: ActivationFailureCommit,
  ): Promise<void>;
  requestStop(command: RequestStopCommand): Promise<void>;
  releaseExpiredLeases(now: Date): Promise<number>;
  readSnapshot(options?: PersistenceSnapshotOptions): Promise<PersistenceSnapshot>;
}

export function assertLeaseOwner(
  envelope: StoredEnvelope,
  ownerId: RuntimeOwnerId,
): void {
  if (envelope.leaseOwner !== ownerId) {
    throw new PersistenceConflictError(
      ActorErrorCode.EnvelopeLeaseMismatch,
      `Envelope lease owner mismatch for ${envelope.id}`,
    );
  }
}

export function isEnvelopeEligible(
  kind: EnvelopeKind,
  actorStatus: ActorStatus,
): boolean {
  switch (kind) {
    case EnvelopeKind.User:
      return actorStatus === ActorStatus.Running;
    case EnvelopeKind.LifecycleStart:
    case EnvelopeKind.LifecycleRestart:
      return actorStatus === ActorStatus.Starting;
    case EnvelopeKind.LifecycleStop:
      return actorStatus === ActorStatus.Stopping;
    case EnvelopeKind.Supervision:
      return actorStatus === ActorStatus.Running;
  }
}

export function throwVersionConflict(message: string): never {
  throw new PersistenceConflictError(ActorErrorCode.PersistenceConflict, message);
}