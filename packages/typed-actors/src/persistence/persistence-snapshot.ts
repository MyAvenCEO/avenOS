import type { IsoDateTimeString } from "../core/ids.js";
import type { StoredActor, StoredEnvelope, StoredRuntimeEvent } from "./stored-records.js";

export interface PersistenceSnapshotOptions {
  readonly includeCompletedEnvelopes?: boolean;
  readonly includeDroppedEnvelopes?: boolean;
  readonly completedEnvelopeLimit?: number;
  readonly includeEvents?: boolean;
  readonly eventLimit?: number;
}

export interface PersistenceSnapshot {
  readonly takenAt: IsoDateTimeString;
  readonly actors: readonly StoredActor[];
  readonly envelopes: readonly StoredEnvelope[];
  readonly events: readonly StoredRuntimeEvent[];
}