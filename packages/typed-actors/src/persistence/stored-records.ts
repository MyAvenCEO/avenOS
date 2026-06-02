import type {
  ActorStatus,
  EnvelopeKind,
  EnvelopeStatus,
  RuntimeEventType,
  SupervisionDirectiveType,
} from "../core/constants.js";
import type {
  ActorIdString,
  CausationId,
  CorrelationId,
  DedupeKey,
  EnvelopeId,
  IsoDateTimeString,
  RuntimeEventId,
  RuntimeOwnerId,
} from "../core/ids.js";
import type { JsonObject, JsonValue } from "../core/json.js";
import type { SerializedActorError } from "../runtime/supervision/supervision-types.js";

export interface StoredActor {
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
}

export type StoredMessage = JsonObject & { readonly type: string };

export interface StoredEnvelope {
  readonly id: EnvelopeId;
  readonly kind: EnvelopeKind;
  readonly to: ActorIdString;
  readonly toKind: string;
  readonly from?: ActorIdString;
  readonly fromKind?: string;
  readonly message: StoredMessage;
  readonly status: EnvelopeStatus;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly notBefore: IsoDateTimeString;
  readonly priority: number;
  readonly correlationId?: CorrelationId;
  readonly causationId?: CausationId;
  readonly dedupeKey?: DedupeKey;
  readonly leaseOwner?: RuntimeOwnerId;
  readonly leaseUntil?: IsoDateTimeString;
  readonly createdAt: IsoDateTimeString;
  readonly updatedAt: IsoDateTimeString;
}

export interface RuntimeEventDataByType {
  readonly ["actor.created"]: {
    readonly actorId: ActorIdString;
    readonly kind: string;
    readonly parentId?: ActorIdString;
  };
  readonly ["actor.statusChanged"]: {
    readonly actorId: ActorIdString;
    readonly previousStatus: ActorStatus;
    readonly currentStatus: ActorStatus;
  };
  readonly ["envelope.created"]: {
    readonly envelopeId: EnvelopeId;
    readonly to: ActorIdString;
    readonly kind: EnvelopeKind;
    readonly messageType: string;
  };
  readonly ["envelope.statusChanged"]: {
    readonly envelopeId: EnvelopeId;
    readonly actorId: ActorIdString;
    readonly previousStatus: EnvelopeStatus;
    readonly currentStatus: EnvelopeStatus;
  };
  readonly ["activation.failed"]: {
    readonly actorId: ActorIdString;
    readonly envelopeId: EnvelopeId;
    readonly error: SerializedActorError;
  };
  readonly ["supervision.applied"]: {
    readonly parentId: ActorIdString;
    readonly childId: ActorIdString;
    readonly directive: SupervisionDirectiveType;
  };
}

export type StoredRuntimeEvent<TType extends RuntimeEventType = RuntimeEventType> = {
  readonly [K in TType]: {
    readonly id: RuntimeEventId;
    readonly type: K;
    readonly actorId?: ActorIdString;
    readonly envelopeId?: EnvelopeId;
    readonly data: RuntimeEventDataByType[K];
    readonly createdAt: IsoDateTimeString;
  };
}[TType];